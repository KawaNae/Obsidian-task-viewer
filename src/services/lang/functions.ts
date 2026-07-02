import { addDays } from 'date-fns';
import { Span } from './Diagnostic';
import { Expr, FnName } from './ExprAst';
import {
    Value, Weekday, formatDateStr, isDatishValue, parseDateStr,
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

export interface FnSig {
    name: FnName;
    minArgs: number;
    /** Expected type per position (covers minArgs..params.length). */
    params: StaticType[];
    result: StaticType;
    /**
     * Extra constraint applied at check time (e.g. unit keyword must be a
     * constant). Returns an error message or null.
     */
    checkArgs?: (args: Expr[]) => { message: string; span: Span } | null;
}

const UNIT_SET = ['week', 'month', 'year'];

function requireUnitKeyword(args: Expr[]): { message: string; span: Span } | null {
    const first = args[0];
    if (first && first.kind === 'lit' && first.value.type === 'string' && !UNIT_SET.includes(first.value.value)) {
        return { message: `Expected week, month or year, got '${first.value.value}'`, span: first.span };
    }
    return null;
}

export const FN_SIGS: Record<FnName, FnSig> = {
    format: { name: 'format', minArgs: 2, params: ['datish', 'string'], result: 'string' },
    next: { name: 'next', minArgs: 1, params: ['weekday', 'datish'], result: 'date' },
    startOf: { name: 'startOf', minArgs: 1, params: ['string', 'datish'], result: 'date', checkArgs: requireUnitKeyword },
    endOf: { name: 'endOf', minArgs: 1, params: ['string', 'datish'], result: 'date', checkArgs: requireUnitKeyword },
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
