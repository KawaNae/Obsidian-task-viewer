import type { InterpolationPart } from './ExprAst';
import { type EvalContext, evalExpr } from './ExprEvaluator';
import { type Value, valueToDisplay } from './Value';

export type { InterpolationPart };

/** One rendered piece of a line, with where its text came from. */
export interface RenderedPart {
    text: string;
    /**
     * True when this came from an expression. Lets a caller tell a newline
     * someone typed from one a value brought with it.
     */
    fromExpr: boolean;
    value?: Value;
}

/**
 * Evaluate the expressions of an interpolated line and hand back the pieces.
 *
 * Pieces rather than one string: a value can be several lines — a list renders
 * one line per element — and whether that is allowed depends on where it
 * landed. That decision belongs to the writer, which knows the indentation it
 * is splicing into and can refuse a multi-line value in the middle of a line.
 *
 * Splitting the line is {@link splitInterpolations} in the parser; this is the
 * other half, and the two are used together by the generation stage.
 */
export function renderInterpolation(parts: InterpolationPart[], ctx: EvalContext): RenderedPart[] {
    return parts.map(part => {
        if (part.kind === 'text') return { text: part.text, fromExpr: false };
        const value = evalExpr(part.expr, ctx);
        return { text: valueToDisplay(value), fromExpr: true, value };
    });
}

/** The whole line as text, for callers with nothing to decide. */
export function renderInterpolationText(parts: InterpolationPart[], ctx: EvalContext): string {
    return renderInterpolation(parts, ctx).map(p => p.text).join('');
}
