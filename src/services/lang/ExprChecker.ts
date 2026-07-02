import { Diagnostic, error } from './Diagnostic';
import { Expr, PropName } from './ExprAst';
import { FN_SIGS, StaticType, isAssignable, isDatishType } from './functions';

/** Static types of the property references available in an evaluation context. */
export type TypeEnv = Partial<Record<PropName, StaticType>>;

/** The environment used for flow commands (at()/set() expressions). */
export const FLOW_TYPE_ENV: TypeEnv = {
    start: 'datish',
    end: 'datish',
    due: 'datish',
    content: 'string',
    'file.name': 'string',
    done: 'datetime',
};

/**
 * Parse-time type check. Emits diagnostics and returns the expression's
 * static type; 'error' poisons upward so one mistake reports once.
 */
export function checkExpr(expr: Expr, env: TypeEnv, diagnostics: Diagnostic[]): StaticType {
    switch (expr.kind) {
        case 'lit':
            return expr.value.type;

        case 'prop': {
            const t = env[expr.name];
            if (t === undefined) {
                diagnostics.push(error('type.unknown-property', `Property '${expr.name}' is not available here`, expr.span));
                return 'error';
            }
            return t;
        }

        case 'unary': {
            const t = checkExpr(expr.operand, env, diagnostics);
            if (t === 'error') return 'error';
            if (expr.op === '!') {
                if (t !== 'bool') {
                    diagnostics.push(error('type.mismatch', `'!' expects bool, got ${t}`, expr.span));
                    return 'error';
                }
                return 'bool';
            }
            if (t !== 'number' && t !== 'duration') {
                diagnostics.push(error('type.mismatch', `Unary '-' expects number or duration, got ${t}`, expr.span));
                return 'error';
            }
            return t;
        }

        case 'binary': {
            const lt = checkExpr(expr.left, env, diagnostics);
            const rt = checkExpr(expr.right, env, diagnostics);
            if (lt === 'error' || rt === 'error') return 'error';
            return checkBinary(expr, lt, rt, diagnostics);
        }

        case 'cond': {
            const ct = checkExpr(expr.cond, env, diagnostics);
            if (ct !== 'bool' && ct !== 'error') {
                diagnostics.push(error('type.mismatch', `Condition must be bool, got ${ct}`, expr.cond.span));
            }
            const tt = checkExpr(expr.then, env, diagnostics);
            const et = checkExpr(expr.else, env, diagnostics);
            if (tt === 'error' || et === 'error') return 'error';
            if (tt === et) return tt;
            if (isDatishType(tt) && isDatishType(et)) return 'datish';
            diagnostics.push(error('type.mismatch', `Conditional branches have different types (${tt} vs ${et})`, expr.span));
            return 'error';
        }

        case 'call': {
            const sig = FN_SIGS[expr.fn];
            if (expr.args.length < sig.minArgs || expr.args.length > sig.params.length) {
                const range = sig.minArgs === sig.params.length ? `${sig.minArgs}` : `${sig.minArgs}-${sig.params.length}`;
                diagnostics.push(error('type.arg-count', `${expr.fn}() expects ${range} argument(s), got ${expr.args.length}`, expr.span));
                return 'error';
            }
            let ok = true;
            expr.args.forEach((arg, i) => {
                const at = checkExpr(arg, env, diagnostics);
                if (at !== 'error' && !isAssignable(at, sig.params[i])) {
                    diagnostics.push(error('type.mismatch', `${expr.fn}() argument ${i + 1} expects ${sig.params[i]}, got ${at}`, arg.span));
                    ok = false;
                }
            });
            const extra = sig.checkArgs?.(expr.args);
            if (extra) {
                diagnostics.push(error('type.bad-argument', extra.message, extra.span));
                ok = false;
            }
            return ok ? sig.result : 'error';
        }
    }
}

function checkBinary(
    expr: Expr & { kind: 'binary' },
    lt: StaticType,
    rt: StaticType,
    diagnostics: Diagnostic[]
): StaticType {
    const { op } = expr;
    const fail = (msg: string): StaticType => {
        diagnostics.push(error('type.mismatch', msg, expr.span));
        return 'error';
    };

    if (op === '&&' || op === '||') {
        return lt === 'bool' && rt === 'bool' ? 'bool' : fail(`'${op}' expects bool operands, got ${lt} and ${rt}`);
    }

    if (op === '+' || op === '-') {
        if (isDatishType(lt) && rt === 'duration') return lt;
        if (op === '+' && lt === 'duration' && isDatishType(rt)) return rt;
        if (lt === 'duration' && rt === 'duration') return 'duration';
        if (lt === 'number' && rt === 'number') return 'number';
        if (op === '+' && lt === 'string' && rt === 'string') return 'string';
        return fail(`'${op}' cannot combine ${lt} and ${rt}`);
    }

    // Comparisons
    const comparable =
        (isDatishType(lt) && isDatishType(rt)) ||
        lt === rt;
    if (!comparable) return fail(`Cannot compare ${lt} with ${rt}`);
    return 'bool';
}
