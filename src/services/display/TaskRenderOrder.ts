import type { DisplayTask } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

// The same span TaskLayout stacks by, so timedTasks index order matches level order (shadow stacking integrity).
function durationMinutes(task: DisplayTask, startHour: number): number {
    const { start, end } = DateUtils.timedSpanMinutes(task.effectiveStartTime ?? '', task.effectiveEndTime, startHour);
    return end - start;
}

/** timed バケツ: visual position（startHour 起点の分数）昇順、同位置は duration 降順（長い→DOM早い→背面）、最後に id 昇順 */
export function compareTimedForRender(a: DisplayTask, b: DisplayTask, startHour: number): number {
    const at = a.effectiveStartTime ?? '';
    const bt = b.effectiveStartTime ?? '';
    if (at !== bt) {
        const am = DateUtils.visualDayMinutes(at, startHour);
        const bm = DateUtils.visualDayMinutes(bt, startHour);
        if (am !== bm) return am - bm;
    }
    const aDur = durationMinutes(a, startHour);
    const bDur = durationMinutes(b, startHour);
    if (aDur !== bDur) return bDur - aDur;
    const ai = a.id ?? '';
    const bi = b.id ?? '';
    return ai < bi ? -1 : ai > bi ? 1 : 0;
}

/** allDay バケツ: 開始日 (YYYY-MM-DD) 昇順、同日は id で tie-break */
export function compareAllDayForRender(a: DisplayTask, b: DisplayTask): number {
    const ad = a.effectiveStartDate ?? '';
    const bd = b.effectiveStartDate ?? '';
    if (ad !== bd) return ad < bd ? -1 : 1;
    const ai = a.id ?? '';
    const bi = b.id ?? '';
    return ai < bi ? -1 : ai > bi ? 1 : 0;
}

/** dueOnly バケツ: due フル ISO 昇順、同時刻は id で tie-break */
export function compareDueOnlyForRender(a: DisplayTask, b: DisplayTask): number {
    const ad = a.due ?? '';
    const bd = b.due ?? '';
    if (ad !== bd) return ad < bd ? -1 : 1;
    const ai = a.id ?? '';
    const bi = b.id ?? '';
    return ai < bi ? -1 : ai > bi ? 1 : 0;
}
