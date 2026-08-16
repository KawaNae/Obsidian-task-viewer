import type { Span } from './Diagnostic';
import { type Expr, type PropName, isExprBody } from './ExprAst';
import { type EvalRuntime, FnCallError, callFn } from './functions';
// An expression can hold statements again, through an arrow's block body and
// through a call of a locally declared function, so the two evaluators call
// each other the way the two parsers do.
import { type CellStore, type Scope, burn, callFunction, execArrowBody } from './StmtEvaluator';
import {
    type DurUnit, type Value, WEEKDAY_NAMES, addDuration, compareValues, isDatishValue, isWritableDatish, parseDateStr,
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

/**
 * A ceiling was reached: the evaluation budget, or the depth of open calls.
 *
 * An `EvalError`, so the two-phase handling is unchanged — nothing is written
 * and the command is not consumed. Its own class so a caller that needs to
 * tell "this did not finish" from "this went wrong" can ask the type instead
 * of matching on the sentence. The differential sweep is that caller: it runs
 * this language before native JS precisely so a corpus source that never ends
 * fails here rather than hanging where there is no budget at all, and a
 * signal made of English comes apart the next time the message is reworded.
 *
 * Declared beside `EvalError` rather than beside the ceilings that throw it:
 * the two evaluator modules import each other, and a class that extends
 * across that circle would be reading a binding that is not initialized yet.
 */
export class BudgetError extends EvalError { }

/**
 * Digits `toFixed` will write, which is the host's own limit said here.
 *
 * Every ceiling in this language is a number with a reason and a sentence. This
 * one is neither ours nor arbitrary — it is what `Number.prototype.toFixed`
 * accepts — but it has to be said all the same, or it arrives as a RangeError
 * from outside the language with nothing to catch it.
 */
const MAX_FIXED_DIGITS = 100;

export interface EvalContext extends EvalRuntime {
    /** Property snapshot the expression evaluates against. */
    props: Partial<Record<PropName, Value>>;
    /**
     * Names bound by enclosing arrow parameters. Rebound per element rather
     * than mutated, so a list method cannot leak a binding to its caller.
     */
    vars?: ReadonlyMap<string, Value>;
    /**
     * The js section's lexical scope, when one is running. Absent for a flow
     * clause, which has no statements and therefore nothing to bind.
     */
    scope?: Scope;
    /**
     * The state cells of the command being fired, as the planner made them.
     *
     * Read where the block is rendered, which turns them into a scope the body
     * can write to. Carried on the context because that is the only channel
     * into the render, and left off everything else because a flow clause
     * cannot reach a cell.
     */
    cells?: CellStore;
    /**
     * What is left of the evaluation budget, and how many calls are open.
     * Absent means unmetered — a flow clause is one expression, and it can
     * neither loop nor call anything it wrote itself.
     */
    fuel?: { left: number; depth: number };
}

export function evalExpr(expr: Expr, ctx: EvalContext): Value {
    burn(ctx, expr.span);
    switch (expr.kind) {
        case 'lit':
            return expr.value;

        case 'assign': {
            if (!ctx.scope) {
                throw new EvalError('An assignment only means something inside a generation block', expr.span);
            }
            const current = expr.op === '=' ? null : lookupVar(expr.name, ctx, expr.nameSpan);
            const written = expr.op === '='
                ? evalExpr(expr.value, ctx)
                : applyAddSub(expr.op === '+=' ? '+' : '-', current!, evalExpr(expr.value, ctx), expr.span);
            ctx.scope.assign(expr.name, written, expr.nameSpan);
            // An assignment is an expression and yields what it wrote, which
            // is what makes `${n = n + 1}` splice the new value.
            return written;
        }

        case 'call-local': {
            const def = ctx.scope?.lookupFn(expr.name);
            if (!def) throw new EvalError(`'${expr.name}' is not a function here`, expr.nameSpan);
            return callFunction(def, expr.args.map(a => evalExpr(a, ctx)), ctx, expr.span);
        }

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

        case 'var':
            return lookupVar(expr.name, ctx, expr.span);

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
 * A bare name: a local of the js section, or an arrow parameter.
 *
 * The scope is asked first. Its own chain ends at `ctx.vars`, so a section
 * running inside a list method's callback still reaches the element — the two
 * kinds of binding are one lookup, not two that could disagree.
 */
function lookupVar(name: string, ctx: EvalContext, span: Span): Value {
    const v = ctx.scope ? ctx.scope.lookup(name) : ctx.vars?.get(name);
    if (v === undefined) {
        if (ctx.scope?.lookupFn(name)) {
            throw new EvalError(`'${name}' is a function — call it with ${name}(...)`, span);
        }
        throw new EvalError(`'${name}' is not bound here`, span);
    }
    return v;
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
        // Inside a section the parameters go into a scope frame, which is the
        // one mechanism a `{ }` body can declare into and an expression body
        // reads just as well. Outside one — a flow clause, a body line with no
        // section — there is no scope to hang a frame on, and the flat map
        // that has always carried callback parameters still does.
        if (ctx.scope) {
            const frame = ctx.scope.child();
            fnExpr.params.forEach((p, i) => frame.declare(p, values[i] ?? { type: 'none' }, true));
            const inner = { ...ctx, scope: frame };
            return isExprBody(fnExpr.body)
                ? evalExpr(fnExpr.body, inner)
                : execArrowBody(fnExpr.body, inner);
        }
        if (!isExprBody(fnExpr.body)) {
            throw new EvalError('A function with a { } body only means something inside a generation block', fnExpr.span);
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
        const places = digits?.type === 'number' ? wholeOrThrow(digits.value, 'toFixed', span) : 0;
        // The host's own range, said here. Left to the host it arrives as a
        // RangeError with nowhere to be caught: not an EvalError, so the fire
        // does not fail the way a failure is supposed to — it takes the whole
        // read down with it, in an editor as well as in a fire.
        if (places < 0 || places > MAX_FIXED_DIGITS) {
            throw new EvalError(
                `'toFixed' takes 0 to ${MAX_FIXED_DIGITS} digits, got ${places}`, span);
        }
        return { type: 'string', value: obj.value.toFixed(places) };
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

    if (op === '+' || op === '-') return applyAddSub(op, l, r, span);

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
 * `a + b` / `a - b` on two values.
 *
 * Its own function because `n += 1` means exactly this and nothing else. The
 * compound assignment has one value in hand already, so it cannot go back
 * through the expression form — and writing the addition a second time is how
 * `+=` and `+` would quietly come to disagree.
 */
/**
 * A shifted date, or the end of this evaluation.
 *
 * Arithmetic on dates can leave the calendar the way arithmetic on numbers can
 * leave the grid, and the two have to fail the same way. Nothing downstream
 * asks whether a date is real: the shifted value is written onto the next
 * instance's line, and a year the notation cannot read takes the date off the
 * task and leaves the text in its title — with the command still attached, so
 * the fire after it has no day to count from. `NaN-NaN-NaN` is that same
 * failure, spelled loudly.
 *
 * Failing here means the fire does not happen and the command is not consumed,
 * which is the behaviour every other evaluation failure already has.
 */
function shifted(value: Value, span: Span): Value {
    if (isDatishValue(value) && !isWritableDatish(value)) {
        throw new EvalError(
            'This lands outside the four-digit years a date can be written in (0001 to 9999)',
            span);
    }
    return value;
}

export function applyAddSub(op: '+' | '-', l: Value, r: Value, span: Span): Value {
    const sign = op === '+' ? 1 : -1;
    if (isDatishValue(l) && r.type === 'duration') return shifted(addDuration(l, r, sign as 1 | -1), span);
    if (op === '+' && l.type === 'duration' && isDatishValue(r)) return shifted(addDuration(r, l, 1), span);
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
