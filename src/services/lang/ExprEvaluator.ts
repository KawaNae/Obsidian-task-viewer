import { Span } from './Diagnostic';
import { Expr, PropName } from './ExprAst';
import { EvalRuntime, FnCallError, callFn } from './functions';
import { Value, addDuration, compareValues, isDatishValue } from './Value';

/**
 * Runtime evaluation failure (e.g. a referenced property is unset on the
 * task at fire time). The planner treats this as "do not fire": effects are
 * abandoned and the command is left intact for the user to fix.
 */
export class EvalError extends Error {
    constructor(message: string, public readonly span: Span) {
        super(message);
    }
}

export interface EvalContext extends EvalRuntime {
    /** Property snapshot the expression evaluates against. */
    props: Partial<Record<PropName, Value>>;
}

export function evalExpr(expr: Expr, ctx: EvalContext): Value {
    switch (expr.kind) {
        case 'lit':
            return expr.value;

        case 'prop': {
            const v = ctx.props[expr.name];
            if (v === undefined) {
                throw new EvalError(`Property '${expr.name}' is not set on this task`, expr.span);
            }
            return v;
        }

        case 'unary': {
            const v = evalExpr(expr.operand, ctx);
            if (expr.op === '!') {
                if (v.type !== 'bool') throw new EvalError(`'!' expects bool, got ${v.type}`, expr.span);
                return { type: 'bool', value: !v.value };
            }
            if (v.type === 'number') return { type: 'number', value: -v.value };
            if (v.type === 'duration') return { type: 'duration', amount: -v.amount, unit: v.unit };
            throw new EvalError(`Unary '-' expects number or duration, got ${v.type}`, expr.span);
        }

        case 'binary':
            return evalBinary(expr, ctx);

        case 'cond': {
            const c = evalExpr(expr.cond, ctx);
            if (c.type !== 'bool') throw new EvalError(`Condition must be bool, got ${c.type}`, expr.cond.span);
            return evalExpr(c.value ? expr.then : expr.else, ctx);
        }

        case 'call': {
            const args = expr.args.map(a => evalExpr(a, ctx));
            try {
                return callFn(expr.fn, args, ctx);
            } catch (e) {
                if (e instanceof FnCallError) throw new EvalError(e.message, expr.span);
                throw e;
            }
        }
    }
}

function evalBinary(expr: Expr & { kind: 'binary' }, ctx: EvalContext): Value {
    const { op, span } = expr;

    // Short-circuit logicals
    if (op === '&&' || op === '||') {
        const l = evalExpr(expr.left, ctx);
        if (l.type !== 'bool') throw new EvalError(`'${op}' expects bool, got ${l.type}`, expr.left.span);
        if (op === '&&' && !l.value) return { type: 'bool', value: false };
        if (op === '||' && l.value) return { type: 'bool', value: true };
        const r = evalExpr(expr.right, ctx);
        if (r.type !== 'bool') throw new EvalError(`'${op}' expects bool, got ${r.type}`, expr.right.span);
        return r;
    }

    const l = evalExpr(expr.left, ctx);
    const r = evalExpr(expr.right, ctx);

    if (op === '+' || op === '-') {
        const sign = op === '+' ? 1 : -1;
        if (isDatishValue(l) && r.type === 'duration') return addDuration(l, r, sign as 1 | -1);
        if (op === '+' && l.type === 'duration' && isDatishValue(r)) return addDuration(r, l, 1);
        if (l.type === 'duration' && r.type === 'duration') {
            if (l.unit === r.unit) return { type: 'duration', amount: l.amount + sign * r.amount, unit: l.unit };
            const lm = minutesOrThrow(l, span);
            const rm = minutesOrThrow(r, span);
            return { type: 'duration', amount: lm + sign * rm, unit: 'min' };
        }
        if (l.type === 'number' && r.type === 'number') return { type: 'number', value: l.value + sign * r.value };
        if (op === '+' && l.type === 'string' && r.type === 'string') return { type: 'string', value: l.value + r.value };
        throw new EvalError(`'${op}' cannot combine ${l.type} and ${r.type}`, span);
    }

    // Comparisons
    if (op === '==' || op === '!=') {
        const cmp = compareValues(l, r);
        const equal = cmp === 0;
        return { type: 'bool', value: op === '==' ? equal : !equal };
    }
    const cmp = compareValues(l, r);
    if (cmp === null) throw new EvalError(`Cannot compare ${l.type} with ${r.type}`, span);
    switch (op) {
        case '<': return { type: 'bool', value: cmp < 0 };
        case '<=': return { type: 'bool', value: cmp <= 0 };
        case '>': return { type: 'bool', value: cmp > 0 };
        default: return { type: 'bool', value: cmp >= 0 };
    }
}

function minutesOrThrow(dur: Value & { type: 'duration' }, span: Span): number {
    const factors: Partial<Record<string, number>> = { min: 1, h: 60, d: 1440, w: 10080 };
    const f = factors[dur.unit];
    if (f === undefined) throw new EvalError(`Cannot mix '${dur.unit}' with other duration units`, span);
    return dur.amount * f;
}
