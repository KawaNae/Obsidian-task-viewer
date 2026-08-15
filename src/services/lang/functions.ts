import { addDays, addMonths, addYears, differenceInCalendarDays } from 'date-fns';
import type { Span } from './Diagnostic';
import type { Expr, FnName } from './ExprAst';
import {
    type DurUnit, type Value, WEEKDAY_NAMES, type Weekday, formatDateStr, isDatishValue, parseDateStr,
    weekdayFromName,
} from './Value';

/**
 * Static types used by the checker. 'datish' is the date|datetime family
 * (task date fields may be either depending on whether a time is present).
 * 'error' is the poison type that suppresses cascading diagnostics.
 *
 * A list carries its element type: `map` has to know what its parameter is
 * before it can check the body written for it. Spelled out rather than
 * derived from `Value['type']` so a bare 'array' — a list of nothing in
 * particular — cannot be written.
 */
export type ScalarType =
    | 'date' | 'datetime' | 'time' | 'duration'
    | 'string' | 'number' | 'bool' | 'link' | 'none'
    | 'datish' | 'error';

export interface ArrayType { readonly array: StaticType }

/** A record: the fields it holds, by name. Order is not part of the type. */
export interface RecordType { readonly fields: Readonly<Record<string, StaticType>> }

export type StaticType = ScalarType | ArrayType | RecordType;

export function arrayOf(element: StaticType): ArrayType {
    return { array: element };
}

export function recordOf(fields: Record<string, StaticType>): RecordType {
    // No prototype, so `toString` and `constructor` are absent until someone
    // writes them, and `__proto__` is an ordinary field name rather than a
    // way to reach the prototype. A record's field names come from the
    // document, so every name JS gives an object for free would otherwise be
    // a field this language never declared.
    const own: Record<string, StaticType> = Object.create(null);
    for (const key of Object.keys(fields)) own[key] = fields[key];
    return { fields: own };
}

/** A field this record actually has. */
export function recordFieldType(t: RecordType, name: string): StaticType | undefined {
    return Object.hasOwn(t.fields, name) ? t.fields[name] : undefined;
}

export function isArrayType(t: StaticType): t is ArrayType {
    return typeof t === 'object' && 'array' in t;
}

export function isRecordType(t: StaticType): t is RecordType {
    return typeof t === 'object' && 'fields' in t;
}

/** Display form for diagnostics: `string[]`, `number[][]`, `{a: string}`. */
export function typeName(t: StaticType): string {
    if (isArrayType(t)) return `${typeName(t.array)}[]`;
    if (isRecordType(t)) {
        const fields = Object.entries(t.fields).map(([k, v]) => `${k}: ${typeName(v)}`);
        return `{${fields.join(', ')}}`;
    }
    return t;
}

export function isDatishType(t: StaticType): boolean {
    return t === 'date' || t === 'datetime' || t === 'datish';
}

/** Structural equality — two containers match when their contents do. */
export function sameType(a: StaticType, b: StaticType): boolean {
    if (isArrayType(a) || isArrayType(b)) {
        return isArrayType(a) && isArrayType(b) && sameType(a.array, b.array);
    }
    if (isRecordType(a) || isRecordType(b)) {
        if (!isRecordType(a) || !isRecordType(b)) return false;
        const ak = Object.keys(a.fields);
        const bk = Object.keys(b.fields);
        return ak.length === bk.length
            && ak.every(k => Object.hasOwn(b.fields, k) && sameType(a.fields[k], b.fields[k]));
    }
    return a === b;
}

export function isAssignable(actual: StaticType, expected: StaticType): boolean {
    if (actual === 'error') return true;
    if (actual === 'none') return true;
    if (isArrayType(expected)) {
        return isArrayType(actual) && isAssignable(actual.array, expected.array);
    }
    if (isRecordType(expected)) return isRecordType(actual) && sameType(actual, expected);
    if (isArrayType(actual) || isRecordType(actual)) return false;
    if (expected === 'datish') return isDatishType(actual);
    return actual === expected;
}

// ---------------------------------------------------------------------------
// Signatures (single table shared by checker and evaluator)
// ---------------------------------------------------------------------------

export interface FnSigViolation {
    code: string;
    message: string;
    span: Span;
    params?: Record<string, string | number>;
}

export interface FnSig {
    name: FnName;
    minArgs: number;
    /** Expected type per position (covers minArgs..params.length). */
    params: StaticType[];
    /** When set, arguments past `params` are allowed and must have this type. */
    rest?: StaticType;
    result: StaticType;
    /**
     * Extra constraint applied at check time (e.g. unit keyword must be a
     * constant). Returns a diagnostic-shaped violation or null.
     */
    checkArgs?: (args: Expr[]) => FnSigViolation | null;
}

const UNIT_SET = ['week', 'month', 'year'];

function requireUnitKeyword(args: Expr[]): FnSigViolation | null {
    const first = args[0];
    if (first && first.kind === 'lit' && first.value.type === 'string' && !UNIT_SET.includes(first.value.value)) {
        return {
            code: 'type.bad-unit-keyword',
            message: `Expected week, month or year, got '${first.value.value}'`,
            span: first.span,
            params: { actual: first.value.value },
        };
    }
    return null;
}

/** A constant weekday name is checkable now rather than at fire time. */
function requireWeekdayName(args: Expr[]): FnSigViolation | null {
    const first = args[0];
    if (first && first.kind === 'lit' && first.value.type === 'string' && weekdayFromName(first.value.value) === null) {
        return {
            code: 'type.bad-weekday-name',
            message: `Expected a weekday name (${WEEKDAY_NAMES.join(', ')}), got '${first.value.value}'`,
            span: first.span,
            params: { actual: first.value.value },
        };
    }
    return null;
}

export const FN_SIGS: Record<FnName, FnSig> = {
    format: { name: 'format', minArgs: 2, params: ['datish', 'string'], result: 'string' },
    next: { name: 'next', minArgs: 1, params: ['string', 'datish'], result: 'date', checkArgs: requireWeekdayName },
    startOf: { name: 'startOf', minArgs: 1, params: ['string', 'datish'], result: 'date', checkArgs: requireUnitKeyword },
    endOf: { name: 'endOf', minArgs: 1, params: ['string', 'datish'], result: 'date', checkArgs: requireUnitKeyword },
    nextCycle: { name: 'nextCycle', minArgs: 2, params: ['datish', 'duration'], result: 'datish' },
    date: { name: 'date', minArgs: 1, params: ['datish'], result: 'date' },
    time: { name: 'time', minArgs: 1, params: ['datish'], result: 'time' },
    'Math.floor': { name: 'Math.floor', minArgs: 1, params: ['number'], result: 'number' },
    'Math.ceil': { name: 'Math.ceil', minArgs: 1, params: ['number'], result: 'number' },
    'Math.round': { name: 'Math.round', minArgs: 1, params: ['number'], result: 'number' },
    'Math.abs': { name: 'Math.abs', minArgs: 1, params: ['number'], result: 'number' },
    'Math.min': { name: 'Math.min', minArgs: 1, params: ['number'], rest: 'number', result: 'number' },
    'Math.max': { name: 'Math.max', minArgs: 1, params: ['number'], rest: 'number', result: 'number' },
};

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/**
 * Host services the pure lang core cannot provide itself.
 * The production host formats via Obsidian's moment with weekStartDay-aware
 * locales; tests inject a lightweight stand-in.
 */
export interface EvalHost {
    formatDate(value: Value, momentTokens: string, weekStartDay: 0 | 1): string;
}

export interface EvalRuntime {
    /** Local calendar date of "now" (YYYY-MM-DD). */
    today: string;
    /** Local date+time of "now" (minute/hour grids need the clock). */
    now: { date: string; time: string };
    weekStartDay: 0 | 1;
    host: EvalHost;
}

export class FnCallError extends Error { }

export function callFn(fn: FnName, args: Value[], rt: EvalRuntime): Value {
    switch (fn) {
        case 'format': {
            const [target, tokens] = args;
            if (!isDatishValue(target)) throw new FnCallError('format() expects a date or datetime');
            if (tokens.type !== 'string') throw new FnCallError('format() expects a token string');
            return { type: 'string', value: rt.host.formatDate(target, tokens.value, rt.weekStartDay) };
        }
        case 'next': {
            const [weekday, from] = args;
            const day = weekday.type === 'string' ? weekdayFromName(weekday.value) : null;
            if (day === null) throw new FnCallError(`next() expects a weekday name (${WEEKDAY_NAMES.join(', ')})`);
            return { type: 'date', value: nextWeekdayAfter(day, datishDateOr(from, rt.today)) };
        }
        case 'startOf':
        case 'endOf': {
            const [unit, from] = args;
            if (unit.type !== 'string') throw new FnCallError(`${fn}() expects week, month or year`);
            const base = parseDateStr(datishDateOr(from, rt.today));
            return { type: 'date', value: formatDateStr(fn === 'startOf' ? startOf(unit.value, base, rt.weekStartDay) : endOf(unit.value, base, rt.weekStartDay)) };
        }
        case 'nextCycle': {
            const [anchor, step] = args;
            if (!isDatishValue(anchor)) throw new FnCallError('nextCycle() expects a date or datetime anchor');
            if (step.type !== 'duration') throw new FnCallError('nextCycle() expects a duration step');
            const anchorDate = anchor.type === 'date' ? anchor.value : anchor.date;
            const anchorTime = anchor.type === 'datetime' ? anchor.time : undefined;
            return nextCycle(anchorDate, anchorTime, { amount: step.amount, unit: step.unit }, rt);
        }
        case 'date': {
            const [v] = args;
            if (!isDatishValue(v)) throw new FnCallError('date() expects a date or datetime');
            return { type: 'date', value: v.type === 'date' ? v.value : v.date };
        }
        case 'time': {
            const [v] = args;
            if (!isDatishValue(v)) throw new FnCallError('time() expects a date or datetime');
            if (v.type === 'date') return { type: 'none' };
            return { type: 'time', value: v.time };
        }
        case 'Math.floor':
        case 'Math.ceil':
        case 'Math.round':
        case 'Math.abs':
        case 'Math.min':
        case 'Math.max':
            return callMath(fn, args);
    }
}

/**
 * The arithmetic helpers, under the name JS gives them.
 *
 * Rounding is what makes division usable: the quotient is carried to ten
 * decimal places, and a count of days or items has to come back to a whole
 * number before it can be written into a task.
 */
function callMath(fn: FnName, args: Value[]): Value {
    const numbers = args.map(a => {
        if (a.type !== 'number') throw new FnCallError(`${fn}() expects numbers`);
        return a.value;
    });
    switch (fn) {
        case 'Math.floor': return { type: 'number', value: Math.floor(numbers[0]) };
        case 'Math.ceil': return { type: 'number', value: Math.ceil(numbers[0]) };
        case 'Math.round': return { type: 'number', value: Math.round(numbers[0]) };
        case 'Math.abs': return { type: 'number', value: Math.abs(numbers[0]) };
        case 'Math.min': return { type: 'number', value: Math.min(...numbers) };
        default: return { type: 'number', value: Math.max(...numbers) };
    }
}

function datishDateOr(v: Value | undefined, fallback: string): string {
    if (v === undefined) return fallback;
    if (!isDatishValue(v)) throw new FnCallError('Expected a date or datetime argument');
    return v.type === 'date' ? v.value : v.date;
}

/** Strictly-after next occurrence of a weekday. */
export function nextWeekdayAfter(weekday: Weekday, fromDate: string): string {
    const from = parseDateStr(fromDate);
    const delta = ((weekday - from.getDay() + 7) % 7) || 7;
    return formatDateStr(addDays(from, delta));
}

// ---------------------------------------------------------------------------
// Calendar cycle (`nextCycle(anchor, step)` / the engine behind `every <interval>`)
// ---------------------------------------------------------------------------

const MAX_GRID_STEPS = 10000;

/**
 * Next cycle point: the first of (anchor + k*step) strictly after
 * max(today, anchor). Late completions skip missed occurrences; early
 * completions still land after the current instance. mo/y compute each
 * point from the original anchor via date-fns (month-end clamping without
 * accumulation — an anchor on day 31 therefore behaves as "last day of
 * month").
 */
export function nextCycle(
    anchorDate: string,
    anchorTime: string | undefined,
    step: { amount: number; unit: DurUnit },
    rt: Pick<EvalRuntime, 'today' | 'now'>
): Value & { type: 'date' | 'datetime' } {
    if (step.amount < 1) throw new FnCallError('nextCycle() step must be at least 1');

    if (step.unit === 'min' || step.unit === 'h') {
        const stepMin = step.amount * (step.unit === 'h' ? 60 : 1);
        const baseMin = toGridMinutes(anchorDate, anchorTime ?? '00:00');
        const nowMin = toGridMinutes(rt.now.date, rt.now.time);
        const k = Math.max(1, Math.floor((nowMin - baseMin) / stepMin) + 1);
        return fromGridMinutes(baseMin + k * stepMin);
    }

    if (step.unit === 'd' || step.unit === 'w') {
        const stepDays = step.amount * (step.unit === 'w' ? 7 : 1);
        const diff = differenceInCalendarDays(parseDateStr(rt.today), parseDateStr(anchorDate));
        const k = Math.max(1, Math.floor(diff / stepDays) + 1);
        return { type: 'date', value: formatDateStr(addDays(parseDateStr(anchorDate), k * stepDays)) };
    }

    // mo / y
    const base = parseDateStr(anchorDate);
    for (let k = 1; k <= MAX_GRID_STEPS; k++) {
        const candidate = step.unit === 'mo' ? addMonths(base, k * step.amount) : addYears(base, k * step.amount);
        const s = formatDateStr(candidate);
        if (s > rt.today) return { type: 'date', value: s };
    }
    throw new FnCallError('nextCycle() overflow');
}

/** Local reference day for TZ-safe minute arithmetic (not epoch-based). */
const GRID_REF_DAY = new Date(2000, 0, 1);

function toGridMinutes(date: string, time: string): number {
    const [h, m] = time.split(':').map(n => parseInt(n, 10));
    const dayNumber = differenceInCalendarDays(parseDateStr(date), GRID_REF_DAY);
    return dayNumber * 1440 + h * 60 + m;
}

function fromGridMinutes(totalMin: number): Value & { type: 'datetime' } {
    const dayNumber = Math.floor(totalMin / 1440);
    const minOfDay = totalMin - dayNumber * 1440;
    const date = new Date(GRID_REF_DAY.getFullYear(), GRID_REF_DAY.getMonth(), GRID_REF_DAY.getDate() + dayNumber);
    const h = Math.floor(minOfDay / 60);
    const m = minOfDay % 60;
    return {
        type: 'datetime',
        date: formatDateStr(date),
        time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    };
}

function startOf(unit: string, d: Date, weekStartDay: 0 | 1): Date {
    switch (unit) {
        case 'week': {
            const back = (d.getDay() - weekStartDay + 7) % 7;
            return addDays(d, -back);
        }
        case 'month': return new Date(d.getFullYear(), d.getMonth(), 1);
        default: return new Date(d.getFullYear(), 0, 1);
    }
}

function endOf(unit: string, d: Date, weekStartDay: 0 | 1): Date {
    switch (unit) {
        case 'week': return addDays(startOf('week', d, weekStartDay), 6);
        case 'month': return new Date(d.getFullYear(), d.getMonth() + 1, 0);
        default: return new Date(d.getFullYear(), 11, 31);
    }
}
