import { toLogicalHeightPx } from '../../utils/TimelineCardPosition';
import type { AdaptiveGridLayout, GridRow, TimedRenderableTask } from '../ScheduleTypes';

export interface ScheduleGridCalculatorOptions {
    getStartHour: () => number;
    hoursPerDay: number;
    minGapHeightPx: number;
    maxGapHeightPx: number;
}

export class ScheduleGridCalculator {
    private readonly getStartHour: () => number;
    private readonly hoursPerDay: number;
    private readonly minGapHeightPx: number;
    private readonly maxGapHeightPx: number;

    constructor(options: ScheduleGridCalculatorOptions) {
        this.getStartHour = options.getStartHour;
        this.hoursPerDay = options.hoursPerDay;
        this.minGapHeightPx = options.minGapHeightPx;
        this.maxGapHeightPx = options.maxGapHeightPx;
    }

    buildAdaptiveGrid(tasks: TimedRenderableTask[]): AdaptiveGridLayout {
        const dayStart = this.getDayStartMinute();
        const dayEnd = this.getDayEndMinute();
        const boundaries = new Set<number>();

        for (let i = 0; i <= this.hoursPerDay; i++) {
            boundaries.add(dayStart + (i * 60));
        }

        for (const task of tasks) {
            boundaries.add(this.clampMinute(task.visualStartMinute, dayStart, dayEnd));
            boundaries.add(this.clampMinute(task.visualEndMinute, dayStart, dayEnd));
        }

        const sorted = Array.from(boundaries).sort((a, b) => a - b);
        const rows: GridRow[] = [];
        let cumulativeTop = 0;

        for (let i = 0; i < sorted.length; i++) {
            const minute = sorted[i];
            const nextMinute = i < sorted.length - 1 ? sorted[i + 1] : minute;
            const gapMinutes = Math.max(0, nextMinute - minute);
            const rowHeight = i < sorted.length - 1 ? this.gapToHeight(gapMinutes) : 0;

            rows.push({
                time: this.visualMinuteToTime(minute),
                minute,
                index: i,
                top: cumulativeTop,
                height: rowHeight,
            });

            cumulativeTop += rowHeight;
        }

        return { rows, totalHeight: cumulativeTop };
    }

    gapToHeight(minutes: number): number {
        if (minutes <= 0) {
            return toLogicalHeightPx(this.minGapHeightPx);
        }

        const scaledHeight = this.minGapHeightPx + (Math.sqrt(minutes) * 8);
        const displayHeight = Math.min(this.maxGapHeightPx, Math.round(scaledHeight));
        const clampedDisplayHeight = Math.max(this.minGapHeightPx, displayHeight);
        return toLogicalHeightPx(clampedDisplayHeight);
    }

    getTopForMinute(minute: number, rows: GridRow[]): number {
        if (rows.length === 0) {
            return 0;
        }

        if (minute <= rows[0].minute) {
            return rows[0].top;
        }

        for (let i = 0; i < rows.length - 1; i++) {
            const current = rows[i];
            const next = rows[i + 1];

            if (minute === current.minute) {
                return current.top;
            }

            if (minute < next.minute) {
                const gap = next.minute - current.minute;
                const ratio = gap > 0 ? (minute - current.minute) / gap : 0;
                return current.top + (ratio * current.height);
            }
        }

        return rows[rows.length - 1].top;
    }

    getTaskSpannedMinutes(tasks: TimedRenderableTask[]): Set<number> {
        const spanned = new Set<number>();

        for (const task of tasks) {
            const start = task.visualStartMinute + 1;
            const end = task.visualEndMinute;
            for (let minute = start; minute < end; minute++) {
                spanned.add(minute);
            }
        }

        return spanned;
    }

    isTaskBoundary(minute: number, tasks: TimedRenderableTask[]): boolean {
        return tasks.some((task) => task.visualStartMinute === minute || task.visualEndMinute === minute);
    }

    timeToVisualMinute(timeStr: string): number {
        const [hour, minute] = timeStr.split(':').map(Number);
        let total = (hour * 60) + minute;
        const dayStart = this.getDayStartMinute();
        if (total < dayStart) {
            total += 24 * 60;
        }
        return total;
    }

    visualMinuteToTime(minute: number): string {
        const dayMinutes = 24 * 60;
        const normalized = ((minute % dayMinutes) + dayMinutes) % dayMinutes;
        const hours = Math.floor(normalized / 60);
        const minutes = normalized % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    clampMinute(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }

    getDayStartMinute(): number {
        return this.getStartHour() * 60;
    }

    getDayEndMinute(): number {
        return this.getDayStartMinute() + (this.hoursPerDay * 60);
    }
}
