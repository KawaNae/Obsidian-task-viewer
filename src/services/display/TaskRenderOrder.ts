import type { DisplayTask } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

function toRelativeMinutes(time: string, startHour: number): number {
    const [h, m] = time.split(':').map(Number);
    let minutes = h * 60 + m;
    if (minutes < startHour * 60) minutes += 1440;
    return minutes;
}

// duration must mirror TaskLayout cluster sort so timedTasks index order matches level order (shadow stacking integrity)
function computeDurationMinutes(task: DisplayTask, startHour: number): number {
    const startStr = task.effectiveStartTime ?? '';
    const endStr = task.effectiveEndTime;
    if (!endStr) return DateUtils.DEFAULT_TIMED_DURATION_MINUTES;

    const startHourMinutes = startHour * 60;
    const baseDate = task.effectiveStartDate;

    let startMin: number;
    if (startStr.includes('T') && baseDate) {
        startMin = Math.floor((new Date(startStr).getTime() - new Date(`${baseDate}T00:00:00`).getTime()) / 60000);
    } else {
        startMin = DateUtils.timeToMinutes(startStr);
        if (startMin < startHourMinutes) startMin += 1440;
    }

    let endMin: number;
    if (endStr.includes('T') && baseDate) {
        endMin = Math.floor((new Date(endStr).getTime() - new Date(`${baseDate}T00:00:00`).getTime()) / 60000);
    } else {
        endMin = DateUtils.timeToMinutes(endStr);
        if (endMin < startHourMinutes) endMin += 1440;
        if (endMin < startMin) endMin += 1440;
    }

    return endMin - startMin;
}

/** timed バケツ: visual position（startHour 起点の分数）昇順、同位置は duration 降順（長い→DOM早い→背面）、最後に id 昇順 */
export function compareTimedForRender(a: DisplayTask, b: DisplayTask, startHour: number): number {
    const at = a.effectiveStartTime ?? '';
    const bt = b.effectiveStartTime ?? '';
    if (at !== bt) {
        const am = toRelativeMinutes(at, startHour);
        const bm = toRelativeMinutes(bt, startHour);
        if (am !== bm) return am - bm;
    }
    const aDur = computeDurationMinutes(a, startHour);
    const bDur = computeDurationMinutes(b, startHour);
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
