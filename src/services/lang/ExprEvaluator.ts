import type { Span } from './Diagnostic';
import { type Expr, type PropName, isExprBody } from './ExprAst';
import { type EvalRuntime, FnCallError, callFn } from './functions';
import {
    type DurUnit, type Value, WEEKDAY_NAMES, addDuration, compareValues, isDatishValue, parseDateStr,
    DECIMAL_SCALE, MAX_EXACT_FRACTION, recordField, valueToDisplay,
} from './Value';

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
    /**
     * Names bound by enclosing arrow parameters. Rebound per element rather
     * than mutated, so a list method cannot leak a binding to its caller.
     */
    vars?: ReadonlyMap<string, Value>;
}

export function evalExpr(expr: Expr, ctx: EvalContext): Value {
    switch (expr.kind) {
        case 'lit':
            return expr.value;

        case 'assign':
            // Lands with the js section's evaluator, which owns the mutable
            // environment an assignment writes. Until then it fails the
            // evaluation — two-phase, so nothing is half-written.
            throw new EvalError('An assignment is not available here yet', expr.span);

        case 'call-local':
            // Needs the js section's scope chain to find what the name is
            // bound to. Same two-phase shape as an assignment: fail rather
            // than guess.
            throw new EvalError(`Calling '${expr.name}' is not available here yet`, expr.span);

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

        case 'var': {
            const v = ctx.vars?.get(expr.name);
            if (v === undefined) throw new EvalError(`'${expr.name}' is not bound here`, expr.span);
            return v;
        }

        case 'array': {
            const items: Value[] = [];
            for (const item of expr.items) {
                if (item.kind !== 'spread') {
                    items.push(evalExpr(item, ctx));
                    continue;
                }
                const inner = evalExpr(item.arg, ctx);
                if (inner.type !== 'array') throw new EvalError(`A spread needs a list, got ${inner.type}`, item.span);
                items.push(...inner.items);
            }
            return { type: 'array', items };
        }

        case 'record':
            return {
                type: 'record',
                entries: expr.entries.map(e => ({ key: e.key, value: evalExpr(e.value, ctx) })),
            };

        case 'spread':
            throw new EvalError('A spread only means something inside a list', expr.span);

        case 'index': {
            const obj = evalExpr(expr.obj, ctx);
            if (obj.type === 'none') {
                if (expr.optional) return { type: 'none' };
                throw new EvalError('Cannot index none', expr.span);
            }
            const i = evalExpr(expr.index, ctx);
            if (obj.type === 'record') {
                if (i.type !== 'string') throw new EvalError(`A record is indexed by a string, got ${i.type}`, expr.index.span);
                // A field that is not there is a missing value, like reading
                // past the end of a list — `??` covers both.
                return recordField(obj, i.value) ?? { type: 'none' };
            }
            if (obj.type !== 'array') throw new EvalError(`${obj.type} cannot be indexed`, expr.span);
            if (i.type !== 'number') throw new EvalError(`A list index is a number, got ${i.type}`, expr.index.span);
            // Past the end is a missing value, not a failure — `??` covers it.
            return obj.items[i.value] ?? { type: 'none' };
        }

        case 'template': {
            const text = expr.parts
                .map(part => part.kind === 'text' ? part.text : valueToDisplay(evalExpr(part.expr, ctx)))
                .join('');
            return { type: 'string', value: text };
        }

        case 'arrow':
            throw new EvalError('A function only means something as an argument to a list method', expr.span);

        case 'member':
        case 'method': {
            const obj = evalExpr(expr.obj, ctx);
            // `?.` short-circuits on a missing value; a plain dot on one is an
            // error, as in JS.
            if (obj.type === 'none') {
                if (expr.optional) return { type: 'none' };
                throw new EvalError(`Cannot read '${expr.name}' of none`, expr.span);
            }
            // A list method is handed the function itself, not its value: the
            // parameters are bound per element inside.
            if (obj.type === 'array') return callListMember(obj, expr, ctx);
            if (obj.type === 'record') {
                if (expr.kind === 'method') throw new EvalError(`A record has no method '${expr.name}'`, expr.span);
                return recordField(obj, expr.name) ?? { type: 'none' };
            }
            const args = expr.kind === 'method' ? expr.args.map(a => evalExpr(a, ctx)) : [];
            return callMember(obj, expr.name, args, ctx, expr.span);
        }
    }
}

/**
 * Members and methods of a list. Mirrors the list branch of the checker —
 * every method typed there has a case here.
 */
function callListMember(
    list: Value & { type: 'array' },
    expr: Expr & { kind: 'member' | 'method' },
    ctx: EvalContext
): Value {
    const { name, span } = expr;
    const items = list.items;
    if (expr.kind === 'member') {
        if (name === 'length') return { type: 'number', value: items.length };
        throw new EvalError(`A list has no property '${name}'`, span);
    }

    const argExprs = expr.args;
    const num = (i: number): Value => ({ type: 'number', value: i });

    /** Apply the function argument to one element. */
    const apply = (fnExpr: Expr, values: Value[]): Value => {
        if (fnExpr.kind !== 'arrow') throw new EvalError(`'${name}' expects a function`, fnExpr.span);
        if (!isExprBody(fnExpr.body)) {
            // Runs on the statement evaluator, wired with the js section.
            throw new EvalError('A function with a { } body is not available here yet', fnExpr.span);
        }
        const bound = new Map(ctx.vars ?? []);
        fnExpr.params.forEach((p, i) => bound.set(p, values[i] ?? { type: 'none' }));
        return evalExpr(fnExpr.body, { ...ctx, vars: bound });
    };
    const test = (v: Value, i: number): boolean => {
        const r = apply(argExprs[0], [v, num(i)]);
        if (r.type !== 'bool') {
            throw new EvalError(`'${name}' expects a function returning bool, got ${r.type}`, argExprs[0].span);
        }
        return r.value;
    };
    const arg = (i: number): Value | undefined =>
        argExprs[i] === undefined ? undefined : evalExpr(argExprs[i], ctx);

    switch (name) {
        case 'map':
            return { type: 'array', items: items.map((v, i) => apply(argExprs[0], [v, num(i)])) };
        case 'filter':
            return { type: 'array', items: items.filter(test) };
        case 'find':
            return items.find(test) ?? { type: 'none' };
        case 'some':
            return { type: 'bool', value: items.some(test) };
        case 'every':
            return { type: 'bool', value: items.every(test) };
        case 'forEach':
            items.forEach((v, i) => apply(argExprs[0], [v, num(i)]));
            return { type: 'none' };
        case 'sort': {
            // A new list either way: sorting in place would be the one
            // mutation, and lists here do not have one.
            const copy = [...items];
            if (argExprs.length === 0) {
                return { type: 'array', items: copy.sort((a, b) => valueToDisplay(a).localeCompare(valueToDisplay(b))) };
            }
            return {
                type: 'array',
                items: copy.sort((a, b) => {
                    const r = apply(argExprs[0], [a, b]);
                    if (r.type !== 'number') {
                        throw new EvalError(`'sort' expects a function returning number, got ${r.type}`, argExprs[0].span);
                    }
                    return r.value;
                }),
            };
        }
        case 'join': {
            const sep = arg(0);
            return { type: 'string', value: items.map(valueToDisplay).join(sep === undefined ? ',' : valueToDisplay(sep)) };
        }
        case 'includes':
            return { type: 'bool', value: items.some(v => compareValues(v, arg(0)!) === 0) };
        case 'indexOf':
            return { type: 'number', value: items.findIndex(v => compareValues(v, arg(0)!) === 0) };
        case 'slice': {
            const from = arg(0);
            const to = arg(1);
            return {
                type: 'array',
                items: items.slice(
                    from?.type === 'number' ? wholeOrThrow(from.value, 'slice', span) : 0,
                    to?.type === 'number' ? wholeOrThrow(to.value, 'slice', span) : undefined
                ),
            };
        }
        case 'concat': {
            const other = arg(0);
            if (other?.type !== 'array') throw new EvalError(`'concat' expects a list`, span);
            return { type: 'array', items: [...items, ...other.items] };
        }
    }
    throw new EvalError(`A list has no method '${name}'`, span);
}

/**
 * Members and methods on a value. The set mirrors the signature table in the
 * checker — an entry that exists in one and not the other is a hole, so the
 * two are meant to be read side by side.
 */
function callMember(obj: Value, name: string, args: Value[], ctx: EvalContext, span: Span): Value {
    if (obj.type === 'string') {
        const s = obj.value;
        const str = (i: number) => {
            const a = args[i];
            return a !== undefined && a.type === 'string' ? a.value : '';
        };
        const num = (i: number, fallback: number) => {
            const a = args[i];
            return a !== undefined && a.type === 'number' ? a.value : fallback;
        };
        switch (name) {
            // UTF-16 units, as in JS. Code points would read better for emoji,
            // but then `length` and `indexOf`/`slice` would count in different
            // units and stop agreeing with each other.
            case 'length': return { type: 'number', value: s.length };
            case 'includes': return { type: 'bool', value: s.includes(str(0)) };
            case 'startsWith': return { type: 'bool', value: s.startsWith(str(0)) };
            case 'endsWith': return { type: 'bool', value: s.endsWith(str(0)) };
            case 'indexOf': return { type: 'number', value: s.indexOf(str(0)) };
            case 'slice': return { type: 'string', value: s.slice(wholeOrThrow(num(0, 0), 'slice', span), args.length > 1 ? wholeOrThrow(num(1, s.length), 'slice', span) : undefined) };
            case 'padStart': return { type: 'string', value: s.padStart(wholeOrThrow(num(0, 0), 'padStart', span), args.length > 1 ? str(1) : ' ') };
            // JS semantics: replace hits the first occurrence only. Delegating
            // to the real methods also keeps `$&` and friends behaving as a
            // reader of JS expects.
            case 'replace': return { type: 'string', value: s.replace(str(0), str(1)) };
            case 'replaceAll': return { type: 'string', value: s.replaceAll(str(0), str(1)) };
            case 'trim': return { type: 'string', value: s.trim() };
            case 'toUpperCase': return { type: 'string', value: s.toUpperCase() };
            case 'toLowerCase': return { type: 'string', value: s.toLowerCase() };
        }
    }

    if (isDatishValue(obj)) {
        if (name === 'format') {
            const tokens = args[0];
            if (tokens?.type !== 'string') throw new EvalError(`'format' expects a token string`, span);
            return { type: 'string', value: ctx.host.formatDate(obj, tokens.value, ctx.weekStartDay) };
        }
        if (name === 'weekday') {
            // Deliberately not routed through host.formatDate: these names are
            // compared against string literals in user expressions, so they
            // must stay the same seven identifiers in every locale.
            const date = obj.type === 'date' ? obj.value : obj.date;
            return { type: 'string', value: WEEKDAY_NAMES[parseDateStr(date).getDay()] };
        }
    }

    if (obj.type === 'number' && name === 'toFixed') {
        // No argument means zero digits, as in JS.
        const digits = args[0];
        if (digits !== undefined && digits.type !== 'number') throw new EvalError(`'toFixed' expects a number`, span);
        return { type: 'string', value: obj.value.toFixed(digits?.type === 'number' ? wholeOrThrow(digits.value, 'toFixed', span) : 0) };
    }

    throw new EvalError(`${obj.type} has no member '${name}'`, span);
}

function evalBinary(expr: Expr & { kind: 'binary' }, ctx: EvalContext): Value {
    const { op, span } = expr;

    // `a ?? b` — the right side is only reached when the left is missing.
    if (op === '??') {
        const l = evalExpr(expr.left, ctx);
        return l.type === 'none' ? evalExpr(expr.right, ctx) : l;
    }

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

    if (op === '*' || op === '/' || op === '%') {
        // duration scaling keeps the unit: `gap * 2` is the adaptive-interval shape.
        if (op !== '%' && l.type === 'duration' && r.type === 'number') {
            return scaledDuration(arith(op, l.amount, r.value, span), l.unit, span);
        }
        if (op === '*' && l.type === 'number' && r.type === 'duration') {
            return scaledDuration(arith(op, r.amount, l.value, span), r.unit, span);
        }
        if (l.type === 'number' && r.type === 'number') {
            return { type: 'number', value: arith(op, l.value, r.value, span) };
        }
        throw new EvalError(`'${op}' cannot combine ${l.type} and ${r.type}`, span);
    }

    if (op === '+' || op === '-') {
        const sign = op === '+' ? 1 : -1;
        if (isDatishValue(l) && r.type === 'duration') return addDuration(l, r, sign as 1 | -1);
        if (op === '+' && l.type === 'duration' && isDatishValue(r)) return addDuration(r, l, 1);
        if (op === '+' && l.type === 'date' && r.type === 'time') {
            return { type: 'datetime', date: l.value, time: r.value };
        }
        if (op === '+' && l.type === 'datetime' && r.type === 'time') {
            throw new EvalError('Adding a time to a datetime is ambiguous — truncate first: date(x) + 14:00', span);
        }
        if (l.type === 'duration' && r.type === 'duration') {
            if (l.unit === r.unit) return { type: 'duration', amount: l.amount + sign * r.amount, unit: l.unit };
            const lm = minutesOrThrow(l, span);
            const rm = minutesOrThrow(r, span);
            return { type: 'duration', amount: lm + sign * rm, unit: 'min' };
        }
        if (l.type === 'number' && r.type === 'number') {
            return { type: 'number', value: quantize(l.value + sign * r.value, span) };
        }
        if (op === '+' && isStringish(l) && isStringish(r)) {
            return { type: 'string', value: stringishText(l) + stringishText(r) };
        }
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

/**
 * A scaled duration, refused when the result is fractional.
 *
 * Duration literals are whole numbers followed by a unit, so `2.5d` cannot be
 * read back. Printing one would break the round-trip contract the flow line
 * depends on, and the break would only surface a generation later. Refusing
 * here keeps every value the evaluator produces writable; the smaller unit is
 * the way to say it (`24h / 2` rather than `1d / 2`).
 */
function scaledDuration(amount: number, unit: DurUnit, span: Span): Value {
    if (!Number.isInteger(amount)) {
        throw new EvalError(
            `A duration must stay whole — ${amount}${unit} cannot be written. Use a smaller unit.`,
            span);
    }
    return { type: 'duration', amount, unit };
}

/**
 * Put a result back on the decimal grid.
 *
 * Numbers here are decimal, so `0.1 + 0.2` has to be `0.3` and not the float
 * that addition actually produced. The double is only the carrier: every
 * operation lands back on a grid of ten decimal places, which is also what a
 * literal may write and what division rounds to.
 *
 * Whole numbers pass straight through. Scaling one by ten billion to round it
 * would push it out of the range a double holds exactly, which is the way to
 * lose the precision this function exists to keep.
 *
 * Past the grid's reach the evaluation fails, rather than writing a number
 * that is not the one that was computed. Failing is the same answer the rest
 * of the language gives to a value it cannot write back — a duration that
 * came out fractional says it the same way.
 */
function quantize(value: number, span: Span): number {
    if (Number.isInteger(value)) {
        if (!Number.isSafeInteger(value)) {
            throw new EvalError(
                `${value} is too large to hold exactly`, span);
        }
        // A negative zero is the same number as zero and reads oddly wherever
        // it lands, so it does not survive the trip.
        return value === 0 ? 0 : value;
    }
    if (!Number.isFinite(value) || Math.abs(value) > MAX_EXACT_FRACTION) {
        throw new EvalError(
            `A fraction this large cannot be held exactly (up to ${MAX_EXACT_FRACTION})`, span);
    }
    const onGrid = Math.round(value * DECIMAL_SCALE) / DECIMAL_SCALE;
    return onGrid === 0 ? 0 : onGrid;
}

/**
 * Positions that ask for a count — a slice bound, a pad length, a digit
 * count. JS truncates a fraction here silently; that would make `xs.slice(x)`
 * quietly mean something else the day `x` picks up a decimal, so a fraction
 * fails instead.
 */
function wholeOrThrow(value: number, what: string, span: Span): number {
    if (!Number.isInteger(value)) {
        throw new EvalError(`'${what}' expects a whole number, got ${value}`, span);
    }
    return value;
}

/**
 * `*` `/` `%` on plain numbers.
 *
 * Division needs the grid most — 1 / 3 does not terminate, so without a rule
 * the result would be whatever float came out. Dividing by zero fails the
 * evaluation rather than producing infinity: there is no value for it, and a
 * failed evaluation leaves the command unconsumed.
 */
function arith(op: '*' | '/' | '%', a: number, b: number, span: Span): number {
    if (op === '*') return quantize(a * b, span);
    if (b === 0) throw new EvalError(`Division by zero`, span);
    if (op === '/') return quantize(a / b, span);

    // The remainder is derived from the quotient rather than taken from the
    // carrier. Quantizing works when the error is smaller than the grid, and
    // `%` is where that stops being true: it jumps by a whole divisor when the
    // quotient's error crosses an integer, so 0.3 % 0.1 comes out as 0.0999…
    // and rounds to 0.1 when the decimal answer is 0. Rounding the quotient
    // first puts it back on the grid, and the rest follows from it.
    const quotient = quantize(a / b, span);
    return quantize(a - b * Math.trunc(quotient), span);
}

function isStringish(v: Value): v is Value & { type: 'string' | 'link' } {
    return v.type === 'string' || v.type === 'link';
}

/** Links coerce to their target text in concatenation. */
function stringishText(v: Value & { type: 'string' | 'link' }): string {
    return v.type === 'string' ? v.value : v.target;
}

function minutesOrThrow(dur: Value & { type: 'duration' }, span: Span): number {
    const factors: Partial<Record<string, number>> = { min: 1, h: 60, d: 1440, w: 10080 };
    const f = factors[dur.unit];
    if (f === undefined) throw new EvalError(`Cannot mix '${dur.unit}' with other duration units`, span);
    return dur.amount * f;
}
