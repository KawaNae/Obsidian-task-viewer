import type { Span } from '../../lang/Diagnostic';
import { type EvalContext, EvalError } from '../../lang/ExprEvaluator';
import { type RenderedPart, renderInterpolation } from '../../lang/Interpolation';
import { type GenBody, type GenLine, indentDepth, leadingIndent } from './GenBodyParser';

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
        const parentText = body.parent === null ? null : renderParent(body.parent, ctx);
        const children = body.children.flatMap(line => renderChild(line, ctx));
        return { ok: true, parentText, children };
    } catch (e) {
        if (e instanceof EvalError) return { ok: false, error: e };
        throw e;
    }
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
function renderChild(line: GenLine, ctx: EvalContext): RenderedChild[] {
    const text = renderLine(line, ctx);
    if (!text.includes('\n')) return [{ depth: line.depth, body: text }];

    const [first, ...rest] = text.split('\n');
    const out: RenderedChild[] = [{ depth: line.depth, body: first }];
    for (const raw of rest) {
        if (raw.trim() === '') continue;
        out.push({ depth: line.depth + indentDepth(leadingIndent(raw)), body: raw.trimStart() });
    }
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
    return part?.kind === 'expr' ? part.span : { start: 0, end: line.text.length };
}
