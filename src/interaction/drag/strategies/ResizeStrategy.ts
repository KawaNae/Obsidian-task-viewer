import { BaseDragStrategy } from './BaseDragStrategy';
import { DragContext } from '../DragStrategy';
import { Task } from '../../../types';
import { DateUtils } from '../../../utils/DateUtils';
import {
    toDisplayHeightPx,
    toDisplayTopPx,
    toLogicalHeightPx,
    toLogicalTopPx
} from '../../../utils/TimelineCardPosition';

/**
 * リサイズ操作を処理するドラッグストラテジー。
 * TimelineとAllDay両方のリサイズ操作を統一的に処理。
 */
export class ResizeStrategy extends BaseDragStrategy {
    name = 'Resize';

    // リサイズ方向
    private resizeDirection: 'top' | 'bottom' | 'left' | 'right' = 'bottom';

    // Timeline固有
    private currentDayDate: string | null = null;
    private initialTop: number = 0;
    private initialHeight: number = 0;
    private initialBottom: number = 0;

    // AllDay固有
    private colWidth: number = 0;
    private startCol: number = 0;
    private initialSpan: number = 0;
    private initialDate: string = '';
    private initialEndDate: string = '';
    private initialGridColumn: string = '';
    private container: HTMLElement | null = null;
    private refHeaderCell: HTMLElement | null = null;

    onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        this.dragTask = task;
        this.dragEl = el;
        this.currentContext = context;
        this.hasMoved = false;

        this.initialX = e.clientX;
        this.initialY = e.clientY;

        // ビュータイプを判定
        this.viewType = this.determineViewType(el);

        // リサイズ方向判定
        const target = e.target as HTMLElement;
        if (this.viewType === 'timeline') {
            if (target.closest('.task-card__handle--resize-top')) {
                this.resizeDirection = 'top';
            } else {
                this.resizeDirection = 'bottom';
            }

            // 分割タスクの無効なリサイズをブロック
            if (this.resizeDirection === 'top' && el.classList.contains('task-card--split-after')) {
                console.log('[ResizeStrategy] Blocked resize-top on split-after segment');
                this.dragTask = null;
                this.dragEl = null;
                return;
            }
            if (this.resizeDirection === 'bottom' && el.classList.contains('task-card--split-before')) {
                console.log('[ResizeStrategy] Blocked resize-bottom on split-before segment');
                this.dragTask = null;
                this.dragEl = null;
                return;
            }

            this.initTimelineResize(e, task, el, context);
        } else {
            if (target.closest('.task-card__handle--resize-left')) {
                this.resizeDirection = 'left';
            } else {
                this.resizeDirection = 'right';
            }
            this.initAllDayResize(e, task, el, context);
        }

        el.addClass('is-dragging');
        el.style.zIndex = '1000';
    }

    onMove(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl) return;
        this.currentContext = context;

        const deltaX = e.clientX - this.initialX;
        const deltaY = e.clientY - this.initialY;

        if (!this.checkMoveThreshold(deltaX, deltaY)) return;

        if (this.viewType === 'timeline') {
            this.processTimelineResize(e.clientX, e.clientY);
        } else {
            this.processAllDayResize(e);
        }
    }

    async onUp(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl) return;

        this.clearHighlight();

        if (!this.hasMoved) {
            context.onTaskClick(this.dragTask.id);
            this.cleanup();
            return;
        }

        if (this.viewType === 'timeline') {
            await this.finishTimelineResize(context);
        } else {
            await this.finishAllDayResize(context);
        }
    }

    // ========== Timeline Resize ==========

    private initTimelineResize(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        this.initialTop = toLogicalTopPx(parseFloat(el.style.top || '0'));
        this.initialHeight = toLogicalHeightPx(parseFloat(el.style.height || '0'));

        this.initialBottom = this.initialTop + this.initialHeight;

        const dayCol = el.closest('.day-timeline-column') as HTMLElement;
        this.currentDayDate = dayCol?.dataset.date || task.startDate || null;
    }

    private processTimelineResize(clientX: number, clientY: number) {
        if (!this.dragTask || !this.dragEl || !this.currentContext) return;
        const context = this.currentContext;

        const zoomLevel = context.plugin.settings.zoomLevel;
        const snapPixels = 15 * zoomLevel;

        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(clientX, clientY);
        const dayCol = elBelow?.closest('.day-timeline-column') as HTMLElement;

        if (!dayCol) return;

        const rect = dayCol.getBoundingClientRect();
        const yInContainer = clientY - rect.top;
        const snappedMouseY = Math.round(yInContainer / snapPixels) * snapPixels;

        if (this.resizeDirection === 'bottom') {
            const logicalTop = this.initialTop;
            const newLogicalHeight = Math.max(snapPixels, snappedMouseY - logicalTop);
            this.dragEl.style.height = `${toDisplayHeightPx(newLogicalHeight)}px`;
        } else if (this.resizeDirection === 'top') {
            const currentBottom = this.initialBottom;
            const newTop = snappedMouseY;
            const clampedLogicalHeight = Math.max(snapPixels, currentBottom - newTop);
            const finalLogicalTop = currentBottom - clampedLogicalHeight;

            this.dragEl.style.top = `${toDisplayTopPx(finalLogicalTop)}px`;
            this.dragEl.style.height = `${toDisplayHeightPx(clampedLogicalHeight)}px`;
        }
    }

    private async finishTimelineResize(context: DragContext) {
        if (!this.dragTask || !this.dragEl || !this.currentDayDate) {
            this.cleanup();
            return;
        }

        const originalId = (this.dragTask as any).originalTaskId || this.dragTask.id;
        const originalTask = context.taskIndex.getTask(originalId);
        if (!originalTask) {
            this.cleanup();
            return;
        }

        const zoomLevel = context.plugin.settings.zoomLevel;
        const startHour = context.plugin.settings.startHour;
        const startHourMinutes = startHour * 60;

        const diffTop = parseFloat(this.dragEl.style.top || '0');
        const logicalTop = toLogicalTopPx(diffTop);
        const height = parseFloat(this.dragEl.style.height || '0');
        const logicalHeight = toLogicalHeightPx(height);

        const totalStartMinutes = startHourMinutes + (logicalTop / zoomLevel);
        const totalEndMinutes = totalStartMinutes + (logicalHeight / zoomLevel);

        const roundedStartMinutes = Math.round(totalStartMinutes);
        const roundedEndMinutes = Math.round(totalEndMinutes);

        const startDayOffset = Math.floor(roundedStartMinutes / 1440);
        const endDayOffset = Math.floor(roundedEndMinutes / 1440);

        const normalizedStartMinutes = ((roundedStartMinutes % 1440) + 1440) % 1440;
        const normalizedEndMinutes = ((roundedEndMinutes % 1440) + 1440) % 1440;

        const newStartDate = DateUtils.addDays(this.currentDayDate, startDayOffset);
        const newStartTime = DateUtils.minutesToTime(normalizedStartMinutes);
        const newEndDate = DateUtils.addDays(this.currentDayDate, endDayOffset);
        const newEndTime = DateUtils.minutesToTime(normalizedEndMinutes);

        const updates: Partial<Task> = {};

        if (this.resizeDirection === 'top') {
            updates.startDate = newStartDate;
            updates.startTime = newStartTime;
            updates.endDate = originalTask.endDate;
            updates.endTime = originalTask.endTime;
        } else if (this.resizeDirection === 'bottom') {
            updates.startDate = originalTask.startDate;
            updates.startTime = originalTask.startTime;
            updates.endDate = newEndDate;
            updates.endTime = newEndTime;
        }

        if (Object.keys(updates).length > 0) {
            const taskIdToRestore = this.dragTask.id;
            await context.taskIndex.updateTask(this.dragTask.id, updates);
            this.restoreSelection(context, taskIdToRestore);
        }

        this.cleanup();
    }

    // ========== AllDay Resize ==========

    private initAllDayResize(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        this.container = context.container;

        const grid = el.closest('.timeline-grid');
        const headerCell = grid?.querySelector('.date-header__cell:nth-child(2)') as HTMLElement;
        this.refHeaderCell = headerCell;
        this.colWidth = headerCell?.getBoundingClientRect().width || 100;

        const viewStartDate = context.getViewStartDate();
        this.initialDate = task.startDate || viewStartDate || DateUtils.getToday();
        this.initialEndDate = task.endDate || this.initialDate;
        this.initialSpan = DateUtils.getDiffDays(this.initialDate, this.initialEndDate) + 1;

        const gridCol = el.style.gridColumn;
        const colMatch = gridCol.match(/^(\d+)\s*\/\s*span\s+(\d+)$/);
        this.startCol = colMatch ? parseInt(colMatch[1]) : 2;
        this.initialGridColumn = el.style.gridColumn;
    }

    private processAllDayResize(e: PointerEvent) {
        if (!this.dragEl || !this.refHeaderCell) return;

        const baseX = this.refHeaderCell.getBoundingClientRect().left;

        if (this.resizeDirection === 'right') {
            const taskLeft = baseX + (this.startCol - 2) * this.colWidth;
            const widthPx = e.clientX - taskLeft;
            const newSpan = Math.max(1, Math.ceil(widthPx / this.colWidth));

            this.dragEl.style.gridColumn = `${this.startCol} / span ${newSpan}`;

            const taskEndLine = this.startCol + newSpan;
            this.updateArrowPosition(taskEndLine);
        } else if (this.resizeDirection === 'left') {
            const colIndex = Math.floor((e.clientX - baseX) / this.colWidth);
            let targetStartCol = colIndex + 2;

            const currentEndCol = this.startCol + this.initialSpan - 1;
            targetStartCol = Math.min(targetStartCol, currentEndCol);

            const newSpan = Math.max(1, currentEndCol - targetStartCol + 1);
            this.dragEl.style.gridColumn = `${targetStartCol} / span ${newSpan}`;
        }
    }

    private async finishAllDayResize(context: DragContext) {
        if (!this.dragTask || !this.dragEl) {
            this.cleanup();
            return;
        }

        // gridColumnから現在のスパンを取得
        const gridCol = this.dragEl.style.gridColumn;
        const colMatch = gridCol.match(/^(\d+)\s*\/\s*span\s+(\d+)$/);
        if (!colMatch) {
            this.cleanup();
            return;
        }

        const currentStartCol = parseInt(colMatch[1]);
        const currentSpan = parseInt(colMatch[2]);

        // 変更がない場合は終了
        if (currentStartCol === this.startCol && currentSpan === this.initialSpan) {
            this.cleanup();
            return;
        }

        const updates: Partial<Task> = {};

        if (this.resizeDirection === 'right') {
            // 右リサイズ: end日付を変更
            const spanDelta = currentSpan - this.initialSpan;
            const newEnd = DateUtils.addDays(this.initialEndDate, spanDelta);
            if (newEnd >= this.initialDate) {
                updates.endDate = newEnd;
            }
        } else if (this.resizeDirection === 'left') {
            // 左リサイズ: start日付を変更
            const startColDelta = currentStartCol - this.startCol;
            const newStart = DateUtils.addDays(this.initialDate, startColDelta);
            if (newStart <= this.initialEndDate) {
                updates.startDate = newStart;
            }
        }

        if (Object.keys(updates).length > 0) {
            await context.taskIndex.updateTask(this.dragTask.id, updates);
        }

        this.cleanup();
    }

    // ========== ヘルパー ==========

    private updateArrowPosition(taskEndGridLine: number) {
        if (!this.dragEl?.dataset.id || !this.container) return;

        const taskId = this.dragEl.dataset.id;
        const arrow = this.container.querySelector(`.deadline-arrow[data-task-id="${taskId}"]`) as HTMLElement;
        if (arrow) {
            arrow.style.gridColumnStart = taskEndGridLine.toString();
            const arrowEnd = parseInt(arrow.style.gridColumnEnd) || 0;
            arrow.style.display = taskEndGridLine >= arrowEnd ? 'none' : '';
        }
    }

    protected cleanup(): void {
        super.cleanup();
        this.currentDayDate = null;
        this.container = null;
    }
}
