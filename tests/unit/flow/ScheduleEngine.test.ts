import { describe, it, expect } from 'vitest';
import { parseFlow } from '../../../src/services/flow/FlowParser';
import { DateAnchor, ScheduleRuntime, nextOccurrence } from '../../../src/services/flow/ScheduleEngine';
import { EvalContext } from '../../../src/services/lang/ExprEvaluator';

// 2026-07-02 is a Thursday.
const RT: ScheduleRuntime = { today: '2026-07-02', now: { date: '2026-07-02', time: '10:00' } };

function next(src: string, anchor: DateAnchor | null, rt: ScheduleRuntime = RT, atCtx: EvalContext | null = null) {
    const { program, diagnostics } = parseFlow(src);
    if (!program?.schedule) throw new Error(`no schedule: ${diagnostics.map(d => d.message).join('; ')}`);
    return nextOccurrence(program.schedule, anchor, rt, atCtx);
}

describe('ScheduleEngine', () => {
    describe('every weekdays', () => {
        it('returns the first matching weekday strictly after today', () => {
            expect(next('every thu', { date: '2026-07-02' })).toEqual({ date: '2026-07-09' });
            expect(next('every fri', { date: '2026-07-02' })).toEqual({ date: '2026-07-03' });
        });

        it('picks the earliest day from a list', () => {
            expect(next('every mon,fri', { date: '2026-07-02' })).toEqual({ date: '2026-07-03' });
        });

        it('skips missed occurrences on late completion', () => {
            // Task dated two weeks ago, completed today → next is after today, not backfilled
            expect(next('every mon', { date: '2026-06-15' })).toEqual({ date: '2026-07-06' });
        });

        it('lands after the current instance on early completion', () => {
            // Task dated next Tuesday, completed today (early) → next Tuesday AFTER the instance
            expect(next('every tue', { date: '2026-07-07' })).toEqual({ date: '2026-07-14' });
        });
    });

    describe('every interval (grid)', () => {
        it('advances on the anchor grid', () => {
            // anchor 6/24 (Wed), 2w grid → 7/8 is the first point after 7/2
            expect(next('every 2w', { date: '2026-06-24' })).toEqual({ date: '2026-07-08' });
        });

        it('skips missed grid points on late completion', () => {
            // anchor 5/6, 2w grid: 5/20, 6/3, 6/17, 7/1, 7/15 → first after 7/2 is 7/15
            expect(next('every 2w', { date: '2026-05-06' })).toEqual({ date: '2026-07-15' });
        });

        it('handles month grids with end-of-month clamping', () => {
            expect(next('every 1mo', { date: '2026-01-31' })).toEqual({ date: '2026-07-31' });
            // 6/30 + 1mo = 7/30 > today
            expect(next('every 1mo', { date: '2026-06-30' })).toEqual({ date: '2026-07-30' });
        });

        it('handles year grids', () => {
            expect(next('every 1y', { date: '2026-03-01' })).toEqual({ date: '2027-03-01' });
        });

        it('falls back to today as pseudo-anchor when dateless', () => {
            expect(next('every 1w', null)).toEqual({ date: '2026-07-09' });
        });

        it('computes minute/hour grids with times', () => {
            expect(next('every 4h', { date: '2026-07-02', time: '01:00' }))
                .toEqual({ date: '2026-07-02', time: '13:00' });
            expect(next('every 90min', { date: '2026-07-02', time: '09:30' }))
                .toEqual({ date: '2026-07-02', time: '11:00' });
        });

        it('rolls hour grids across midnight', () => {
            expect(next('every 12h', { date: '2026-07-02', time: '23:00' }, { today: '2026-07-02', now: { date: '2026-07-02', time: '23:30' } }))
                .toEqual({ date: '2026-07-03', time: '11:00' });
        });
    });

    describe('every monthday', () => {
        it('returns this month when the day is still ahead', () => {
            expect(next('every mo@25', { date: '2026-06-25' })).toEqual({ date: '2026-07-25' });
        });

        it('rolls to next month when the day has passed', () => {
            expect(next('every mo@1', { date: '2026-07-01' })).toEqual({ date: '2026-08-01' });
        });

        it('clamps short months for day 29-31', () => {
            expect(next('every mo@31', { date: '2026-01-31' }, { today: '2026-02-01', now: { date: '2026-02-01', time: '09:00' } }))
                .toEqual({ date: '2026-02-28' });
        });

        it('supports mo@last', () => {
            expect(next('every mo@last', { date: '2026-06-30' })).toEqual({ date: '2026-07-31' });
        });

        it('supports multi-month grids', () => {
            // anchor month June, every 2 months @15 → June 15 passed? today 7/2 → Aug 15
            expect(next('every 2mo@15', { date: '2026-06-15' })).toEqual({ date: '2026-08-15' });
        });
    });

    describe('completion-relative expressions (at(today/done + N))', () => {
        it('adds days to today regardless of anchor (at(today + Nd))', () => {
            expect(next('at(today + 3d)', { date: '2026-01-01' }, RT, ctxFor(RT))).toEqual({ date: '2026-07-05' });
        });

        it('adds calendar months with clamping', () => {
            const rt = { today: '2026-01-31', now: { date: '2026-01-31', time: '09:00' } };
            expect(next('at(today + 1mo)', null, rt, ctxFor(rt))).toEqual({ date: '2026-02-28' });
        });

        it('adds minutes/hours from now with time in the result (at(done + N))', () => {
            expect(next('at(done + 2h)', null, RT, ctxFor(RT))).toEqual({ date: '2026-07-02', time: '12:00' });
            expect(next('at(done + 30min)', null, RT, ctxFor(RT))).toEqual({ date: '2026-07-02', time: '10:30' });
        });

        it('today stays date-granular — no completion time leaks in', () => {
            expect(next('at(today + 3d)', null, RT, ctxFor(RT))).toEqual({ date: '2026-07-05' });
        });
    });

    describe('at(expr)', () => {
        const ctx: EvalContext = {
            props: { start: { type: 'date', value: '2026-07-01' } },
            today: RT.today,
            now: RT.now,
            weekStartDay: 1,
            host: { formatDate: () => '' },
        };

        it('evaluates the expression against the provided context', () => {
            expect(next('at(start + 10d)', null, RT, ctx)).toEqual({ date: '2026-07-11' });
        });

        it('passes datetime results through with time', () => {
            expect(next('at(done + 1h)', null, RT, { ...ctx, props: { done: { type: 'datetime', date: '2026-07-02', time: '10:00' } } }))
                .toEqual({ date: '2026-07-02', time: '11:00' });
        });

        it('at(grid(start, 3d)) matches every 3d exactly', () => {
            const anchor = { date: '2026-06-24' };
            const gridCtx: EvalContext = { ...ctx, props: { start: { type: 'date', value: anchor.date } } };
            expect(next('at(grid(start, 3d))', anchor, RT, gridCtx))
                .toEqual(next('every 3d', anchor, RT, null));
        });

        it('grid month steps clamp like every Nmo (anchor day 31 = month-end)', () => {
            const gridCtx: EvalContext = { ...ctx, props: { start: { type: 'date', value: '2026-01-31' } } };
            expect(next('at(grid(start, 1mo))', { date: '2026-01-31' }, RT, gridCtx)).toEqual({ date: '2026-07-31' });
        });
    });
});

/** Completion-context (done/today) for at() expressions in these tests. */
function ctxFor(rt: { today: string; now: { date: string; time: string } }): EvalContext {
    return {
        props: {
            done: { type: 'datetime', date: rt.now.date, time: rt.now.time },
            today: { type: 'date', value: rt.today },
        },
        today: rt.today,
        now: rt.now,
        weekStartDay: 1,
        host: { formatDate: () => '' },
    };
}
