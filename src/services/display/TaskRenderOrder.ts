import type { DisplayTask } from '../../types';

function toRelativeMinutes(time: string, startHour: number): number {
    const [h, m] = time.split(':').map(Number);
    let minutes = h * 60 + m;
    if (minutes < startHour * 60) minutes += 1440;
    return minutes;
}

/** timed バケツ: visual position（startHour 起点の分数）昇順、同位置は id で tie-break */
export function compareTimedForRender(a: DisplayTask, b: DisplayTask, startHour: number): number {
    const at = a.effectiveStartTime ?? '';
    const bt = b.effectiveStartTime ?? '';
    if (at !== bt) {
        const am = toRelativeMinutes(at, startHour);
        const bm = toRelativeMinutes(bt, startHour);
        if (am !== bm) return am - bm;
    }
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
