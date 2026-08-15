import { type Diagnostic, type Span, error } from './Diagnostic';
import type { Expr, PropName } from './ExprAst';
import {
    type ArrayType, FN_SIGS, type StaticType, arrayOf, isArrayType, isAssignable, isDatishType,
    type RecordType, isRecordType, recordOf, sameType, typeName,
} from './functions';
import { type Value, weekdayFromName } from './Value';

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
/** Names bound by enclosing arrow parameters, innermost last. */
export type VarTypes = ReadonlyMap<string, StaticType>;

const NO_VARS: VarTypes = new Map();

export function checkExpr(expr: Expr, env: TypeEnv, diagnostics: Diagnostic[], vars: VarTypes = NO_VARS): StaticType {
    switch (expr.kind) {
        case 'lit':
            return literalType(expr.value);

        case 'prop': {
            const t = env[expr.name];
            if (t === undefined) {
                diagnostics.push(error('type.unknown-property', `Property '${expr.name}' is not available here`, expr.span, { name: expr.name }));
                return 'error';
            }
            return t;
        }

        case 'unary': {
            const t = checkExpr(expr.operand, env, diagnostics, vars);
            if (t === 'error') return 'error';
            if (expr.op === '!') {
                if (t !== 'bool') {
                    diagnostics.push(error('type.bang-expects-bool', `'!' expects bool, got ${typeName(t)}`, expr.span, { actual: typeName(t) }));
                    return 'error';
                }
                return 'bool';
            }
            if (t !== 'number' && t !== 'duration') {
                diagnostics.push(error('type.unary-minus-operand', `Unary '-' expects number or duration, got ${typeName(t)}`, expr.span, { actual: typeName(t) }));
                return 'error';
            }
            return t;
        }

        case 'var': {
            const t = vars.get(expr.name);
            if (t !== undefined) return t;
            // Bare weekdays lost their literal form; say so here too, since a
            // block resolves unclaimed names as bindings before reaching this.
            if (weekdayFromName(expr.name) !== null) {
                diagnostics.push(error('expr.weekday-not-literal',
                    `Weekdays are strings in expressions — write "${expr.name}" (bare ${expr.name} is only for 'every ${expr.name}')`,
                    expr.span, { name: expr.name }));
            } else {
                diagnostics.push(error('expr.unknown-ident', `Unknown identifier '${expr.name}'`,
                    expr.span, { name: expr.name }));
            }
            return 'error';
        }

        case 'array': {
            // A spread contributes the elements of the list it holds, so it is
            // typed by that list's element rather than by the spread itself.
            const itemTypes = expr.items.map(item => {
                if (item.kind !== 'spread') return checkExpr(item, env, diagnostics, vars);
                const t = checkExpr(item.arg, env, diagnostics, vars);
                if (t === 'error') return 'error';
                if (!isArrayType(t)) {
                    diagnostics.push(error('type.spread-not-a-list',
                        `A spread needs a list, got ${typeName(t)}`, item.span, { actual: typeName(t) }));
                    return 'error';
                }
                return t.array;
            });
            if (itemTypes.includes('error')) return 'error';
            // An empty list is a list of nothing yet: `none` is the bottom of
            // the unification, so it takes the shape of whatever it meets.
            let elem: StaticType = 'none';
            for (let i = 0; i < itemTypes.length; i++) {
                const merged = unifyTypes(elem, itemTypes[i]);
                if (!merged) {
                    diagnostics.push(error('type.list-mixed',
                        `A list holds one kind of value (${typeName(elem)} vs ${typeName(itemTypes[i])})`,
                        expr.items[i].span, { left: typeName(elem), right: typeName(itemTypes[i]) }));
                    return 'error';
                }
                elem = merged;
            }
            return arrayOf(elem);
        }

        case 'record': {
            const fields: Record<string, StaticType> = {};
            for (const entry of expr.entries) {
                const t = checkExpr(entry.value, env, diagnostics, vars);
                if (t === 'error') return 'error';
                fields[entry.key] = t;
            }
            return recordOf(fields);
        }

        case 'spread':
            diagnostics.push(error('type.spread-not-here',
                'A spread only means something inside a list: [...xs, y]', expr.span));
            return 'error';

        case 'index': {
            const ot = checkExpr(expr.obj, env, diagnostics, vars);
            const it = checkExpr(expr.index, env, diagnostics, vars);
            if (ot === 'error' || it === 'error') return 'error';
            if (isRecordType(ot)) return recordIndexType(ot, expr, it, diagnostics);
            if (!isArrayType(ot)) {
                diagnostics.push(error('type.not-indexable', `${typeName(ot)} cannot be indexed`,
                    expr.span, { receiver: typeName(ot) }));
                return 'error';
            }
            if (it !== 'number') {
                diagnostics.push(error('type.index-not-number', `A list index is a number, got ${typeName(it)}`,
                    expr.index.span, { actual: typeName(it) }));
                return 'error';
            }
            return ot.array;
        }

        case 'template': {
            // Every piece has to be renderable as text. Only a function is
            // not, and it reports itself when checked.
            for (const part of expr.parts) {
                if (part.kind === 'expr') checkExpr(part.expr, env, diagnostics, vars);
            }
            return 'string';
        }

        case 'arrow':
            diagnostics.push(error('type.function-not-here',
                'A function only means something as an argument to a list method (map, filter, sort, ...)',
                expr.span));
            return 'error';

        case 'member':
        case 'method': {
            const ot = checkExpr(expr.obj, env, diagnostics, vars);
            if (ot === 'error') return 'error';
            if (isRecordType(ot)) {
                if (expr.kind === 'method') {
                    diagnostics.push(error('type.unknown-member',
                        `${typeName(ot)} has no method '${expr.name}'`,
                        expr.span, { receiver: typeName(ot), name: expr.name }));
                    return 'error';
                }
                const field = ot.fields[expr.name];
                if (field === undefined) {
                    diagnostics.push(error('type.unknown-field',
                        `${typeName(ot)} has no field '${expr.name}'`,
                        expr.span, { receiver: typeName(ot), name: expr.name }));
                    return 'error';
                }
                return field;
            }
            // A list needs the element type in hand to check the function
            // written for it, which a flat signature table cannot express.
            if (isArrayType(ot)) return checkListMember(expr, ot, env, diagnostics, vars);
            const argTypes = expr.kind === 'method'
                ? expr.args.map(a => checkExpr(a, env, diagnostics, vars))
                : [];
            if (argTypes.includes('error')) return 'error';
            const sig = memberSignature(ot, expr.name, expr.kind === 'method');
            if (!sig) {
                diagnostics.push(error('type.unknown-member',
                    `${typeName(ot)} has no ${expr.kind === 'method' ? 'method' : 'property'} '${expr.name}'`,
                    expr.span, { receiver: typeName(ot), name: expr.name }));
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
                if (!isAssignable(argTypes[i], sig.params[i])) {
                    diagnostics.push(error('type.member-arg',
                        `'${expr.name}' expects ${typeName(sig.params[i])} for argument ${i + 1}, got ${typeName(argTypes[i])}`,
                        expr.kind === 'method' ? expr.args[i].span : expr.span,
                        { name: expr.name, index: i + 1, expected: typeName(sig.params[i]), actual: typeName(argTypes[i]) }));
                    return 'error';
                }
            }
            return sig.result;
        }

        case 'binary': {
            const lt = checkExpr(expr.left, env, diagnostics, vars);
            const rt = checkExpr(expr.right, env, diagnostics, vars);
            if (lt === 'error' || rt === 'error') return 'error';
            return checkBinary(expr, lt, rt, diagnostics);
        }

        case 'cond': {
            const ct = checkExpr(expr.cond, env, diagnostics, vars);
            if (ct !== 'bool' && ct !== 'error') {
                diagnostics.push(error('type.cond-not-bool', `Condition must be bool, got ${typeName(ct)}`, expr.cond.span, { actual: typeName(ct) }));
            }
            const tt = checkExpr(expr.then, env, diagnostics, vars);
            const et = checkExpr(expr.else, env, diagnostics, vars);
            if (tt === 'error' || et === 'error') return 'error';
            const unified = unifyTypes(tt, et);
            if (unified) return unified;
            diagnostics.push(error('type.branch-mismatch', `Conditional branches have different types (${typeName(tt)} vs ${typeName(et)})`, expr.span, { thenType: typeName(tt), elseType: typeName(et) }));
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
                const at = checkExpr(arg, env, diagnostics, vars);
                if (at !== 'error' && !isAssignable(at, sig.params[i])) {
                    diagnostics.push(error('type.arg-mismatch', `${expr.fn}() argument ${i + 1} expects ${typeName(sig.params[i])}, got ${typeName(at)}`, arg.span,
                        { fn: expr.fn, index: i + 1, expected: typeName(sig.params[i]), actual: typeName(at) }));
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
 * Members and methods of a list. Not a table like the scalar ones: the
 * element type decides the parameter of the function written for it, and that
 * function's own result decides what `map` returns.
 */
function checkListMember(
    expr: Expr & { kind: 'member' | 'method' },
    listType: ArrayType,
    env: TypeEnv,
    diagnostics: Diagnostic[],
    vars: VarTypes
): StaticType {
    const elem = listType.array;
    const name = expr.name;
    const args = expr.kind === 'method' ? expr.args : [];
    const fail = (code: string, msg: string, params?: Diagnostic['params'], span = expr.span): StaticType => {
        diagnostics.push(error(code, msg, span, params));
        return 'error';
    };

    if (expr.kind === 'member') {
        if (name === 'length') return 'number';
        return fail('type.unknown-member', `${typeName(listType)} has no property '${name}'`,
            { receiver: typeName(listType), name });
    }

    /** Check the single function argument with its parameters bound. */
    const callback = (paramTypes: StaticType[]): StaticType => {
        if (args.length !== 1) {
            return fail('type.member-arity', `'${name}' takes 1 argument(s), got ${args.length}`,
                { name, expected: 1, actual: args.length });
        }
        return checkCallback(args[0], name, paramTypes, env, diagnostics, vars);
    };

    /** Methods whose function must answer a yes/no question. */
    const predicate = (): StaticType => {
        const r = callback([elem, 'number']);
        if (r === 'error') return 'error';
        if (r !== 'bool') {
            return fail('type.callback-result',
                `'${name}' expects a function returning bool, got ${typeName(r)}`,
                { name, expected: 'bool', actual: typeName(r) }, args[0].span);
        }
        return 'bool';
    };

    switch (name) {
        case 'map': {
            const r = callback([elem, 'number']);
            return r === 'error' ? 'error' : arrayOf(r);
        }
        case 'filter':
            return predicate() === 'error' ? 'error' : listType;
        case 'find':
            return predicate() === 'error' ? 'error' : elem;
        case 'some':
        case 'every':
            return predicate();
        case 'forEach': {
            const r = callback([elem, 'number']);
            return r === 'error' ? 'error' : 'none';
        }
        case 'sort': {
            if (args.length === 0) {
                // JS's argument-less sort compares the text of each element,
                // which is why [10, 9] stays [10, 9]. Faithful for text and a
                // trap for anything else, so ask for the comparison instead.
                if (elem !== 'string' && elem !== 'none') {
                    return fail('type.sort-needs-comparator',
                        `Sorting ${typeName(listType)} needs the comparison written out: sort((a, b) => a - b)`,
                        { receiver: typeName(listType) });
                }
                return listType;
            }
            const r = callback([elem, elem]);
            if (r === 'error') return 'error';
            if (r !== 'number') {
                return fail('type.callback-result',
                    `'${name}' expects a function returning number, got ${typeName(r)}`,
                    { name, expected: 'number', actual: typeName(r) }, args[0].span);
            }
            return listType;
        }
        default:
            return checkListPlainMethod(listType, name, args, env, diagnostics, vars, fail);
    }
}

/** The list methods that take ordinary values rather than a function. */
function checkListPlainMethod(
    listType: ArrayType,
    name: string,
    args: Expr[],
    env: TypeEnv,
    diagnostics: Diagnostic[],
    vars: VarTypes,
    fail: (code: string, msg: string, params?: Diagnostic['params'], span?: Span) => StaticType
): StaticType {
    const elem = listType.array;

    if (name === 'push') {
        // The one mutation people reach for out of habit.
        return fail('type.list-immutable',
            'A list cannot be added to — build it in one go, or use concat or a spread: [...xs, y]',
            { name });
    }

    const sigs: Record<string, { params: StaticType[]; minArgs: number; result: StaticType }> = {
        join: { params: ['string'], minArgs: 0, result: 'string' },
        includes: { params: [elem], minArgs: 1, result: 'bool' },
        indexOf: { params: [elem], minArgs: 1, result: 'number' },
        slice: { params: ['number', 'number'], minArgs: 0, result: listType },
        concat: { params: [listType], minArgs: 1, result: listType },
    };
    const sig = sigs[name];
    if (!sig) {
        return fail('type.unknown-member', `${typeName(listType)} has no method '${name}'`,
            { receiver: typeName(listType), name });
    }
    if (args.length < sig.minArgs || args.length > sig.params.length) {
        const range = sig.minArgs === sig.params.length ? `${sig.minArgs}` : `${sig.minArgs}-${sig.params.length}`;
        return fail('type.member-arity', `'${name}' takes ${range} argument(s), got ${args.length}`,
            { name, expected: range, actual: args.length });
    }
    for (let i = 0; i < args.length; i++) {
        const at = checkExpr(args[i], env, diagnostics, vars);
        if (at === 'error') return 'error';
        if (!isAssignable(at, sig.params[i])) {
            return fail('type.member-arg',
                `'${name}' expects ${typeName(sig.params[i])} for argument ${i + 1}, got ${typeName(at)}`,
                { name, index: i + 1, expected: typeName(sig.params[i]), actual: typeName(at) }, args[i].span);
        }
    }
    return sig.result;
}

/** Type the function argument of a list method, its parameters bound. */
function checkCallback(
    arg: Expr,
    method: string,
    paramTypes: StaticType[],
    env: TypeEnv,
    diagnostics: Diagnostic[],
    vars: VarTypes
): StaticType {
    if (arg.kind !== 'arrow') {
        diagnostics.push(error('type.expects-function',
            `'${method}' expects a function, like (x) => x`, arg.span, { name: method }));
        return 'error';
    }
    if (arg.params.length > paramTypes.length) {
        diagnostics.push(error('type.too-many-params',
            `'${method}' passes ${paramTypes.length} value(s) to its function, got ${arg.params.length} parameter(s)`,
            arg.span, { name: method, expected: paramTypes.length, actual: arg.params.length }));
        return 'error';
    }
    const bound = new Map(vars);
    arg.params.forEach((p, i) => {
        // An error, where shadowing a built-in with `let` is only a warning.
        // A parameter is the only handle on the element, so a body that cannot
        // see it has no correct reading — and it does not fail loudly either:
        // `filter(content => content.length > 1)` becomes a constant predicate
        // and lets everything through, writing plausible nonsense.
        if (isReservedName(p)) {
            diagnostics.push(error('type.param-shadows-builtin',
                `'${p}' already means something here — the built-in wins and this parameter cannot be read`,
                arg.span, { name: p }));
        }
        bound.set(p, paramTypes[i]);
    });
    return checkExpr(arg.body, env, diagnostics, bound);
}

/**
 * Names the parser resolves before it ever looks for a binding. Shadowing one
 * is not an error — the built-in simply wins — but it is always a mistake.
 */
function isReservedName(name: string): boolean {
    return ['true', 'false', 'none', 'week', 'month', 'year', 'start', 'end', 'due',
        'content', 'done', 'today', 'file', 'tv', 'format', 'next', 'startOf', 'endOf',
        'nextCycle', 'date', 'time'].includes(name);
}

/**
 * `table[key]` on a record.
 *
 * A constant key is the field it names. A key computed at evaluation could be
 * any of them, so the answer is the one type they all share — and when they do
 * not share one, saying so here beats handing back a type that is wrong for
 * every branch but one.
 */
function recordIndexType(
    receiver: RecordType,
    expr: Expr & { kind: 'index' },
    keyType: StaticType,
    diagnostics: Diagnostic[]
): StaticType {
    if (keyType !== 'string') {
        diagnostics.push(error('type.index-not-string',
            `A record is indexed by a string, got ${typeName(keyType)}`,
            expr.index.span, { actual: typeName(keyType) }));
        return 'error';
    }
    const constant = expr.index.kind === 'lit' && expr.index.value.type === 'string'
        ? expr.index.value.value
        : null;
    if (constant !== null) {
        const field = receiver.fields[constant];
        if (field === undefined) {
            diagnostics.push(error('type.unknown-field',
                `${typeName(receiver)} has no field '${constant}'`,
                expr.index.span, { receiver: typeName(receiver), name: constant }));
            return 'error';
        }
        return field;
    }
    const types = Object.values(receiver.fields);
    if (types.length === 0) return 'none';
    let unified: StaticType | null = types[0];
    for (const t of types.slice(1)) {
        unified = unified === null ? null : unifyTypes(unified, t);
    }
    if (unified === null) {
        diagnostics.push(error('type.record-fields-differ',
            `Looking a field up by a computed key needs the fields to share a type (${typeName(receiver)})`,
            expr.span, { receiver: typeName(receiver) }));
        return 'error';
    }
    return unified;
}

/**
 * The static type of a literal value.
 *
 * A container only reaches the checker as its own node kind, never as a
 * literal — but the value model has the cases, so they are answered rather
 * than left to fall through as a type nobody declared.
 */
function literalType(value: Value): StaticType {
    if (value.type === 'array') return arrayOf('none');
    if (value.type === 'record') return recordOf({});
    return value.type;
}

/**
 * The single type two alternatives settle on, or null when they do not meet.
 * `none` is the missing-value type, so it takes the shape of the other side.
 */
function unifyTypes(a: StaticType, b: StaticType): StaticType | null {
    if (sameType(a, b)) return a;
    if (a === 'none') return b;
    if (b === 'none') return a;
    if (isArrayType(a) && isArrayType(b)) {
        const elem = unifyTypes(a.array, b.array);
        return elem ? arrayOf(elem) : null;
    }
    if (isArrayType(a) || isArrayType(b)) return null;
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
            : fail('type.logic-expects-bool', `'${op}' expects bool operands, got ${typeName(lt)} and ${typeName(rt)}`, { op, left: typeName(lt), right: typeName(rt) });
    }

    // `a ?? b` yields whichever side survives, so both sides must land on one
    // type — the same unification a conditional needs.
    if (op === '??') {
        return unifyTypes(lt, rt)
            ?? fail('type.nullish-mismatch', `'??' sides have different types (${typeName(lt)} vs ${typeName(rt)})`, { left: typeName(lt), right: typeName(rt) });
    }

    if (op === '*' || op === '/' || op === '%') {
        if (lt === 'number' && rt === 'number') return 'number';
        // duration scaling: gap * 2 / 2 * gap / gap / 2 — the adaptive-interval shape
        // Scaling keeps the unit, so it means the same for 1d and 24h. The
        // remainder does not: 1d % 2 is 1d while 24h % 2 is 0h, though the two
        // durations are the same length. Refuse rather than pick a unit.
        if (op !== '%' && lt === 'duration' && rt === 'number') return 'duration';
        if (op === '*' && lt === 'number' && rt === 'duration') return 'duration';
        return fail('type.cannot-combine', `'${op}' cannot combine ${typeName(lt)} and ${typeName(rt)}`, { op, left: typeName(lt), right: typeName(rt) });
    }

    if (op === '+' || op === '-') {
        if (isDatishType(lt) && rt === 'duration') return lt;
        if (op === '+' && lt === 'duration' && isDatishType(rt)) return rt;
        if (lt === 'duration' && rt === 'duration') return 'duration';
        if (lt === 'number' && rt === 'number') return 'number';
        if ((lt === 'time' && rt === 'duration') || (lt === 'duration' && rt === 'time')) {
            return fail('type.time-arithmetic',
                'Time arithmetic is not supported — apply duration to a date first: time(start + 2h)',
                { left: typeName(lt), right: typeName(rt) });
        }
        // date + time attaches a time-of-day. Only plain dates qualify —
        // adding a time to a datetime would be ambiguous (add vs replace),
        // so datetime/datish operands must be truncated first via date(x).
        if (op === '+' && lt === 'date' && rt === 'time') return 'datetime';
        if (op === '+' && isDatishType(lt) && rt === 'time') {
            return fail('type.datetime-plus-time',
                `Adding a time to a ${typeName(lt)} is ambiguous — truncate first: date(x) + 14:00`, { left: typeName(lt) });
        }
        // Links coerce to their target text in concatenation (move([[Log/]] + file.name))
        const stringish = (t: StaticType) => t === 'string' || t === 'link';
        if (op === '+' && stringish(lt) && stringish(rt)) return 'string';
        return fail('type.cannot-combine', `'${op}' cannot combine ${typeName(lt)} and ${typeName(rt)}`, { op, left: typeName(lt), right: typeName(rt) });
    }

    // Comparisons
    const comparable =
        (isDatishType(lt) && isDatishType(rt)) ||
        lt === rt;
    if (!comparable) return fail('type.cannot-compare', `Cannot compare ${typeName(lt)} with ${typeName(rt)}`, { left: typeName(lt), right: typeName(rt) });
    return 'bool';
}


/**
 * Members and methods a value carries, by receiver type.
 *
 * Kept as data rather than branches so the checker and the evaluator can be
 * read against each other: every entry here has a case there, and a member
 * that is missing from one is visible as a hole in the other.
 */
export interface MemberSig {
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

/**
 * Every scalar receiver and what it carries.
 *
 * One table behind both the lookup and the invariant below, so a fifth
 * receiver added later cannot appear in one and not the other.
 */
const SCALAR_MEMBERS: readonly {
    applies: (t: StaticType) => boolean;
    members: Record<string, MemberSig>;
    methods: Record<string, MemberSig>;
}[] = [
    { applies: t => t === 'string', members: STRING_MEMBERS, methods: STRING_METHODS },
    // 'datish' covers a property whose concrete date type is not known until
    // evaluation; date methods apply to it just the same.
    { applies: isDatishType, members: {}, methods: DATE_METHODS },
    { applies: t => t === 'number', members: {}, methods: NUMBER_METHODS },
];

/**
 * Every member a scalar carries, flattened.
 *
 * Exposed so the invariant that holds the two profiles apart stays checkable:
 * a flow command must not be able to reach a list. Refusing list literals at
 * the parser is not enough on its own — a scalar method that *returned* a list
 * (a `split`, say) would open the same door, and with it the printer's
 * obligation to write functions back out.
 */
export const SCALAR_MEMBER_SIGS: readonly MemberSig[] = SCALAR_MEMBERS.flatMap(
    e => [...Object.values(e.members), ...Object.values(e.methods)]);

export function memberSignature(receiver: StaticType, name: string, isMethod: boolean): MemberSig | null {
    const entry = SCALAR_MEMBERS.find(e => e.applies(receiver));
    if (!entry) return null;
    return (isMethod ? entry.methods : entry.members)[name] ?? null;
}
