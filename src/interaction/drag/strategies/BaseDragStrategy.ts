import { DragStrategy, DragContext } from '../DragStrategy';
import { Task } from '../../../types';
import { DateUtils } from '../../../utils/DateUtils';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../services/display/DisplayTaskConverter';
import { getTaskDateRange } from '../../../services/display/VisualDateRange';

export interface CalendarPointerTarget {
    weekRow: HTMLElement;
    weekStart: string;
    col: number;
    colWidth: number;
    targetDate: string;
}

/**
 * ドラッグストラテジーの基底クラス。
 * MoveStrategyとResizeStrategyで共通のプロパティとメソッドを提供。
 */
export abstract class BaseDragStrategy implements DragStrategy {
    abstract name: string;

    // 共通プロパティ
    protected dragTask: Task | null = null;
    protected dragEl: HTMLElement | null = null;
    protected lastHighlighted: HTMLElement | null = null;
    protected hasMoved: boolean = false;
    protected currentContext: DragContext | null = null;
    protected calendarPreviewGhosts: HTMLElement[] = [];

    // ビュータイプ（Timeline or AllDay）
    protected viewType: 'timeline' | 'allday' | 'calendar' = 'timeline';

    // 初期位置
    protected initialX: number = 0;
    protected initialY: number = 0;

    // 抽象メソッド
    abstract onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext): void;
    abstract onMove(e: PointerEvent, context: DragContext): void;
    abstract onUp(e: PointerEvent, context: DragContext): Promise<void>;

    /**
     * ハイライトをクリアする
     */
    protected clearHighlight(): void {
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('drag-over');
            this.lastHighlighted = null;
        }
    }

    /**
     * 選択状態を復元する
     */
    protected restoreSelection(context: DragContext, taskId: string): void {
        context.onTaskClick(taskId);
    }

    /**
     * ドラッグ状態をクリーンアップする
     */
    protected cleanup(): void {
        this.clearHighlight();
        document.body.style.cursor = '';

        if (this.dragEl) {
            this.dragEl.removeClass('is-dragging');
            this.dragEl.style.zIndex = '';
            this.dragEl.classList.remove('drag-hidden', 'drag-source-dimmed', 'drag-source-faint');
            this.dragEl.style.transform = '';
        }

        this.dragTask = null;
        this.dragEl = null;
        this.currentContext = null;
        this.hasMoved = false;
        this.clearCalendarPreviewGhosts();
    }

    /**
     * ビュータイプを判定する（要素の親コンテナから）
     */
    protected determineViewType(el: HTMLElement): 'timeline' | 'allday' | 'calendar' {
        if (el.closest('.calendar-week-row')) {
            return 'calendar';
        }
        if (el.closest('.day-timeline-column')) {
            return 'timeline';
        }
        if (el.closest('.allday-section')) {
            return 'allday';
        }
        return 'timeline'; // デフォルト
    }

    /**
     * 移動閾値チェック
     */
    protected checkMoveThreshold(deltaX: number, deltaY: number, threshold: number = 5): boolean {
        if (this.hasMoved) return true;
        if (Math.abs(deltaX) >= threshold || Math.abs(deltaY) >= threshold) {
            this.hasMoved = true;
            return true;
        }
        return false;
    }

    protected updateCalendarSplitPreview(context: DragContext, rangeStart: string, rangeEnd: string): void {
        if (!this.dragEl) return;

        const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
        const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
        const trackIndex = Number.parseInt(this.dragEl.dataset.trackIndex || '0', 10);
        const weekRows = this.getCalendarWeekRows(context);
        if (weekRows.length === 0) return;

        // Compute desired segments
        const segments: { weekRow: HTMLElement; colStart: number; span: number; splitClasses: string[] }[] = [];
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

            const continuesBefore = start < weekStart;
            const continuesAfter = end > weekEnd;
            const splitClasses: string[] = [];
            if (continuesBefore) splitClasses.push('task-card--split-continues-before');
            if (continuesAfter) splitClasses.push('task-card--split-continues-after');

            segments.push({ weekRow, colStart, span, splitClasses });
        }

        // Diff-update: reuse existing ghosts to avoid remove→append reflow jitter
        const oldCount = this.calendarPreviewGhosts.length;
        const newCount = segments.length;

        for (let i = 0; i < Math.min(oldCount, newCount); i++) {
            const ghost = this.calendarPreviewGhosts[i];
            const seg = segments[i];
            const colOffset = this.getCalendarColumnOffset(seg.weekRow);
            if (ghost.parentElement !== seg.weekRow) {
                seg.weekRow.appendChild(ghost);
            }
            ghost.style.gridColumn = `${seg.colStart + colOffset} / span ${seg.span}`;
            ghost.style.gridRow = `${trackIndex + 2}`;
            ghost.removeClass('task-card--split-continues-before', 'task-card--split-continues-after');
            for (const cls of seg.splitClasses) ghost.addClass(cls);
        }

        // Remove excess ghosts
        for (let i = newCount; i < oldCount; i++) {
            this.calendarPreviewGhosts[i].remove();
        }

        // Create missing ghosts
        for (let i = oldCount; i < newCount; i++) {
            const seg = segments[i];
            const colOffset = this.getCalendarColumnOffset(seg.weekRow);
            const preview = this.createPreviewGhost(seg.colStart, seg.span, trackIndex, colOffset, seg.splitClasses);
            seg.weekRow.appendChild(preview);
            this.calendarPreviewGhosts.push(preview);
        }

        this.calendarPreviewGhosts.length = newCount;
    }

    private createPreviewGhost(colStart: number, span: number, trackIndex: number, colOffset: number, splitClasses: string[]): HTMLElement {
        const preview = this.dragEl!.cloneNode(true) as HTMLElement;
        preview.querySelectorAll('.task-card__handle').forEach(h => h.remove());
        preview.removeClass('selected', 'is-dragging');
        preview.removeClass('task-card--split-continues-before', 'task-card--split-continues-after');
        preview.addClass('task-card--drag-preview');
        preview.style.gridColumn = `${colStart + colOffset} / span ${span}`;
        preview.style.gridRow = `${trackIndex + 2}`;
        preview.style.transform = '';
        preview.classList.remove('drag-hidden', 'drag-source-dimmed', 'drag-source-faint');
        preview.style.zIndex = '1001';
        preview.style.pointerEvents = 'none';
        for (const cls of splitClasses) preview.addClass(cls);
        return preview;
    }

    /**
     * Compute inclusive visual date range for a task, matching the renderer's logic.
     */
    protected getVisualDateRange(task: Task, startHour: number): { start: string; end: string } {
        // Date range only depends on the task's own dates; childEntries are irrelevant.
        const dt = toDisplayTask(task, startHour, NO_TASK_LOOKUP);
        const range = getTaskDateRange(dt, startHour);
        const start = range.effectiveStart || task.startDate || '';
        const end = range.effectiveEnd || start;
        return { start, end };
    }

    protected clearCalendarPreviewGhosts(): void {
        for (const ghost of this.calendarPreviewGhosts) {
            ghost.remove();
        }
        this.calendarPreviewGhosts = [];
    }

    protected getCalendarWeekRows(context: DragContext): HTMLElement[] {
        return Array.from(context.container.querySelectorAll('.calendar-week-row'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement);
    }

    protected getCalendarColumnOffset(weekRow: HTMLElement): number {
        return weekRow.classList.contains('has-week-numbers') ? 1 : 0;
    }

    protected toCalendarDayColumn(displayColumn: number, weekRow: HTMLElement): number {
        const dayColumn = displayColumn - this.getCalendarColumnOffset(weekRow);
        return Math.min(7, Math.max(1, dayColumn));
    }

    protected toCalendarDisplayColumn(dayColumn: number, weekRow: HTMLElement): number {
        return dayColumn + this.getCalendarColumnOffset(weekRow);
    }

    protected getCalendarDayHeaders(weekRow: HTMLElement): HTMLElement[] {
        return Array.from(weekRow.querySelectorAll('.calendar-date-header'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement);
    }

    protected getCalendarDayColumnWidth(weekRow: HTMLElement): number {
        const dayHeaders = this.getCalendarDayHeaders(weekRow);
        for (const dayHeader of dayHeaders) {
            const rect = dayHeader.getBoundingClientRect();
            if (rect.width > 0) {
                return rect.width;
            }
        }

        const weekRect = weekRow.getBoundingClientRect();
        if (weekRect.width > 0) {
            let dayAreaWidth = weekRect.width;
            if (this.getCalendarColumnOffset(weekRow) > 0) {
                const weekNumberEl = weekRow.querySelector('.calendar-week-number');
                if (weekNumberEl instanceof HTMLElement) {
                    const weekNumberRect = weekNumberEl.getBoundingClientRect();
                    dayAreaWidth = Math.max(0, weekRect.right - weekNumberRect.right);
                }
            }
            if (dayAreaWidth > 0) {
                return dayAreaWidth / 7;
            }
        }

        return this.getCalendarFallbackColWidth();
    }

    protected findNearestCalendarWeekRow(clientY: number, context: DragContext): HTMLElement | null {
        const rows = this.getCalendarWeekRows(context);
        if (rows.length === 0) {
            return null;
        }

        let nearest: HTMLElement | null = null;
        let minDistance = Number.POSITIVE_INFINITY;

        for (const row of rows) {
            const rect = row.getBoundingClientRect();
            let distance = 0;
            if (clientY < rect.top) {
                distance = rect.top - clientY;
            } else if (clientY > rect.bottom) {
                distance = clientY - rect.bottom;
            }

            if (distance < minDistance) {
                minDistance = distance;
                nearest = row;
            }
        }

        return nearest;
    }

    protected resolveCalendarPointerTarget(clientX: number, clientY: number, context: DragContext): CalendarPointerTarget | null {
        const doc = context.container.ownerDocument || document;
        let elBelow: Element | null = null;

        if (this.dragEl) {
            const prevPointerEvents = this.dragEl.style.pointerEvents;
            this.dragEl.style.pointerEvents = 'none';
            elBelow = doc.elementFromPoint(clientX, clientY);
            this.dragEl.style.pointerEvents = prevPointerEvents;
        } else {
            elBelow = doc.elementFromPoint(clientX, clientY);
        }

        let weekRow = elBelow?.closest('.calendar-week-row') as HTMLElement | null;
        if (!weekRow) {
            weekRow = this.findNearestCalendarWeekRow(clientY, context);
        }
        if (!weekRow) {
            return null;
        }

        const weekStart = weekRow.dataset.weekStart;
        if (!weekStart) {
            return null;
        }
        const dayHeaders = this.getCalendarDayHeaders(weekRow);
        let colWidth = this.getCalendarDayColumnWidth(weekRow);
        let col = 1;

        if (dayHeaders.length === 7) {
            const dayRects = dayHeaders.map((header) => header.getBoundingClientRect());
            const firstRect = dayRects[0];
            const lastRect = dayRects[dayRects.length - 1];

            const containsIndex = dayRects.findIndex((rect) => clientX >= rect.left && clientX <= rect.right);
            if (containsIndex >= 0) {
                col = containsIndex + 1;
            } else if (clientX < firstRect.left) {
                col = 1;
            } else if (clientX > lastRect.right) {
                col = 7;
            } else {
                let nearestIndex = 0;
                let nearestDistance = Number.POSITIVE_INFINITY;
                dayRects.forEach((rect, index) => {
                    const center = (rect.left + rect.right) / 2;
                    const distance = Math.abs(clientX - center);
                    if (distance < nearestDistance) {
                        nearestDistance = distance;
                        nearestIndex = index;
                    }
                });
                col = nearestIndex + 1;
            }

            if (dayRects[0].width > 0) {
                colWidth = dayRects[0].width;
            }
        } else {
            const weekRect = weekRow.getBoundingClientRect();
            let dayAreaLeft = weekRect.left;
            let dayAreaWidth = weekRect.width;

            if (this.getCalendarColumnOffset(weekRow) > 0) {
                const weekNumberEl = weekRow.querySelector('.calendar-week-number');
                if (weekNumberEl instanceof HTMLElement) {
                    const weekNumberRect = weekNumberEl.getBoundingClientRect();
                    dayAreaLeft = weekNumberRect.right;
                    dayAreaWidth = Math.max(0, weekRect.right - weekNumberRect.right);
                }
            }

            colWidth = dayAreaWidth > 0 ? dayAreaWidth / 7 : this.getCalendarFallbackColWidth();
            const rawCol = Math.floor((clientX - dayAreaLeft) / colWidth) + 1;
            col = Math.min(7, Math.max(1, rawCol));
        }

        const targetDate = DateUtils.addDays(weekStart, col - 1);

        return {
            weekRow,
            weekStart,
            col,
            colWidth,
            targetDate,
        };
    }

    protected getCalendarFallbackColWidth(): number {
        const maybeColWidth = (this as { colWidth?: unknown }).colWidth;
        if (typeof maybeColWidth === 'number' && Number.isFinite(maybeColWidth) && maybeColWidth > 0) {
            return maybeColWidth;
        }
        return 100;
    }
}
