import { describe, it, expect } from 'vitest';
import { resolveSpan } from '../../../src/utils/TaskDates';
import type { StatedDates } from '../../../src/types';

/** A local moment, `YYYY-MM-DD HH:mm`. */
const at = (text: string): number => {
    const [date, time] = text.split(' ');
    const [y, m, d] = date.split('-').map(Number);
    const [h, min] = time.split(':').map(Number);
    return new Date(y, m - 1, d, h, min).getTime();
};

const span = (stated: StatedDates, startHour = 5) => resolveSpan(stated, startHour).span;
const range = (start: string, end: string) => ({ startMs: at(start), endMs: at(end) });

describe('resolveSpan (startHour 5)', () => {
    it('@D is its visual day', () => {
        expect(span({ startDate: '2026-10-04' })).toEqual(range('2026-10-04 05:00', '2026-10-05 05:00'));
    });

    it('@D>E ends at the end of E', () => {
        expect(span({ startDate: '2026-10-01', endDate: '2026-10-04' }))
            .toEqual(range('2026-10-01 05:00', '2026-10-05 05:00'));
    });

    it('@D>D is @D', () => {
        expect(span({ startDate: '2026-10-04', endDate: '2026-10-04' })).toEqual(span({ startDate: '2026-10-04' }));
    });

    it('@>E is the visual day E', () => {
        expect(span({ endDate: '2026-10-04' })).toEqual(range('2026-10-04 05:00', '2026-10-05 05:00'));
    });

    it('@DT10:00 lasts an hour', () => {
        expect(span({ startDate: '2026-10-04', startTime: '10:00' }))
            .toEqual(range('2026-10-04 10:00', '2026-10-04 11:00'));
    });

    it('@DT23:30 runs past midnight', () => {
        expect(span({ startDate: '2026-10-04', startTime: '23:30' }))
            .toEqual(range('2026-10-04 23:30', '2026-10-05 00:30'));
    });

    it('@DT10:00>11:00 ends on the same date, or the next when before the start', () => {
        expect(span({ startDate: '2026-10-04', startTime: '10:00', endTime: '11:00' }))
            .toEqual(range('2026-10-04 10:00', '2026-10-04 11:00'));
        expect(span({ startDate: '2026-10-04', startTime: '22:00', endTime: '02:00' }))
            .toEqual(range('2026-10-04 22:00', '2026-10-05 02:00'));
    });

    it('@DT22:00>E ends at the end of E', () => {
        expect(span({ startDate: '2026-10-04', startTime: '22:00', endDate: '2026-10-06' }))
            .toEqual(range('2026-10-04 22:00', '2026-10-07 05:00'));
    });

    it('@DT10:00>D ends at the end of D', () => {
        expect(span({ startDate: '2026-10-04', startTime: '10:00', endDate: '2026-10-04' }))
            .toEqual(range('2026-10-04 10:00', '2026-10-05 05:00'));
    });

    it('@DT09:00>ET02:00 ends at the written moment', () => {
        expect(span({ startDate: '2026-10-01', startTime: '09:00', endDate: '2026-10-05', endTime: '02:00' }))
            .toEqual(range('2026-10-01 09:00', '2026-10-05 02:00'));
    });

    it('reads the rows rule 4 calls errors by the same rules, not mended', () => {
        // @D>ET10:00: the bare start, the written end.
        expect(span({ startDate: '2026-10-04', endDate: '2026-10-06', endTime: '10:00' }))
            .toEqual(range('2026-10-04 05:00', '2026-10-06 10:00'));
        // @>ET17:00: an hour before the end.
        expect(span({ endDate: '2026-10-04', endTime: '17:00' }))
            .toEqual(range('2026-10-04 16:00', '2026-10-04 17:00'));
        // @D>DT02:00: ends before it starts.
        expect(span({ startDate: '2026-10-04', endDate: '2026-10-04', endTime: '02:00' }))
            .toEqual(range('2026-10-04 05:00', '2026-10-04 02:00'));
    });

    it('takes an inherited time as a written one', () => {
        expect(span({ startDate: '2026-10-04', startTime: '06:00' }))
            .toEqual(range('2026-10-04 06:00', '2026-10-04 07:00'));
    });

    it('@>>D is read as @>D: its visual day, due at its end', () => {
        expect(resolveSpan({ due: '2026-10-04' }, 5))
            .toEqual({ span: range('2026-10-04 05:00', '2026-10-05 05:00'), dueMs: at('2026-10-05 05:00') });
    });

    it('@>>DT17:00 is read as @>DT17:00: the hour before the due', () => {
        expect(resolveSpan({ due: '2026-10-04T17:00' }, 5))
            .toEqual({ span: range('2026-10-04 16:00', '2026-10-04 17:00'), dueMs: at('2026-10-04 17:00') });
    });

    it('a due beside a start or an end does not change the span', () => {
        expect(span({ startDate: '2026-10-12', due: '2026-10-10' })).toEqual(range('2026-10-12 05:00', '2026-10-13 05:00'));
        expect(span({ endDate: '2026-10-12', due: '2026-10-10' })).toEqual(range('2026-10-12 05:00', '2026-10-13 05:00'));
    });

    it('a row with no date has no span', () => {
        expect(resolveSpan({ startTime: '10:00' }, 5)).toEqual({ span: null, dueMs: null });
        expect(resolveSpan({}, 5)).toEqual({ span: null, dueMs: null });
    });
});

describe('resolveSpan (startHour 0)', () => {
    it('@D is the calendar day', () => {
        expect(span({ startDate: '2026-10-04' }, 0)).toEqual(range('2026-10-04 00:00', '2026-10-05 00:00'));
    });

    it('a date-only end is the end of that day', () => {
        expect(span({ startDate: '2026-10-01', endDate: '2026-10-04' }, 0))
            .toEqual(range('2026-10-01 00:00', '2026-10-05 00:00'));
        expect(span({ endDate: '2026-10-04' }, 0)).toEqual(range('2026-10-04 00:00', '2026-10-05 00:00'));
    });

    it('a due date is due at the end of its day', () => {
        expect(resolveSpan({ due: '2026-10-04' }, 0).dueMs).toBe(at('2026-10-05 00:00'));
    });
});
