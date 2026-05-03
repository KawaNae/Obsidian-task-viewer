import { DateUtils } from '../../../utils/DateUtils';
import type { GhostPlan } from '../ghost/GhostPlan';
import type { GridSurface, GridSurfaceTarget, LocatePointerOpts, PlanSegmentsInput } from './GridSurface';

const HANDLE_HYSTERESIS_PX = 8;

/**
 * Calendar (cal-week-row × N + 7-col grid) 用の {@link GridSurface} 実装。
 *
 * BaseDragStrategy が抱えていた calendar 専用ヘルパー (resolveCalendarPointerTarget,
 * planCalendarSegments, getCalendarDayColumnWidth, hysteresis 等) を 1 箇所に
 * 集約する。container は CalendarView の root を渡す前提。
 */
export class CalendarGridSurface implements GridSurface {
    constructor(
        private readonly container: HTMLElement,
        private readonly fallbackColWidth: () => number = () => 100,
    ) {}

    locatePointer(clientX: number, clientY: number, opts: LocatePointerOpts = {}): GridSurfaceTarget | null {
        const doc = this.container.ownerDocument || document;
        const suppressEl = opts.suppressEl ?? null;
        let elBelow: Element | null;

        if (suppressEl) {
            const prev = suppressEl.style.pointerEvents;
            suppressEl.style.pointerEvents = 'none';
            elBelow = doc.elementFromPoint(clientX, clientY);
            suppressEl.style.pointerEvents = prev;
        } else {
            elBelow = doc.elementFromPoint(clientX, clientY);
        }

        let weekRow = elBelow?.closest('.cal-week-row') as HTMLElement | null;
        if (!weekRow) {
            weekRow = this.findNearestWeekRow(clientY);
        }
        if (!weekRow) return null;

        const weekStart = weekRow.dataset.weekStart;
        if (!weekStart) return null;

        const dayHeaders = this.getDayHeaders(weekRow);
        let colWidth = this.getDayColumnWidth(weekRow);
        let col = 1;

        if (dayHeaders.length === 7) {
            const dayRects = dayHeaders.map((h) => h.getBoundingClientRect());
            const firstRect = dayRects[0];
            const lastRect = dayRects[dayRects.length - 1];

            // 右ハンドルは CSS で card.right から +12px 外側に置かれる (-12px right offset)。
            // ハンドル中心は次セルの左端付近にあるため、ハンドルを掴んだだけで
            // findIndex が次セルを返してしまい +1 day ドリフトを生む。
            // resize 中だけヒステリシスを入れ、セル端の HYSTERESIS_PX 内は前セル扱いにする。
            const dir = opts.resizeDirection ?? null;
            let containsIndex = -1;
            if (dir === 'right') {
                containsIndex = dayRects.findIndex((r) => clientX >= r.left && clientX <= r.right - HANDLE_HYSTERESIS_PX);
                if (containsIndex < 0) {
                    containsIndex = dayRects.findIndex((r) => clientX >= r.left && clientX <= r.right);
                }
            } else if (dir === 'left') {
                containsIndex = dayRects.findIndex((r) => clientX >= r.left + HANDLE_HYSTERESIS_PX && clientX <= r.right);
                if (containsIndex < 0) {
                    containsIndex = dayRects.findIndex((r) => clientX >= r.left && clientX <= r.right);
                }
            } else {
                containsIndex = dayRects.findIndex((r) => clientX >= r.left && clientX <= r.right);
            }

            if (containsIndex >= 0) {
                col = containsIndex + 1;
            } else if (clientX < firstRect.left) {
                col = 1;
            } else if (clientX > lastRect.right) {
                col = 7;
            } else {
                let nearestIndex = 0;
                let nearestDistance = Number.POSITIVE_INFINITY;
                dayRects.forEach((r, i) => {
                    const center = (r.left + r.right) / 2;
                    const d = Math.abs(clientX - center);
                    if (d < nearestDistance) { nearestDistance = d; nearestIndex = i; }
                });
                col = nearestIndex + 1;
            }
            if (dayRects[0].width > 0) colWidth = dayRects[0].width;
        } else {
            // day cell が読めない場合は week 全体幅を 7 等分する fallback
            const weekRect = weekRow.getBoundingClientRect();
            let dayAreaLeft = weekRect.left;
            let dayAreaWidth = weekRect.width;
            if (this.getColumnOffset(weekRow) > 0) {
                const wn = weekRow.querySelector('.cal-week-number');
                if (wn instanceof HTMLElement) {
                    const wnRect = wn.getBoundingClientRect();
                    dayAreaLeft = wnRect.right;
                    dayAreaWidth = Math.max(0, weekRect.right - wnRect.right);
                }
            }
            colWidth = dayAreaWidth > 0 ? dayAreaWidth / 7 : this.fallbackColWidth();
            const rawCol = Math.floor((clientX - dayAreaLeft) / colWidth) + 1;
            col = Math.min(7, Math.max(1, rawCol));
        }

        return {
            rowEl: weekRow,
            col,
            colWidth,
            weekStart,
            targetDate: DateUtils.addDays(weekStart, col - 1),
        };
    }

    planSegments(input: PlanSegmentsInput): GhostPlan[] {
        const { rangeStart, rangeEnd, trackIndex } = input;
        const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
        const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
        const weekRows = this.getWeekRows();
        if (weekRows.length === 0) return [];

        const plans: GhostPlan[] = [];
        for (const weekRow of weekRows) {
            const weekStart = weekRow.dataset.weekStart;
            if (!weekStart) continue;
            const weekEnd = DateUtils.addDays(weekStart, 6);
            if (start > weekEnd || end < weekStart) continue;

            const segStart = start < weekStart ? weekStart : start;
            const segEnd = end > weekEnd ? weekEnd : end;
            const colStart = DateUtils.getDiffDays(weekStart, segStart) + 1;
            const span = DateUtils.getDiffDays(segStart, segEnd) + 1;
            if (colStart < 1 || span < 1) continue;

            const colOffset = this.getColumnOffset(weekRow);
            const splitClasses: string[] = [];
            if (start < weekStart) splitClasses.push('task-card--split-continues-before');
            if (end > weekEnd) splitClasses.push('task-card--split-continues-after');

            plans.push({
                layout: 'grid',
                parent: weekRow,
                gridColumn: `${colStart + colOffset} / span ${span}`,
                gridRow: `${trackIndex + 2}`,
                splitClasses,
            });
        }
        return plans;
    }

    /** Calendar は week-rows が複数あるので clamp 不要。 */
    clampDayDelta(dayDelta: number): number {
        return dayDelta;
    }

    getColWidth(): number {
        const rows = this.getWeekRows();
        if (rows.length === 0) return this.fallbackColWidth();
        return this.getDayColumnWidth(rows[0]);
    }

    /** 週番号列 (cal-week-number) があるかで grid-column の base offset が変わる。 */
    private getColumnOffset(weekRow: HTMLElement): number {
        return weekRow.classList.contains('has-week-numbers') ? 1 : 0;
    }

    private getWeekRows(): HTMLElement[] {
        return Array.from(this.container.querySelectorAll('.cal-week-row'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement);
    }

    private getDayHeaders(weekRow: HTMLElement): HTMLElement[] {
        return Array.from(weekRow.querySelectorAll('.cal-day-cell'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement);
    }

    private getDayColumnWidth(weekRow: HTMLElement): number {
        for (const h of this.getDayHeaders(weekRow)) {
            const r = h.getBoundingClientRect();
            if (r.width > 0) return r.width;
        }
        const weekRect = weekRow.getBoundingClientRect();
        if (weekRect.width > 0) {
            let dayAreaWidth = weekRect.width;
            if (this.getColumnOffset(weekRow) > 0) {
                const wn = weekRow.querySelector('.cal-week-number');
                if (wn instanceof HTMLElement) {
                    const wnRect = wn.getBoundingClientRect();
                    dayAreaWidth = Math.max(0, weekRect.right - wnRect.right);
                }
            }
            if (dayAreaWidth > 0) return dayAreaWidth / 7;
        }
        return this.fallbackColWidth();
    }

    private findNearestWeekRow(clientY: number): HTMLElement | null {
        const rows = this.getWeekRows();
        if (rows.length === 0) return null;
        let nearest: HTMLElement | null = null;
        let minDist = Number.POSITIVE_INFINITY;
        for (const row of rows) {
            const r = row.getBoundingClientRect();
            const d = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
            if (d < minDist) { minDist = d; nearest = row; }
        }
        return nearest;
    }
}
