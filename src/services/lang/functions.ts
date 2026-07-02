import { addDays, addMonths, addYears, differenceInCalendarDays } from 'date-fns';
import { Span } from './Diagnostic';
import { Expr, FnName } from './ExprAst';
import {
    DurUnit, Value, Weekday, formatDateStr, isDatishValue, parseDateStr,
} from './Value';

/**
 * Static types used by the checker. 'datish' is the date|datetime family
 * (task date fields may be either depending on whether a time is present).
 * 'error' is the poison type that suppresses cascading diagnostics.
 */
export type StaticType = Value['type'] | 'datish' | 'error';

export function isDatishType(t: StaticType): boolean {
    return t === 'date' || t === 'datetime' || t === 'datish';
}

export function isAssignable(actual: StaticType, expected: StaticType): boolean {
    if (actual === 'error') return true;
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

export const FN_SIGS: Record<FnName, FnSig> = {
    format: { name: 'format', minArgs: 2, params: ['datish', 'string'], result: 'string' },
    next: { name: 'next', minArgs: 1, params: ['weekday', 'datish'], result: 'date' },
    startOf: { name: 'startOf', minArgs: 1, params: ['string', 'datish'], result: 'date', checkArgs: requireUnitKeyword },
    endOf: { name: 'endOf', minArgs: 1, params: ['string', 'datish'], result: 'date', checkArgs: requireUnitKeyword },
    grid: { name: 'grid', minArgs: 2, params: ['datish', 'duration'], result: 'datish' },
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
            if (weekday.type !== 'weekday') throw new FnCallError('next() expects a weekday');
            return { type: 'date', value: nextWeekdayAfter(weekday.value, datishDateOr(from, rt.today)) };
        }
        case 'startOf':
        case 'endOf': {
            const [unit, from] = args;
            if (unit.type !== 'string') throw new FnCallError(`${fn}() expects week, month or year`);
            const base = parseDateStr(datishDateOr(from, rt.today));
            return { type: 'date', value: formatDateStr(fn === 'startOf' ? startOf(unit.value, base, rt.weekStartDay) : endOf(unit.value, base, rt.weekStartDay)) };
        }
        case 'grid': {
            const [anchor, step] = args;
            if (!isDatishValue(anchor)) throw new FnCallError('grid() expects a date or datetime anchor');
            if (step.type !== 'duration') throw new FnCallError('grid() expects a duration step');
            const anchorDate = anchor.type === 'date' ? anchor.value : anchor.date;
            const anchorTime = anchor.type === 'datetime' ? anchor.time : undefined;
            return gridNext(anchorDate, anchorTime, { amount: step.amount, unit: step.unit }, rt);
        }
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
// Calendar grid (`grid(anchor, step)` / the engine behind `every <interval>`)
// ---------------------------------------------------------------------------

const MAX_GRID_STEPS = 10000;

/**
 * First grid point (anchor + k*step) strictly after max(today, anchor).
 * Late completions skip missed occurrences; early completions still land
 * after the current instance. mo/y compute each point from the original
 * anchor via date-fns (month-end clamping without accumulation — an anchor
 * on day 31 therefore behaves as "last day of month").
 */
export function gridNext(
    anchorDate: string,
    anchorTime: string | undefined,
    step: { amount: number; unit: DurUnit },
    rt: Pick<EvalRuntime, 'today' | 'now'>
): Value & { type: 'date' | 'datetime' } {
    if (step.amount < 1) throw new FnCallError('grid() step must be at least 1');

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
    throw new FnCallError('grid() overflow');
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
