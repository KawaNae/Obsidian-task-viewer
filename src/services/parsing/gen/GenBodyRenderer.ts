import type { Span } from '../../lang/Diagnostic';
import { type EvalContext, EvalError } from '../../lang/ExprEvaluator';
import { type RenderedPart, renderInterpolation } from '../../lang/Interpolation';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';
import { type GenBody, type GenLine, indentDepth, isSpliceLine, leadingIndent } from './GenBodyParser';

/** One generated child line: its text, and how deep it sits under the parent. */
export interface RenderedChild {
    /** 1 is directly under the parent. */
    depth: number;
    /**
     * The line as it will be written, without indentation and **never
     * containing a newline**. A value that renders as several lines is split
     * here, where the indent rule already lives, so the writer keeps its one
     * element to one line.
     */
    body: string;
}

/**
 * What a block generates, or why it did not.
 *
 * A result rather than an exception because firing is two-phase: an
 * expression that fails produces no effects at all and leaves the command
 * unconsumed, so the caller needs the failure in hand before it writes
 * anything.
 */
export type GenRenderResult =
    | { ok: true; parentText: string | null; children: RenderedChild[] }
    | { ok: false; error: EvalError };

/**
 * Render a block's body into the lines of the next instance.
 *
 * The parent line comes back **as written in the block** — no flow clause is
 * attached here. The caller checks and normalizes it first and adds the
 * clause afterwards; the other order would have the check reject a `==>` the
 * engine itself had just written.
 *
 * A value that renders as several lines becomes several lines, which only
 * makes sense at the end of a line: text may lead into the first of them, but
 * text after the last has nowhere to go and is refused rather than guessed at.
 */
export function renderGenBody(body: GenBody, ctx: EvalContext): GenRenderResult {
    try {
        // Document order, parent line included. Today no expression has an
        // effect, so the order cannot be observed in the result — but cells
        // give lines assignment, and `${n = n + 1}` has to run in the order
        // the writer reads. Rendering the parent line first would move it.
        const ordered = body.parent === null ? body.children :
            [body.parent, ...body.children].sort((a, b) => a.line - b.line);
        const entries: RenderedEntry[] = [];
        for (const line of ordered) {
            if (line === body.parent) {
                entries.push({ depth: 0, body: renderParent(line, ctx), from: line });
            } else {
                entries.push(...renderChild(line, ctx));
            }
        }

        // What sits at depth 0 is only known now: a line that is nothing but
        // an interpolation is placed by its value, not by where it was typed.
        const roots = entries.filter(e => e.depth === 0);
        if (roots.length > 1) {
            throw new EvalError(
                'A block generates one task, and this produced more than one line at the top level',
                lineSpan(roots[1].from));
        }
        const parent = roots[0] ?? null;
        if (parent && !TaskLineClassifier.isTaskLine(parent.body)) {
            throw new EvalError(
                'The generated task must be a checkbox line',
                lineSpan(parent.from));
        }
        return {
            ok: true,
            parentText: parent?.body ?? null,
            children: entries.filter(e => e !== parent).map(({ depth, body: text }) => ({ depth, body: text })),
        };
    } catch (e) {
        if (e instanceof EvalError) return { ok: false, error: e };
        throw e;
    }
}

/** A rendered line, with the block line it came from for diagnostics. */
interface RenderedEntry extends RenderedChild {
    from: GenLine;
}

/**
 * The parent line. One firing generates one task, so a value of several lines
 * has nowhere to put the rest of itself here — said plainly, rather than
 * leaving the extra lines to fail later as "not a checkbox line".
 */
function renderParent(line: GenLine, ctx: EvalContext): string {
    const text = renderLine(line, ctx);
    if (text.includes('\n')) {
        throw new EvalError(
            'The generated task is one line — a value of several lines cannot go on it',
            { start: 0, end: line.text.length });
    }
    return text;
}

/**
 * A child line, and the lines a value brought with it.
 *
 * Each of those lines is placed relative to the line it landed on: its own
 * indentation becomes levels by the same rule the parser uses, added to the
 * depth of the host. Blank lines are dropped — a blank line ends the run of
 * children when the result is read back, so keeping one would truncate the
 * generated task.
 */
function renderChild(line: GenLine, ctx: EvalContext): RenderedEntry[] {
    const text = renderLine(line, ctx);
    // A line that is nothing but an interpolation has no text of its own, so
    // every line of the value is placed by its own indentation. A line that
    // mixes text and value keeps its first line where it was written, because
    // the text before the value is sitting there.
    const placeFirstByValue = isSpliceLine(line);
    if (!text.includes('\n') && !placeFirstByValue) {
        return [{ depth: line.depth, body: text, from: line }];
    }

    const out: RenderedEntry[] = [];
    text.split('\n').forEach((raw, i) => {
        if (raw.trim() === '') return;
        const own = i > 0 || placeFirstByValue ? indentDepth(leadingIndent(raw)) : 0;
        out.push({ depth: line.depth + own, body: raw.trimStart(), from: line });
    });
    return out;
}

function renderLine(line: GenLine, ctx: EvalContext): string {
    const parts = renderInterpolation(line.parts, ctx);
    const multiLineAt = parts.findIndex(p => p.fromExpr && p.text.includes('\n'));
    if (multiLineAt !== -1 && hasTextAfter(parts, multiLineAt)) {
        throw new EvalError(
            'A value of several lines has to end the line — there is text after it',
            spanOf(line, multiLineAt));
    }
    return parts.map(p => p.text).join('');
}

function hasTextAfter(parts: RenderedPart[], index: number): boolean {
    return parts.slice(index + 1).some(p => p.text.trim() !== '');
}

/** Where to point when a part is at fault: its own span, or the whole line. */
function spanOf(line: GenLine, index: number): Span {
    const part = line.parts[index];
    return part?.kind === 'expr' ? part.span : lineSpan(line);
}

function lineSpan(line: GenLine): Span {
    return { start: 0, end: line.text.length };
}
