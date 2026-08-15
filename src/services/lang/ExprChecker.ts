import { type Diagnostic, error } from './Diagnostic';
import type { Expr, PropName } from './ExprAst';
import { FN_SIGS, type StaticType, isAssignable, isDatishType } from './functions';

/** Static types of the property references available in an evaluation context. */
export type TypeEnv = Partial<Record<PropName, StaticType>>;

/** The environment used for flow commands (at()/set() expressions). */
export const FLOW_TYPE_ENV: TypeEnv = {
    start: 'datish',
    end: 'datish',
    due: 'datish',
    content: 'string',
    'file.name': 'string',
    /** Completion date+time. Arithmetic on it carries the time along. */
    done: 'datetime',
    /** Completion calendar date (no time) — for day-granular offsets. */
    today: 'date',
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
                diagnostics.push(error('type.unknown-property', `Property '${expr.name}' is not available here`, expr.span, { name: expr.name }));
                return 'error';
            }
            return t;
        }

        case 'unary': {
            const t = checkExpr(expr.operand, env, diagnostics);
            if (t === 'error') return 'error';
            if (expr.op === '!') {
                if (t !== 'bool') {
                    diagnostics.push(error('type.bang-expects-bool', `'!' expects bool, got ${t}`, expr.span, { actual: t }));
                    return 'error';
                }
                return 'bool';
            }
            if (t !== 'number' && t !== 'duration') {
                diagnostics.push(error('type.unary-minus-operand', `Unary '-' expects number or duration, got ${t}`, expr.span, { actual: t }));
                return 'error';
            }
            return t;
        }

        case 'member':
        case 'method': {
            const ot = checkExpr(expr.obj, env, diagnostics);
            if (ot === 'error') return 'error';
            const argTypes = expr.kind === 'method'
                ? expr.args.map(a => checkExpr(a, env, diagnostics))
                : [];
            if (argTypes.includes('error')) return 'error';
            const sig = memberSignature(ot, expr.name, expr.kind === 'method');
            if (!sig) {
                diagnostics.push(error('type.unknown-member',
                    `${ot} has no ${expr.kind === 'method' ? 'method' : 'property'} '${expr.name}'`,
                    expr.span, { receiver: ot, name: expr.name }));
                return 'error';
            }
            // Both ends of the range. A missing required argument used to reach
            // the evaluator, so `start.format()` failed at firing time — the
            // moment the user completed the task, not while writing it.
            if (expr.kind === 'method' && (argTypes.length < sig.minArgs || argTypes.length > sig.params.length)) {
                const range = sig.minArgs === sig.params.length ? `${sig.minArgs}` : `${sig.minArgs}-${sig.params.length}`;
                diagnostics.push(error('type.member-arity',
                    `'${expr.name}' takes ${range} argument(s), got ${argTypes.length}`,
                    expr.span, { name: expr.name, expected: range, actual: argTypes.length }));
                return 'error';
            }
            for (let i = 0; i < argTypes.length; i++) {
                if (argTypes[i] !== sig.params[i]) {
                    diagnostics.push(error('type.member-arg',
                        `'${expr.name}' expects ${sig.params[i]} for argument ${i + 1}, got ${argTypes[i]}`,
                        expr.kind === 'method' ? expr.args[i].span : expr.span,
                        { name: expr.name, index: i + 1, expected: sig.params[i], actual: argTypes[i] }));
                    return 'error';
                }
            }
            return sig.result;
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
                diagnostics.push(error('type.cond-not-bool', `Condition must be bool, got ${ct}`, expr.cond.span, { actual: ct }));
            }
            const tt = checkExpr(expr.then, env, diagnostics);
            const et = checkExpr(expr.else, env, diagnostics);
            if (tt === 'error' || et === 'error') return 'error';
            const unified = unifyTypes(tt, et);
            if (unified) return unified;
            diagnostics.push(error('type.branch-mismatch', `Conditional branches have different types (${tt} vs ${et})`, expr.span, { thenType: tt, elseType: et }));
            return 'error';
        }

        case 'call': {
            const sig = FN_SIGS[expr.fn];
            if (expr.args.length < sig.minArgs || expr.args.length > sig.params.length) {
                const range = sig.minArgs === sig.params.length ? `${sig.minArgs}` : `${sig.minArgs}-${sig.params.length}`;
                diagnostics.push(error('type.arg-count', `${expr.fn}() expects ${range} argument(s), got ${expr.args.length}`, expr.span,
                    { fn: expr.fn, expected: range, actual: expr.args.length }));
                return 'error';
            }
            let ok = true;
            expr.args.forEach((arg, i) => {
                const at = checkExpr(arg, env, diagnostics);
                if (at !== 'error' && !isAssignable(at, sig.params[i])) {
                    diagnostics.push(error('type.arg-mismatch', `${expr.fn}() argument ${i + 1} expects ${sig.params[i]}, got ${at}`, arg.span,
                        { fn: expr.fn, index: i + 1, expected: sig.params[i], actual: at }));
                    ok = false;
                }
            });
            const extra = sig.checkArgs?.(expr.args);
            if (extra) {
                diagnostics.push(error(extra.code, extra.message, extra.span, extra.params));
                ok = false;
            }
            return ok ? sig.result : 'error';
        }
    }
}

/**
 * The single type two alternatives settle on, or null when they do not meet.
 * `none` is the missing-value type, so it takes the shape of the other side.
 */
function unifyTypes(a: StaticType, b: StaticType): StaticType | null {
    if (a === b) return a;
    if (a === 'none') return b;
    if (b === 'none') return a;
    if (isDatishType(a) && isDatishType(b)) return 'datish';
    return null;
}

function checkBinary(
    expr: Expr & { kind: 'binary' },
    lt: StaticType,
    rt: StaticType,
    diagnostics: Diagnostic[]
): StaticType {
    const { op } = expr;
    const fail = (code: string, msg: string, params: Diagnostic['params']): StaticType => {
        diagnostics.push(error(code, msg, expr.span, params));
        return 'error';
    };

    if (op === '&&' || op === '||') {
        return lt === 'bool' && rt === 'bool'
            ? 'bool'
            : fail('type.logic-expects-bool', `'${op}' expects bool operands, got ${lt} and ${rt}`, { op, left: lt, right: rt });
    }

    // `a ?? b` yields whichever side survives, so both sides must land on one
    // type — the same unification a conditional needs.
    if (op === '??') {
        return unifyTypes(lt, rt)
            ?? fail('type.nullish-mismatch', `'??' sides have different types (${lt} vs ${rt})`, { left: lt, right: rt });
    }

    if (op === '*' || op === '/' || op === '%') {
        if (lt === 'number' && rt === 'number') return 'number';
        // duration scaling: gap * 2 / 2 * gap / gap / 2 — the adaptive-interval shape
        // Scaling keeps the unit, so it means the same for 1d and 24h. The
        // remainder does not: 1d % 2 is 1d while 24h % 2 is 0h, though the two
        // durations are the same length. Refuse rather than pick a unit.
        if (op !== '%' && lt === 'duration' && rt === 'number') return 'duration';
        if (op === '*' && lt === 'number' && rt === 'duration') return 'duration';
        return fail('type.cannot-combine', `'${op}' cannot combine ${lt} and ${rt}`, { op, left: lt, right: rt });
    }

    if (op === '+' || op === '-') {
        if (isDatishType(lt) && rt === 'duration') return lt;
        if (op === '+' && lt === 'duration' && isDatishType(rt)) return rt;
        if (lt === 'duration' && rt === 'duration') return 'duration';
        if (lt === 'number' && rt === 'number') return 'number';
        if ((lt === 'time' && rt === 'duration') || (lt === 'duration' && rt === 'time')) {
            return fail('type.time-arithmetic',
                'Time arithmetic is not supported — apply duration to a date first: time(start + 2h)',
                { left: lt, right: rt });
        }
        // date + time attaches a time-of-day. Only plain dates qualify —
        // adding a time to a datetime would be ambiguous (add vs replace),
        // so datetime/datish operands must be truncated first via date(x).
        if (op === '+' && lt === 'date' && rt === 'time') return 'datetime';
        if (op === '+' && isDatishType(lt) && rt === 'time') {
            return fail('type.datetime-plus-time',
                `Adding a time to a ${lt} is ambiguous — truncate first: date(x) + 14:00`, { left: lt });
        }
        // Links coerce to their target text in concatenation (move([[Log/]] + file.name))
        const stringish = (t: StaticType) => t === 'string' || t === 'link';
        if (op === '+' && stringish(lt) && stringish(rt)) return 'string';
        return fail('type.cannot-combine', `'${op}' cannot combine ${lt} and ${rt}`, { op, left: lt, right: rt });
    }

    // Comparisons
    const comparable =
        (isDatishType(lt) && isDatishType(rt)) ||
        lt === rt;
    if (!comparable) return fail('type.cannot-compare', `Cannot compare ${lt} with ${rt}`, { left: lt, right: rt });
    return 'bool';
}


/**
 * Members and methods a value carries, by receiver type.
 *
 * Kept as data rather than branches so the checker and the evaluator can be
 * read against each other: every entry here has a case there, and a member
 * that is missing from one is visible as a hole in the other.
 */
interface MemberSig {
    params: StaticType[];
    /** Arguments that must be present. Positions beyond this are optional. */
    minArgs: number;
    result: StaticType;
}

const DATE_METHODS: Record<string, MemberSig> = {
    format: { params: ['string'], minArgs: 1, result: 'string' },
    weekday: { params: [], minArgs: 0, result: 'string' },
};

const STRING_MEMBERS: Record<string, MemberSig> = {
    length: { params: [], minArgs: 0, result: 'number' },
};

const STRING_METHODS: Record<string, MemberSig> = {
    includes: { params: ['string'], minArgs: 1, result: 'bool' },
    startsWith: { params: ['string'], minArgs: 1, result: 'bool' },
    endsWith: { params: ['string'], minArgs: 1, result: 'bool' },
    indexOf: { params: ['string'], minArgs: 1, result: 'number' },
    slice: { params: ['number', 'number'], minArgs: 0, result: 'string' },
    padStart: { params: ['number', 'string'], minArgs: 1, result: 'string' },
    replace: { params: ['string', 'string'], minArgs: 2, result: 'string' },
    replaceAll: { params: ['string', 'string'], minArgs: 2, result: 'string' },
    trim: { params: [], minArgs: 0, result: 'string' },
    toUpperCase: { params: [], minArgs: 0, result: 'string' },
    toLowerCase: { params: [], minArgs: 0, result: 'string' },
};

const NUMBER_METHODS: Record<string, MemberSig> = {
    toFixed: { params: ['number'], minArgs: 0, result: 'string' },
};

export function memberSignature(receiver: StaticType, name: string, isMethod: boolean): MemberSig | null {
    if (receiver === 'string') {
        return (isMethod ? STRING_METHODS[name] : STRING_MEMBERS[name]) ?? null;
    }
    // 'datish' covers a property whose concrete date type is not known until
    // evaluation; date methods apply to it just the same.
    if (isMethod && isDatishType(receiver)) return DATE_METHODS[name] ?? null;
    if (isMethod && receiver === 'number') return NUMBER_METHODS[name] ?? null;
    return null;
}
