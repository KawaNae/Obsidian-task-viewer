import { DragStrategy, DragContext } from '../DragStrategy';
import { Task } from '../../../types';
import { DateUtils } from '../../../utils/DateUtils';

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
            this.dragEl.style.opacity = '';
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
        if (!this.dragEl) {
            return;
        }

        this.clearCalendarPreviewGhosts();

        const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
        const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
        const gridRow = this.extractGridRow(this.dragEl.style.gridRow);
        const weekRows = this.getCalendarWeekRows(context);
        if (weekRows.length === 0) {
            return;
        }

        for (const weekRow of weekRows) {
            const weekStart = weekRow.dataset.weekStart;
            if (!weekStart) {
                continue;
            }

            const weekEnd = DateUtils.addDays(weekStart, 6);
            if (start > weekEnd || end < weekStart) {
                continue;
            }

            const segStart = start < weekStart ? weekStart : start;
            const segEnd = end > weekEnd ? weekEnd : end;
            const colStart = DateUtils.getDiffDays(weekStart, segStart) + 1;
            const span = DateUtils.getDiffDays(segStart, segEnd) + 1;
            if (colStart < 1 || span < 1) {
                continue;
            }

            const continuesBefore = start < weekStart;
            const continuesAfter = end > weekEnd;

            const preview = this.dragEl.cloneNode(true) as HTMLElement;
            preview.querySelectorAll('.task-card__handle').forEach((handle) => handle.remove());
            preview.removeClass('selected', 'is-dragging');
            preview.removeClass('calendar-multiday-bar--head', 'calendar-multiday-bar--middle', 'calendar-multiday-bar--tail');
            preview.addClass('calendar-task-card--drag-preview');
            preview.style.gridColumn = `${colStart} / span ${span}`;
            preview.style.gridRow = `${gridRow}`;
            preview.style.transform = '';
            preview.style.opacity = '';
            preview.style.zIndex = '1001';
            preview.style.pointerEvents = 'none';
            if (continuesBefore && continuesAfter) {
                preview.addClass('calendar-multiday-bar--middle');
            } else if (continuesAfter) {
                preview.addClass('calendar-multiday-bar--head');
            } else if (continuesBefore) {
                preview.addClass('calendar-multiday-bar--tail');
            }

            weekRow.appendChild(preview);
            this.calendarPreviewGhosts.push(preview);
        }
    }

    protected clearCalendarPreviewGhosts(): void {
        for (const ghost of this.calendarPreviewGhosts) {
            ghost.remove();
        }
        this.calendarPreviewGhosts = [];
    }

    protected extractGridRow(gridRowStyle: string): number {
        const parsed = Number.parseInt(gridRowStyle, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
    }

    protected getCalendarWeekRows(context: DragContext): HTMLElement[] {
        return Array.from(context.container.querySelectorAll('.calendar-week-row'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement);
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

        const weekRect = weekRow.getBoundingClientRect();
        const colWidth = weekRect.width > 0 ? weekRect.width / 7 : this.getCalendarFallbackColWidth();
        const rawCol = Math.floor((clientX - weekRect.left) / colWidth) + 1;
        const col = Math.min(7, Math.max(1, rawCol));
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
