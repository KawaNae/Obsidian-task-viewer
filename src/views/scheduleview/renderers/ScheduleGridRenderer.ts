import type { GridRow, TimedRenderableTask } from '../ScheduleTypes';
import type { ScheduleGridCalculator } from '../utils/ScheduleGridCalculator';

export class ScheduleGridRenderer {
    private readonly gridCalculator: ScheduleGridCalculator;
    private readonly timelineTopPaddingPx: number;

    constructor(gridCalculator: ScheduleGridCalculator, timelineTopPaddingPx: number) {
        this.gridCalculator = gridCalculator;
        this.timelineTopPaddingPx = timelineTopPaddingPx;
    }

    renderTimeMarkers(container: HTMLElement, rows: GridRow[], tasks: TimedRenderableTask[]): void {
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
        if (rows.length === 0) {
            return;
        }

        const now = new Date();
        const timeStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
        const nowMinute = this.gridCalculator.timeToVisualMinute(timeStr);
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
    }
}
