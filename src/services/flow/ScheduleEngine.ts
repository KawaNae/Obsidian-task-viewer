import { addMonths, addYears, differenceInCalendarDays } from 'date-fns';
import { EvalContext, EvalError, evalExpr } from '../lang/ExprEvaluator';
import { nextWeekdayAfter } from '../lang/functions';
import { addDuration, formatDateStr, isDatishValue, parseDateStr } from '../lang/Value';
import { EveryRule, ScheduleNode } from './FlowAst';

/** The task's primary date (start > end > due priority), if any. */
export interface DateAnchor {
    date: string;
    time?: string;
}

export interface NextOccurrence {
    date: string;
    time?: string;
}

export interface ScheduleRuntime {
    /** Local calendar date of "now". */
    today: string;
    /** Local date+time of "now" (used by min/h grids and afterDone). */
    now: { date: string; time: string };
}

const MAX_GRID_STEPS = 10000;

/**
 * Compute the next occurrence for a schedule clause.
 *
 * - `every` is calendar-grid anchored: the result is the first grid point
 *   strictly after max(today, anchor) — late completions skip missed
 *   occurrences, early completions still land after the current instance.
 * - `+N` (afterDone) is completion-anchored: today/now + duration.
 * - `at(expr)` evaluates against the PRE-shift snapshot of the original
 *   task (the expression defines the next anchor); may throw EvalError.
 *
 * Anchor-less tasks: weekday/afterDone/at need no anchor; interval and
 * monthday grids fall back to today as a pseudo-anchor.
 */
export function nextOccurrence(
    schedule: ScheduleNode,
    anchor: DateAnchor | null,
    rt: ScheduleRuntime,
    atCtx: EvalContext | null
): NextOccurrence {
    switch (schedule.kind) {
        case 'every':
            return nextGridOccurrence(schedule.rule, anchor, rt);

        case 'afterDone': {
            if (schedule.unit === 'min' || schedule.unit === 'h') {
                const v = addDuration(
                    { type: 'datetime', date: rt.now.date, time: rt.now.time },
                    { amount: schedule.amount, unit: schedule.unit }
                );
                return v.type === 'datetime' ? { date: v.date, time: v.time } : { date: v.value };
            }
            const v = addDuration({ type: 'date', value: rt.today }, { amount: schedule.amount, unit: schedule.unit });
            return v.type === 'date' ? { date: v.value } : { date: v.date, time: v.time };
        }

        case 'at': {
            if (!atCtx) throw new EvalError('at() requires an evaluation context', schedule.expr.span);
            const v = evalExpr(schedule.expr, atCtx);
            if (!isDatishValue(v)) {
                throw new EvalError(`at() must produce a date or datetime, got ${v.type}`, schedule.expr.span);
            }
            return v.type === 'date' ? { date: v.value } : { date: v.date, time: v.time };
        }
    }
}

function nextGridOccurrence(rule: EveryRule, anchor: DateAnchor | null, rt: ScheduleRuntime): NextOccurrence {
    /** Result must be strictly after both today and the current instance. */
    const lowerBound = anchor && anchor.date > rt.today ? anchor.date : rt.today;

    switch (rule.type) {
        case 'weekdays': {
            const candidates = rule.days.map(d => nextWeekdayAfter(d, lowerBound));
            candidates.sort();
            return { date: candidates[0] };
        }

        case 'interval': {
            const base = anchor?.date ?? rt.today;

            if (rule.unit === 'min' || rule.unit === 'h') {
                const stepMin = rule.amount * (rule.unit === 'h' ? 60 : 1);
                const baseMin = toMinutes(base, anchor?.time ?? '00:00');
                const nowMin = toMinutes(rt.now.date, rt.now.time);
                const k = Math.max(1, Math.floor((nowMin - baseMin) / stepMin) + 1);
                return fromMinutes(baseMin + k * stepMin);
            }

            if (rule.unit === 'd' || rule.unit === 'w') {
                const stepDays = rule.amount * (rule.unit === 'w' ? 7 : 1);
                const diff = differenceInCalendarDays(parseDateStr(rt.today), parseDateStr(base));
                const k = Math.max(1, Math.floor(diff / stepDays) + 1);
                return { date: formatDateStr(addDaysLocal(base, k * stepDays)) };
            }

            // mo / y: date-fns addMonths/addYears clamp month-ends; compute
            // each grid point from the base to avoid clamp accumulation.
            const baseDate = parseDateStr(base);
            for (let k = 1; k <= MAX_GRID_STEPS; k++) {
                const candidate = rule.unit === 'mo'
                    ? addMonths(baseDate, k * rule.amount)
                    : addYears(baseDate, k * rule.amount);
                const s = formatDateStr(candidate);
                if (s > rt.today) return { date: s };
            }
            throw new EvalError('Recurrence grid overflow', { start: 0, end: 0 });
        }

        case 'monthday': {
            const baseDate = parseDateStr(anchor?.date ?? rt.today);
            const baseMonthStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
            for (let k = 0; k <= MAX_GRID_STEPS; k++) {
                const month = addMonths(baseMonthStart, k * rule.intervalMonths);
                const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
                const day = rule.day === 'last' ? lastDay : Math.min(rule.day, lastDay);
                const s = formatDateStr(new Date(month.getFullYear(), month.getMonth(), day));
                if (s > lowerBound) return { date: s };
            }
            throw new EvalError('Recurrence grid overflow', { start: 0, end: 0 });
        }
    }
}

function addDaysLocal(dateStr: string, days: number): Date {
    const d = parseDateStr(dateStr);
    d.setDate(d.getDate() + days);
    return d;
}

/** Local reference day for TZ-safe minute arithmetic (not epoch-based). */
const REF_DAY = new Date(2000, 0, 1);

function toMinutes(date: string, time: string): number {
    const [h, m] = time.split(':').map(n => parseInt(n, 10));
    const dayNumber = differenceInCalendarDays(parseDateStr(date), REF_DAY);
    return dayNumber * 1440 + h * 60 + m;
}

function fromMinutes(totalMin: number): NextOccurrence {
    const dayNumber = Math.floor(totalMin / 1440);
    const minOfDay = totalMin - dayNumber * 1440;
    const date = new Date(REF_DAY.getFullYear(), REF_DAY.getMonth(), REF_DAY.getDate() + dayNumber);
    const h = Math.floor(minOfDay / 60);
    const m = minOfDay % 60;
    return {
        date: formatDateStr(date),
        time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    };
}
