import type { Span } from '../../lang/Diagnostic';
import { type EvalContext, EvalError } from '../../lang/ExprEvaluator';
import { type RenderedPart, renderInterpolation } from '../../lang/Interpolation';
import type { GenBody, GenLine } from './GenBodyParser';

/** One generated child line: its text, and how deep it sits under the parent. */
export interface RenderedChild {
    /** 1 is directly under the parent. */
    depth: number;
    /** The line as it will be written, without indentation. */
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
        const parentText = body.parent === null ? null : renderLine(body.parent, ctx);
        const children = body.children.map(line => ({
            depth: line.depth,
            body: renderLine(line, ctx),
        }));
        return { ok: true, parentText, children };
    } catch (e) {
        if (e instanceof EvalError) return { ok: false, error: e };
        throw e;
    }
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
