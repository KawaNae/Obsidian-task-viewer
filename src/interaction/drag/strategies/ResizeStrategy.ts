import { BaseDragStrategy } from './BaseDragStrategy';
import { DragContext } from '../DragStrategy';
import { Task } from '../../../types';
import { DateUtils } from '../../../utils/DateUtils';
import {
    toDisplayHeightPx,
    toDisplayTopPx,
    toLogicalHeightPx,
    toLogicalTopPx
} from '../../../views/sharedLogic/TimelineCardPosition';
import { getOriginalTaskId, toDisplayTask } from '../../../services/display/DisplayTaskConverter';

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
    private initialCalendarDate: string = '';
    private initialCalendarEndDate: string = '';
    private initialCalendarVisualEnd: string = '';
    private initialGridColumn: string = '';
    private container: HTMLElement | null = null;
    private refHeaderCell: HTMLElement | null = null;
    private hiddenElements: HTMLElement[] = [];
    private calendarPreviewTargetDate: string | null = null;

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
            if (this.resizeDirection === 'top' && el.classList.contains('task-card--split-continues-before')) {
                this.dragTask = null;
                this.dragEl = null;
                return;
            }
            if (this.resizeDirection === 'bottom' && el.classList.contains('task-card--split-continues-after')) {
                this.dragTask = null;
                this.dragEl = null;
                return;
            }

            this.initTimelineResize(e, task, el, context);
        } else if (this.viewType === 'calendar') {
            if (target.closest('.task-card__handle--resize-left')) {
                this.resizeDirection = 'left';
            } else {
                this.resizeDirection = 'right';
            }
            this.initCalendarResize(e, task, el, context);
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
        } else if (this.viewType === 'calendar') {
            this.processCalendarResize(e, context);
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
        } else if (this.viewType === 'calendar') {
            await this.finishCalendarResize(e, context);
        } else {
            await this.finishAllDayResize(context);
        }
    }

    // ========== Timeline Resize ==========

    private initTimelineResize(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        const zoomLevel = context.getZoomLevel();
        const startMinutes = Number.parseFloat(el.style.getPropertyValue('--start-minutes') || '0');
        const durationMinutes = Number.parseFloat(el.style.getPropertyValue('--duration-minutes') || '0');
        this.initialTop = Number.isFinite(startMinutes) ? startMinutes * zoomLevel : 0;
        this.initialHeight = Number.isFinite(durationMinutes) ? durationMinutes * zoomLevel : 0;

        this.initialBottom = this.initialTop + this.initialHeight;

        const dayCol = el.closest('.timeline-scroll-area__day-column') as HTMLElement;
        this.currentDayDate = dayCol?.dataset.date || task.startDate || null;
    }

    private processTimelineResize(clientX: number, clientY: number) {
        if (!this.dragTask || !this.dragEl || !this.currentContext) return;
        const context = this.currentContext;

        const zoomLevel = context.getZoomLevel();
        const snapPixels = 15 * zoomLevel;

        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(clientX, clientY);
        const dayCol = elBelow?.closest('.timeline-scroll-area__day-column') as HTMLElement;

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

        const originalId = getOriginalTaskId(this.dragTask);
        const originalTask = context.readService.getTask(originalId);
        if (!originalTask) {
            this.cleanup();
            return;
        }

        const zoomLevel = context.getZoomLevel();
        const startHour = context.plugin.settings.startHour;
        const displayTask = toDisplayTask(originalTask, startHour, (id) => context.readService.getTask(id));
        const startHourMinutes = startHour * 60;

        const hasInlineTop = this.dragEl.style.top.length > 0;
        const logicalTop = hasInlineTop
            ? toLogicalTopPx(parseFloat(this.dragEl.style.top))
            : this.initialTop;
        const hasInlineHeight = this.dragEl.style.height.length > 0;
        const logicalHeight = hasInlineHeight
            ? toLogicalHeightPx(parseFloat(this.dragEl.style.height))
            : this.initialHeight;

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
            updates.endDate = displayTask.effectiveEndDate;
            updates.endTime = displayTask.effectiveEndTime;
        } else if (this.resizeDirection === 'bottom') {
            updates.startDate = displayTask.effectiveStartDate;
            updates.startTime = displayTask.effectiveStartTime;
            updates.endDate = newEndDate;
            updates.endTime = newEndTime;
        }

        if (Object.keys(updates).length > 0) {
            const taskIdToRestore = this.dragTask.id;
            await context.writeService.updateTask(this.dragTask.id, updates);
            this.restoreSelection(context, taskIdToRestore);
        }

        this.cleanup();
    }

    // ========== Calendar Resize ==========

    private initCalendarResize(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        const weekRow = (el.closest('.calendar-week-row') as HTMLElement) || context.container;
        this.container = weekRow;

        const headerCell = weekRow.querySelector('.calendar-date-header') as HTMLElement;
        this.refHeaderCell = headerCell;
        this.colWidth = this.getCalendarDayColumnWidth(weekRow);

        const viewStartDate = context.getViewStartDate();
        this.initialCalendarDate = task.startDate || viewStartDate || DateUtils.getToday();
        this.initialCalendarEndDate = task.endDate || this.initialCalendarDate;
        // Visual end date (inclusive) for ghost rendering — matches task card renderer
        const startHour = context.plugin.settings.startHour;
        const visual = this.getVisualDateRange(task, startHour);
        this.initialCalendarVisualEnd = visual.end;

        // Read position from data attributes
        this.startCol = Number.parseInt(el.dataset.colStart || '1', 10);
        this.initialSpan = Number.parseInt(el.dataset.span || '1', 10);
        this.initialGridColumn = el.style.gridColumn;
        this.calendarPreviewTargetDate = null;
        this.hiddenElements = [];
        this.clearCalendarPreviewGhosts();

        const originalId = getOriginalTaskId(task);
        const selector = `.task-card[data-id="${originalId}"], .task-card[data-split-original-id="${originalId}"]`;
        context.container.querySelectorAll(selector).forEach(segment => {
            if (segment instanceof HTMLElement && !segment.closest('.pinned-list')) {
                this.hiddenElements.push(segment);
            }
        });
    }

    private processCalendarResize(e: PointerEvent, context: DragContext) {
        if (!this.dragEl) return;

        const sourceWeekRow = this.container as HTMLElement;
        const colOffset = this.getCalendarColumnOffset(sourceWeekRow);
        const sourceWeekStart = sourceWeekRow?.dataset.weekStart || context.getViewStartDate();
        const target = this.resolveCalendarPointerTarget(e.clientX, e.clientY, context);
        if (!target) {
            return;
        }

        const crossWeek = target.weekStart !== sourceWeekStart;

        if (this.resizeDirection === 'right') {
            const boundedEnd = target.targetDate < this.initialCalendarDate ? this.initialCalendarDate : target.targetDate;
            this.calendarPreviewTargetDate = boundedEnd;

            if (crossWeek) {
                this.hiddenElements.forEach(el => el.classList.add('is-drag-hidden'));
                this.dragEl.classList.add('is-drag-source-faint');
                this.updateCalendarSplitPreview(context, this.initialCalendarDate, boundedEnd);
                return;
            }

            this.hiddenElements.forEach(el => el.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint'));
            this.clearCalendarPreviewGhosts();
            this.dragEl.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
            const newSpan = Math.max(1, target.col - this.startCol + 1);
            this.dragEl.style.gridColumn = `${this.startCol + colOffset} / span ${newSpan}`;
        } else if (this.resizeDirection === 'left') {
            const boundedStart = target.targetDate > this.initialCalendarVisualEnd ? this.initialCalendarVisualEnd : target.targetDate;
            this.calendarPreviewTargetDate = boundedStart;

            if (crossWeek) {
                this.hiddenElements.forEach(el => el.classList.add('is-drag-hidden'));
                this.dragEl.classList.add('is-drag-source-faint');
                this.updateCalendarSplitPreview(context, boundedStart, this.initialCalendarVisualEnd);
                return;
            }

            this.hiddenElements.forEach(el => el.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint'));
            this.clearCalendarPreviewGhosts();
            this.dragEl.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
            const currentEndCol = this.startCol + this.initialSpan - 1;
            let targetStartCol = target.col;
            targetStartCol = Math.min(targetStartCol, currentEndCol);
            targetStartCol = Math.max(targetStartCol, 1);
            const newSpan = Math.max(1, currentEndCol - targetStartCol + 1);
            this.dragEl.style.gridColumn = `${targetStartCol + colOffset} / span ${newSpan}`;
        }
    }

    private async finishCalendarResize(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl) {
            this.clearCalendarPreviewGhosts();
            this.hiddenElements.forEach(el => el.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint'));
            this.cleanup();
            return;
        }

        const target = this.resolveCalendarPointerTarget(e.clientX, e.clientY, context);
        const targetDate = this.calendarPreviewTargetDate || target?.targetDate;
        if (!targetDate) {
            this.clearCalendarPreviewGhosts();
            this.hiddenElements.forEach(el => el.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint'));
            if (this.dragEl) this.dragEl.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
            this.cleanup();
            return;
        }

        const updates: Partial<Task> = {};
        if (this.resizeDirection === 'right') {
            const newEnd = targetDate < this.initialCalendarDate ? this.initialCalendarDate : targetDate;
            if (newEnd >= this.initialCalendarDate) {
                // targetDate is inclusive visual date; @notation endDate is exclusive (+1 day)
                const newEndDate = DateUtils.addDays(newEnd, 1);
                const originalEndDate = this.dragTask!.endDate
                    || DateUtils.addDays(this.initialCalendarDate, 1);
                if (newEndDate !== originalEndDate) {
                    updates.endDate = newEndDate;
                }
            }
        } else if (this.resizeDirection === 'left') {
            const newStart = targetDate > this.initialCalendarVisualEnd
                ? this.initialCalendarVisualEnd : targetDate;
            if (newStart <= this.initialCalendarVisualEnd) {
                if (newStart !== this.initialCalendarDate) {
                    updates.startDate = newStart;
                }
                // endDate が未設定の場合、元の右端を保持するために明示的に設定
                // (右リサイズと対称: inclusive visual → exclusive @notation)
                if (!this.dragTask!.endDate) {
                    updates.endDate = DateUtils.addDays(this.initialCalendarVisualEnd, 1);
                }
            }
        }

        if (Object.keys(updates).length === 0) {
            this.clearCalendarPreviewGhosts();
            this.hiddenElements.forEach(el => el.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint'));
            if (this.dragEl) this.dragEl.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
            this.cleanup();
            return;
        }

        await context.writeService.updateTask(this.dragTask.id, updates);
        this.clearCalendarPreviewGhosts();

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
        this.initialCalendarDate = task.startDate || viewStartDate || DateUtils.getToday();
        this.initialCalendarEndDate = task.endDate || this.initialCalendarDate;
        // Visual end date (inclusive) for ghost rendering — matches task card renderer
        const startHour = context.plugin.settings.startHour;
        const visual = this.getVisualDateRange(task, startHour);
        this.initialCalendarVisualEnd = visual.end;
        this.initialSpan = DateUtils.getDiffDays(this.initialCalendarDate, visual.end) + 1;

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
            // initialSpan is visual-based, initialCalendarEndDate is raw (exclusive).
            // This works because allDay tasks have no time-based visual shift on startDate,
            // so the delta between visual span and raw span is constant.
            const spanDelta = currentSpan - this.initialSpan;
            const newEnd = DateUtils.addDays(this.initialCalendarEndDate, spanDelta);
            if (newEnd >= this.initialCalendarDate) {
                updates.endDate = newEnd;
            }
        } else if (this.resizeDirection === 'left') {
            // 左リサイズ: start日付を変更
            const startColDelta = currentStartCol - this.startCol;
            const newStart = DateUtils.addDays(this.initialCalendarDate, startColDelta);
            if (newStart <= this.initialCalendarVisualEnd) {
                updates.startDate = newStart;
                // endDate が未設定の場合、元の右端を保持するために明示的に設定
                if (!this.dragTask!.endDate) {
                    updates.endDate = DateUtils.addDays(this.initialCalendarVisualEnd, 1);
                }
            }
        }

        if (Object.keys(updates).length > 0) {
            await context.writeService.updateTask(this.dragTask.id, updates);
        }

        this.cleanup();
    }

    // ========== ヘルパー ==========

    private updateArrowPosition(taskEndGridLine: number) {
        if (!this.dragEl?.dataset.id || !this.container) return;

        const taskId = this.dragEl.dataset.id;
        const arrow = this.container.querySelector(`.due-arrow[data-task-id="${taskId}"]`) as HTMLElement;
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
        this.hiddenElements = [];
        this.calendarPreviewTargetDate = null;
    }
}
