import { describe, expect, it } from 'vitest';
import { GridMoveGesture } from '../../../src/interaction/drag/strategies/grid/GridMoveGesture';
import type { Task } from '../../../src/types';

/** 最低限のフィールドを持つ Task を返す。drag が見るのは startDate/endDate/endTime。 */
function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'tv-inline:test.md:ln:1',
        file: 'test.md',
        line: 0,
        content: 'test',
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        childLineBodyOffsets: [],
        tags: [],
        originalText: '- [ ] test',
        parserId: 'tv-inline',
        ...overrides,
    };
}

describe('GridMoveGesture.buildMoveEdits', () => {
    it('returns null when dayDelta is 0 (no-op release)', () => {
        const baseTask = makeTask({ startDate: '2026-04-20', endDate: '2026-04-22' });
        expect(GridMoveGesture.buildMoveEdits('2026-04-20', '2026-04-22', 0, baseTask)).toBeNull();
    });

    it('shifts start only when baseTask has neither endDate nor endTime', () => {
        const baseTask = makeTask({ startDate: '2026-04-20' });
        const edits = GridMoveGesture.buildMoveEdits('2026-04-20', '2026-04-20', 2, baseTask);
        expect(edits).toEqual({ effectiveStartDate: '2026-04-22' });
    });

    it('shifts both start and end when baseTask has endDate', () => {
        const baseTask = makeTask({ startDate: '2026-04-20', endDate: '2026-04-22' });
        const edits = GridMoveGesture.buildMoveEdits('2026-04-20', '2026-04-22', 3, baseTask);
        expect(edits).toEqual({ effectiveStartDate: '2026-04-23', effectiveEndDate: '2026-04-25' });
    });

    it('shifts both start and end when baseTask has endTime (timed task)', () => {
        const baseTask = makeTask({ startDate: '2026-04-20', startTime: '13:00', endTime: '14:00' });
        const edits = GridMoveGesture.buildMoveEdits('2026-04-20', '2026-04-20', 1, baseTask);
        expect(edits).toEqual({ effectiveStartDate: '2026-04-21', effectiveEndDate: '2026-04-21' });
    });

    it('handles negative dayDelta (drag left)', () => {
        const baseTask = makeTask({ startDate: '2026-04-25', endDate: '2026-04-27' });
        const edits = GridMoveGesture.buildMoveEdits('2026-04-25', '2026-04-27', -2, baseTask);
        expect(edits).toEqual({ effectiveStartDate: '2026-04-23', effectiveEndDate: '2026-04-25' });
    });

    it('shifts end too when only endTime is set (no endDate)', () => {
        // S-Timed: endDate なし、endTime あり → endTime が dual-semantic を決める
        const baseTask = makeTask({ startDate: '2026-04-20', startTime: '14:00', endTime: '16:00' });
        const edits = GridMoveGesture.buildMoveEdits('2026-04-20', '2026-04-20', 5, baseTask);
        expect(edits).toEqual({ effectiveStartDate: '2026-04-25', effectiveEndDate: '2026-04-25' });
    });
});

describe('GridMoveGesture.buildTimelineDropEdits', () => {
    /** 最小限の day-column shim (jsdom なしで pure helper をテストするため plain object)。
     *  buildTimelineDropEdits が読むのは dataset.date と getBoundingClientRect().top のみ。 */
    function makeTimelineSection(date: string | undefined, top: number): HTMLElement {
        return {
            dataset: date !== undefined ? { date } : {},
            getBoundingClientRect: () => ({
                top, left: 0, right: 100, bottom: top + 1000, width: 100, height: 1000,
                x: 0, y: top, toJSON: () => ({}),
            }),
        } as unknown as HTMLElement;
    }

    it('returns null when section has no dataset.date', () => {
        const section = makeTimelineSection(undefined, 0);
        const edits = GridMoveGesture.buildTimelineDropEdits(section, 100, 2, 5);
        expect(edits).toBeNull();
    });

    it('snaps start time to 15-minute grid based on clientY offset', () => {
        const section = makeTimelineSection('2026-04-20', 0);
        // clientY=120, zoom=2 → yInContainer=120, snapPixels=30 → snappedTop=120, minutesFromStart=60
        // startHour=5, totalMin = 5*60 + 60 = 360 = 06:00
        const edits = GridMoveGesture.buildTimelineDropEdits(section, 120, 2, 5);
        expect(edits).toMatchObject({
            effectiveStartDate: '2026-04-20',
            effectiveStartTime: '06:00',
            effectiveEndDate: '2026-04-20',
            // endTime = start + DEFAULT_TIMED_DURATION_MINUTES (60) = 07:00
            effectiveEndTime: '07:00',
        });
    });

    it('crosses day boundary when totalMin >= 1440', () => {
        // section top=0, clientY=2400, zoom=2 → yInContainer=2400, snapPixels=30,
        // snappedTop=2400, minutesFromStart=1200, startHourMinutes=300, totalMin=1500
        // startDayOffset = floor(1500/1440) = 1 → next day
        // normStart = 1500-1440 = 60 → 01:00
        const section = makeTimelineSection('2026-04-20', 0);
        const edits = GridMoveGesture.buildTimelineDropEdits(section, 2400, 2, 5);
        expect(edits?.effectiveStartDate).toBe('2026-04-21');
        expect(edits?.effectiveStartTime).toBe('01:00');
    });

    it('aligns to startHour when clientY equals section top', () => {
        const section = makeTimelineSection('2026-04-20', 100);
        // clientY=100, top=100 → yInContainer=0 → totalMin=startHour*60=300=05:00
        const edits = GridMoveGesture.buildTimelineDropEdits(section, 100, 2, 5);
        expect(edits?.effectiveStartTime).toBe('05:00');
        expect(edits?.effectiveEndTime).toBe('06:00');
    });
});
