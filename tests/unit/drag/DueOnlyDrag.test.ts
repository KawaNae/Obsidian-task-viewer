import { describe, expect, it } from 'vitest';
import { dragBase, planUpdates } from '../../../src/interaction/drag/DragPlan';
import { GridMoveGesture } from '../../../src/interaction/drag/strategies/grid/GridMoveGesture';
import { GridResizeGesture } from '../../../src/interaction/drag/strategies/grid/GridResizeGesture';
import type { DisplayDateEdits } from '../../../src/services/display/DisplayTaskConverter';
import { formatDateBlock } from '../../../src/services/parsing/tv-inline/DateBlockFormat';
import { dueSpanWritten } from '../../../src/utils/TaskDates';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

/**
 * A card of a task with only a due is moved and stretched as the span it is
 * drawn with (`@>>D` as `@D`, `@>>DT17:00` as the hour before), and the due
 * stays (startHour 5).
 */
const startHour = 5;

/** The date block the drag leaves on the line. */
function written(raw: Task, edits: (base: Task) => DisplayDateEdits | null): string {
    const base = dragBase(raw, startHour);
    const e = edits(base);
    if (!e) return formatDateBlock(raw);
    return formatDateBlock({ ...raw, ...planUpdates({ edits: e, baseTask: base }, raw, startHour) });
}

describe('dueSpanWritten', () => {
    it('a due date is the start date, the same day', () => {
        expect(dueSpanWritten(makeTask({ due: '2026-10-10' }), startHour)).toEqual({ startDate: '2026-10-10' });
    });

    it('a timed due is the hour before it', () => {
        expect(dueSpanWritten(makeTask({ due: '2026-10-10T17:00' }), startHour))
            .toEqual({ startDate: '2026-10-10', startTime: '16:00', endTime: '17:00' });
    });

    it('the end date is written only when it is not the start date', () => {
        expect(dueSpanWritten(makeTask({ due: '2026-10-10T00:30' }), startHour))
            .toEqual({ startDate: '2026-10-09', startTime: '23:30', endDate: '2026-10-10', endTime: '00:30' });
    });

    it('an inherited due gives a span too', () => {
        expect(dueSpanWritten(makeTask({ cascadeContext: { due: '2026-10-10' } }), startHour))
            .toEqual({ startDate: '2026-10-10' });
    });

    it('is empty for a task with a start or an end', () => {
        expect(dueSpanWritten(makeTask({ startDate: '2026-10-08', due: '2026-10-10' }), startHour)).toEqual({});
        expect(dueSpanWritten(makeTask({ endDate: '2026-10-08', due: '2026-10-10' }), startHour)).toEqual({});
        expect(dueSpanWritten(makeTask({}), startHour)).toEqual({});
    });
});

describe('dragging a due-only card writes the span and keeps the due', () => {
    const bare = makeTask({ due: '2026-10-10' });
    const timed = makeTask({ due: '2026-10-10T17:00' });

    it('moving @>>D to two days later writes the start', () => {
        expect(written(bare, base => GridMoveGesture.buildMoveEdits('2026-10-10', '2026-10-10', 2, base)))
            .toBe('@2026-10-12>>2026-10-10');
    });

    it('stretching the right edge writes the start and the end', () => {
        expect(written(bare, base => GridResizeGesture.buildResizeEdits('right', '2026-10-12', '2026-10-10', '2026-10-10', base)))
            .toBe('@2026-10-10>2026-10-12>2026-10-10');
    });

    it('stretching the left edge writes the start and keeps the end', () => {
        expect(written(bare, base => GridResizeGesture.buildResizeEdits('left', '2026-10-08', '2026-10-10', '2026-10-10', base)))
            .toBe('@2026-10-08>2026-10-10>2026-10-10');
    });

    it("stretching @>>DT17:00's bottom edge to 18:00 writes the hour's start and the new end", () => {
        // As TimelineResizeGesture.finishResize builds it: the kept start, the new end.
        expect(written(timed, () => ({
            startDay: '2026-10-10', startTime: '16:00', endDay: '2026-10-10', endTime: '18:00',
        }))).toBe('@2026-10-10T16:00>18:00>2026-10-10T17:00');
    });

    it('moving @>>DT17:00 on Calendar to two days later writes the hour on that day', () => {
        expect(written(timed, base => GridMoveGesture.buildMoveEdits('2026-10-10', '2026-10-10', 2, base)))
            .toBe('@2026-10-12T16:00>17:00>2026-10-10T17:00');
    });

    it('a release that changes nothing writes nothing', () => {
        const base = dragBase(bare, startHour);
        expect(planUpdates({ edits: { startDay: '2026-10-10' }, baseTask: base }, bare, startHour))
            .toEqual({ startDate: '2026-10-10' });
        const plain = makeTask({ startDate: '2026-10-10' });
        expect(planUpdates({ edits: { startDay: '2026-10-10' }, baseTask: dragBase(plain, startHour) }, plain, startHour))
            .toEqual({});
    });
});
