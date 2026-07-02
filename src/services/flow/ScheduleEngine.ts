import { addMonths } from 'date-fns';
import { EvalContext, EvalError, evalExpr } from '../lang/ExprEvaluator';
import { cycleNext, nextWeekdayAfter } from '../lang/functions';
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
    /** Local date+time of "now" (minute/hour grids). */
    now: { date: string; time: string };
}

const MAX_GRID_STEPS = 10000;

/**
 * Compute the next occurrence for a schedule clause.
 *
 * - `every` is calendar-cycle anchored: the result is the first cycle point
 *   strictly after max(today, anchor) — late completions skip missed
 *   occurrences, early completions still land after the current instance.
 *   Interval rules delegate to the expression function `cycle()` so
 *   `every 3d` and `at(cycle(start, 3d))` are the same computation.
 * - `+3d` is a plain offset from the anchor date (catch-up: late
 *   completions yield past-dated instances). ≒ at(start + 3d).
 * - `at(expr)` evaluates against the PRE-shift snapshot of the original
 *   task (the expression defines the next anchor); may throw EvalError.
 *   Completion-relative offsets are written as expressions: `at(today + 3d)`
 *   (date-granular) / `at(done + 2h)` (time-granular).
 *
 * Anchor-less tasks: weekday rules need no anchor; interval / monthday /
 * plus fall back to today as a pseudo-anchor.
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

        case 'plus': {
            const base = anchor ?? { date: rt.today };
            const v = addDuration(
                base.time
                    ? { type: 'datetime', date: base.date, time: base.time }
                    : { type: 'date', value: base.date },
                { amount: schedule.amount, unit: schedule.unit }
            );
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
            const v = cycleNext(
                anchor?.date ?? rt.today,
                anchor?.time,
                { amount: rule.amount, unit: rule.unit },
                rt
            );
            return v.type === 'date' ? { date: v.value } : { date: v.date, time: v.time };
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

