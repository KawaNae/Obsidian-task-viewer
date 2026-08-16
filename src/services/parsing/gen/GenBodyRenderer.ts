import type { Span } from '../../lang/Diagnostic';
import { type EvalContext, EvalError } from '../../lang/ExprEvaluator';
import { type RenderedPart, renderInterpolation } from '../../lang/Interpolation';
import { type CellStore, type Scope, SECTION_FUEL, cellScope, execProgram } from '../../lang/StmtEvaluator';
import type { Value } from '../../lang/Value';
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
    | {
        ok: true;
        parentText: string | null;
        children: RenderedChild[];
        /**
         * What the cells came to. Empty when the command declares none.
         *
         * Handed back rather than left on the store the caller passed in: a
         * result the caller reads only after `ok` is what keeps a failed
         * render from moving the state, and a map it already holds would be
         * read without that question being asked.
         */
        cells: ReadonlyMap<string, Value>;
    }
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
export function renderGenBody(body: GenBody, outerCtx: EvalContext): GenRenderResult {
    try {
        // The section runs first because it is written first — the whole of
        // the evaluation order is that one sentence, and the body reads the
        // scope it leaves behind.
        const ctx: EvalContext = { ...outerCtx, fuel: { left: SECTION_FUEL, depth: 0 } };
        // The cells are a frame of their own, and the body reads it whether or
        // not a section was written: a one-line counter block has nowhere else
        // to bind `n`, and it is the shape the design leads with.
        const cells = outerCtx.cells?.size ? cellScope(outerCtx.cells, outerCtx.vars) : null;
        if (body.js) ctx.scope = execProgram(body.js.program, ctx, cells);
        else if (cells) ctx.scope = cells;

        // Document order, parent line included: `${n = n + 1}` has to run in
        // the order the writer reads. Rendering the parent line first would
        // move it.
        const ordered = body.parent === null ? body.children :
            [body.parent, ...body.children].sort((a, b) => a.line - b.line);
        const entries: RenderedEntry[] = [];
        for (const line of ordered) {
            const before = entries.length;
            if (line === body.parent) {
                entries.push({ depth: 0, body: renderParent(line, ctx), from: line });
            } else {
                entries.push(...renderChild(line, ctx));
            }
            checkSize(entries, before);
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
            cells: finalCells(outerCtx.cells, cells),
        };
    } catch (e) {
        if (e instanceof EvalError) return { ok: false, error: e };
        // The host's stack, not this language's budget. Every shape that can
        // reach it is refused while it is written, so arriving here means one
        // was missed — and a raw RangeError leaving this function is not a
        // failed fire but a broken read, in the editor as much as in a fire.
        // Answering as a failure keeps the one rule: nothing is written and
        // the command is not consumed.
        if (e instanceof RangeError) {
            return {
                ok: false,
                error: new EvalError(
                    'This expression is too deep to evaluate — break it up',
                    { start: 0, end: 0 }),
            };
        }
        throw e;
    }
}

/**
 * The cells as the render leaves them.
 *
 * Read from the cell frame by the names the command declared, so a name the
 * section introduced is not mistaken for state: only what the flow line
 * carries is carried on.
 */
function finalCells(declared: CellStore | undefined, frame: Scope | null): ReadonlyMap<string, Value> {
    const out = new Map<string, Value>();
    if (!declared) return out;
    for (const [name, initial] of declared) out.set(name, frame?.lookup(name) ?? initial);
    return out;
}

/** A rendered line, with the block line it came from for diagnostics. */
interface RenderedEntry extends RenderedChild {
    from: GenLine;
}

/**
 * What one generation is allowed to produce.
 *
 * Two numbers here and one next to the evaluator, because a section can run
 * away in more than one way: computing forever, writing forever, or nesting
 * forever. None of them is decidable in advance — that is the halting problem
 * — so each is a ceiling that only an already-broken block can reach. A
 * weekly checklist is ten to thirty lines and a few hundred steps.
 */
const MAX_LINES = 200;
const MAX_DEPTH = 10;

/**
 * Refuse a result that has grown past what a task can be.
 *
 * Checked as the lines appear rather than at the end, so a loop writing lines
 * forever stops at the ceiling instead of building the whole of it in memory
 * first.
 *
 * `from` is where the last source line was, and the whole run added by it is
 * measured: one source line becomes several when its value has several, and
 * each of those reads its own indentation as a depth. Looking only at the one
 * that happens to be last would let a deep line through whenever a shallow
 * one followed it.
 */
function checkSize(entries: RenderedEntry[], from: number): void {
    if (entries.length > MAX_LINES) {
        throw new EvalError(
            `This block generated more than ${MAX_LINES} lines, which is past what one task can be`,
            lineSpan(entries[entries.length - 1].from));
    }
    for (const entry of entries.slice(from)) {
        if (entry.depth > MAX_DEPTH) {
            throw new EvalError(
                `This line sits ${entry.depth} levels deep, past the ${MAX_DEPTH} a task can hold`,
                lineSpan(entry.from));
        }
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
