import type { GridRow, TimedDisplayTask } from '../ScheduleTypes';
import type { ScheduleGridCalculator } from '../utils/ScheduleGridCalculator';

export class ScheduleGridRenderer {
    // Centers the 16px-tall chip on the now-line's own box, not on a grid
    // row's line. `.schedule-grid__line` sits at top:-1px with 1px height
    // (center at +0.5 relative to its row), but `.schedule-grid__now-line`
    // has no such correction and is 2px tall (center at topPx + 1). So chip
    // top = topPx - (8 - 1) = topPx - 7 puts the chip's own center (top + 8)
    // on the line's center. Measured on real render: with the old offset of
    // 10 the chip's center sat 2.5px above the line's (2026-08-22).
    private static readonly NOW_LABEL_TOP_OFFSET_PX = 7;

    private readonly gridCalculator: ScheduleGridCalculator;
    private readonly timelineTopPaddingPx: number;

    constructor(gridCalculator: ScheduleGridCalculator, timelineTopPaddingPx: number) {
        this.gridCalculator = gridCalculator;
        this.timelineTopPaddingPx = timelineTopPaddingPx;
    }

    renderTimeMarkers(container: HTMLElement, rows: GridRow[], tasks: TimedDisplayTask[]): void {
        const markersLayer = container.createDiv('schedule-grid__markers');
        const spannedMinutes = this.gridCalculator.getTaskSpannedMinutes(tasks);

        for (const row of rows) {
            const marker = markersLayer.createDiv('schedule-grid__marker');
            marker.dataset.time = row.time;
            marker.style.top = `${row.top + this.timelineTopPaddingPx}px`;

            const isTaskBoundary = this.gridCalculator.isTaskBoundary(row.minute, tasks);
            const isSpanned = spannedMinutes.has(row.minute);

            if (isTaskBoundary || !isSpanned) {
                const label = marker.createSpan('schedule-grid__label');
                label.setText(row.time);
            }

            const isHourBoundary = row.minute % 60 === 0;
            marker.createDiv(
                isHourBoundary
                    ? 'schedule-grid__line schedule-grid__line--major'
                    : 'schedule-grid__line schedule-grid__line--minor'
            );
        }
    }

    renderNowLine(container: HTMLElement, rows: GridRow[], timelineHeight: number): void {
        this.paintNowLine(container, rows, timelineHeight);
    }

    /**
     * Re-paints the now-line and its time chip in place: removes whatever is
     * already there and redraws at the current time. Driven by a per-minute
     * interval in ScheduleView so the indicator keeps moving between full
     * re-renders (which only happen on task changes / navigation).
     */
    updateNowLine(container: HTMLElement, rows: GridRow[], timelineHeight: number): void {
        container.querySelector('.schedule-grid__now-line')?.remove();
        container.querySelector('.schedule-grid__now-label')?.remove();
        this.paintNowLine(container, rows, timelineHeight);
    }

    private paintNowLine(container: HTMLElement, rows: GridRow[], timelineHeight: number): void {
        if (rows.length === 0) {
            return;
        }

        const nowMinute = this.getNowVisualMinute();
        const firstMinute = rows[0].minute;
        const lastMinute = rows[rows.length - 1].minute;

        if (nowMinute < firstMinute || nowMinute > lastMinute) {
            return;
        }

        const topPx = this.gridCalculator.getTopForMinute(nowMinute, rows) + this.timelineTopPaddingPx;
        if (topPx < 0 || topPx > timelineHeight) {
            return;
        }

        const nowLine = container.createDiv('schedule-grid__now-line');
        nowLine.style.top = `${topPx}px`;

        const nowLabel = container.createDiv('schedule-grid__now-label');
        nowLabel.style.top = `${topPx - ScheduleGridRenderer.NOW_LABEL_TOP_OFFSET_PX}px`;
        nowLabel.setText(this.gridCalculator.visualMinuteToTime(Math.floor(nowMinute)));
    }

    /**
     * Current time as a visual (startHour-relative) minute, with seconds
     * folded in as a fraction. `getTopForMinute` interpolates linearly within
     * a row, so a fractional minute is fine here and keeps the line's
     * position from snapping in whole-minute steps — the gap can be up to
     * ~41px in a compressed (sqrt-scaled) row when seconds are dropped.
     */
    private getNowVisualMinute(): number {
        const now = new Date();
        const dayStart = this.gridCalculator.getDayStartMinute();
        let total = (now.getHours() * 60) + now.getMinutes() + (now.getSeconds() / 60);
        if (total < dayStart) {
            total += 24 * 60;
        }
        return total;
    }
}
