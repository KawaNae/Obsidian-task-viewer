import { BaseDragStrategy } from './BaseDragStrategy';
import { DragContext } from '../DragStrategy';
import { Task } from '../../../types';
import { DateUtils } from '../../../utils/DateUtils';
import { GhostManager, GhostSegment } from '../ghost/GhostManager';
import { createGhostElement, removeGhostElement } from '../ghost/GhostFactory';
import { toLogicalHeightPx, toLogicalTopPx } from '../../../utils/TimelineCardPosition';

interface CalendarPointerTarget {
    weekRow: HTMLElement;
    weekStart: string;
    col: number;
    colWidth: number;
    targetDate: string;
}

/**
 * 移動操作を処理するドラッグストラテジー。
 * TimelineとAllDay両方の移動操作を統一的に処理。
 */
export class MoveStrategy extends BaseDragStrategy {
    name = 'Move';

    // ゴースト管理
    private ghostManager: GhostManager | null = null;
    private ghostEl: HTMLElement | null = null;

    // Timeline固有
    private dragTimeOffset: number = 0;
    private anchorType: 'start' | 'end' = 'start';
    private currentDayDate: string | null = null;
    private lastDragResult: { startDate: string, startTime: string, endDate: string, endTime: string } | null = null;
    private hiddenElements: HTMLElement[] = [];
    private initialTop: number = 0;
    private initialHeight: number = 0;

    // AllDay固有
    private colWidth: number = 0;
    private startCol: number = 0;
    private initialSpan: number = 0;
    private initialDate: string = '';
    private initialEndDate: string = '';
    private initialGridColumn: string = '';
    private container: HTMLElement | null = null;
    private isOutsideSection: boolean = false;
    private refHeaderCell: HTMLElement | null = null;
    private calendarPreviewGhosts: HTMLElement[] = [];

    // オートスクロール
    private autoScrollTimer: number | null = null;
    private scrollContainer: HTMLElement | null = null;
    private lastClientX: number = 0;
    private lastClientY: number = 0;

    onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        this.dragTask = task;
        this.dragEl = el;
        this.currentContext = context;
        this.hasMoved = false;

        this.initialX = e.clientX;
        this.initialY = e.clientY;

        // ビュータイプを判定
        this.viewType = this.determineViewType(el);

        if (this.viewType === 'timeline') {
            this.initTimelineMove(e, task, el, context);
        } else if (this.viewType === 'calendar') {
            this.initCalendarMove(e, task, el, context);
        } else {
            this.initAllDayMove(e, task, el, context);
        }

        el.addClass('is-dragging');
    }

    onMove(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl) return;
        this.currentContext = context;
        this.lastClientX = e.clientX;
        this.lastClientY = e.clientY;

        const deltaX = e.clientX - this.initialX;
        const deltaY = e.clientY - this.initialY;

        if (!this.checkMoveThreshold(deltaX, deltaY)) return;

        if (this.viewType === 'timeline') {
            // 最初の移動時に要素を非表示
            if (this.hiddenElements.length > 0) {
                this.hiddenElements.forEach(el => el.style.opacity = '0');
            }
            this.processTimelineMove(e.clientX, e.clientY);
            this.checkAutoScroll(e.clientY);
        } else if (this.viewType === 'calendar') {
            this.processCalendarMove(e, context);
        } else {
            this.processAllDayMove(e, context);
        }
    }

    async onUp(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl) return;

        this.clearHighlight();
        this.stopAutoScroll();

        if (!this.hasMoved) {
            this.cleanupAndSelect(context, this.dragTask.id);
            return;
        }

        if (this.viewType === 'timeline') {
            await this.finishTimelineMove(e, context);
        } else if (this.viewType === 'calendar') {
            await this.finishCalendarMove(e, context);
        } else {
            await this.finishAllDayMove(e, context);
        }
    }

    // ========== Timeline Move ==========

    private initTimelineMove(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        this.scrollContainer = context.container.querySelector('.timeline-scroll-area') as HTMLElement;
        this.ghostManager = new GhostManager(this.scrollContainer || context.container);

        this.initialTop = toLogicalTopPx(parseFloat(el.style.top || '0'));
        this.initialHeight = toLogicalHeightPx(parseFloat(el.style.height || '0'));

        const dayCol = el.closest('.day-timeline-column') as HTMLElement;
        this.currentDayDate = dayCol ? dayCol.dataset.date || null : (task.startDate || null);

        const zoomLevel = context.plugin.settings.zoomLevel;
        const startHour = context.plugin.settings.startHour;
        const startHourMinutes = startHour * 60;

        // アンカータイプ判定
        const target = e.target as HTMLElement;
        if (target.closest('.task-card__handle--move-bottom-right')) {
            this.anchorType = 'end';
        } else {
            this.anchorType = 'start';
        }

        // 分割タスク処理
        const originalId = (task as any).originalTaskId || task.id;
        const originalTask = context.taskIndex.getTask(originalId);

        let originalTaskStartMinutes: number | null = null;
        let originalTaskEndMinutes: number | null = null;

        if (originalTask?.startDate && originalTask.startTime && originalTask.endDate && originalTask.endTime) {
            const start = new Date(`${originalTask.startDate}T${originalTask.startTime}`);
            const end = new Date(`${originalTask.endDate}T${originalTask.endTime}`);
            if (end < start) end.setDate(end.getDate() + 1);

            const durationMinutes = (end.getTime() - start.getTime()) / 60000;
            this.initialHeight = durationMinutes * zoomLevel;

            if (this.currentDayDate) {
                const currentDayStart = new Date(`${this.currentDayDate}T00:00:00`);
                originalTaskStartMinutes = (start.getTime() - currentDayStart.getTime()) / 60000;
                originalTaskEndMinutes = (end.getTime() - currentDayStart.getTime()) / 60000;
            }
        }

        // 時間オフセット計算
        let mouseMinutes = 0;
        if (dayCol) {
            const dayRect = dayCol.getBoundingClientRect();
            mouseMinutes = startHourMinutes + ((e.clientY - dayRect.top) / zoomLevel);
        }

        let visualStartMinutes: number;
        let visualEndMinutes: number;

        if (originalTaskStartMinutes !== null && originalTaskEndMinutes !== null) {
            visualStartMinutes = originalTaskStartMinutes;
            visualEndMinutes = originalTaskEndMinutes;
        } else {
            visualStartMinutes = startHourMinutes + (this.initialTop / zoomLevel);
            visualEndMinutes = visualStartMinutes + (this.initialHeight / zoomLevel);
        }

        if (this.anchorType === 'end') {
            this.dragTimeOffset = visualEndMinutes - mouseMinutes;
        } else {
            this.dragTimeOffset = mouseMinutes - visualStartMinutes;
        }

        // 分割タスクの全セグメントを非表示リストに追加
        const selector = `.task-card[data-id="${originalId}"], .task-card[data-split-original-id="${originalId}"]`;
        const allSegments = context.container.querySelectorAll(selector);
        allSegments.forEach(segment => {
            if (segment instanceof HTMLElement) {
                this.hiddenElements.push(segment);
            }
        });
    }

    private processTimelineMove(clientX: number, clientY: number) {
        if (!this.dragTask || !this.dragEl || !this.currentContext || !this.ghostManager) return;
        const context = this.currentContext;

        const zoomLevel = context.plugin.settings.zoomLevel;
        const startHour = context.plugin.settings.startHour;
        const startHourMinutes = startHour * 60;
        const durationMinutes = this.initialHeight / zoomLevel;

        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(clientX, clientY);
        let dayCol = elBelow?.closest('.day-timeline-column') as HTMLElement;

        if (!dayCol && this.dragEl.parentElement?.classList.contains('day-timeline-column')) {
            dayCol = this.dragEl.parentElement as HTMLElement;
        }

        let totalStartMinutes = 0;
        let totalEndMinutes = 0;

        if (dayCol) {
            const rect = dayCol.getBoundingClientRect();
            const yInContainer = clientY - rect.top;

            if (dayCol.dataset.date) {
                this.currentDayDate = dayCol.dataset.date;
            }

            const mouseMinutes = startHourMinutes + (yInContainer / zoomLevel);

            if (this.anchorType === 'end') {
                const rawEndMinutes = mouseMinutes + this.dragTimeOffset;
                const snappedEndMinutes = Math.round(rawEndMinutes / 15) * 15;
                totalEndMinutes = snappedEndMinutes;
                totalStartMinutes = totalEndMinutes - durationMinutes;
            } else {
                const rawStartMinutes = mouseMinutes - this.dragTimeOffset;
                const snappedStartMinutes = Math.round(rawStartMinutes / 15) * 15;
                totalStartMinutes = snappedStartMinutes;
                totalEndMinutes = totalStartMinutes + durationMinutes;
            }
        } else {
            const deltaY = clientY - this.initialY;
            const snapPixels = 15 * zoomLevel;
            const snappedTop = Math.round((this.initialTop + deltaY) / snapPixels) * snapPixels;
            totalStartMinutes = startHourMinutes + (snappedTop / zoomLevel);
            totalEndMinutes = totalStartMinutes + durationMinutes;
        }

        // 結果を保存
        const roundedStartMinutes = Math.round(totalStartMinutes);
        const roundedEndMinutes = Math.round(totalEndMinutes);

        const startDayOffset = Math.floor(roundedStartMinutes / 1440);
        const endDayOffset = Math.floor(roundedEndMinutes / 1440);

        const normalizedStartMinutes = ((roundedStartMinutes % 1440) + 1440) % 1440;
        const normalizedEndMinutes = ((roundedEndMinutes % 1440) + 1440) % 1440;

        this.lastDragResult = {
            startDate: DateUtils.addDays(this.currentDayDate!, startDayOffset),
            startTime: DateUtils.minutesToTime(normalizedStartMinutes),
            endDate: DateUtils.addDays(this.currentDayDate!, endDayOffset),
            endTime: DateUtils.minutesToTime(normalizedEndMinutes)
        };

        // ゴーストセグメント生成
        const segments: GhostSegment[] = [];
        const checkWindow = (offsetDays: number) => {
            const windowStart = startHourMinutes + (offsetDays * 1440);
            const windowEnd = windowStart + 1440;
            const overlapStart = Math.max(totalStartMinutes, windowStart);
            const overlapEnd = Math.min(totalEndMinutes, windowEnd);

            if (overlapStart < overlapEnd) {
                const segTopMinutes = overlapStart - windowStart;
                const segHeightMinutes = overlapEnd - overlapStart;
                segments.push({
                    date: DateUtils.addDays(this.currentDayDate!, offsetDays),
                    top: segTopMinutes * zoomLevel,
                    height: segHeightMinutes * zoomLevel
                });
            }
        };

        checkWindow(-1);
        checkWindow(0);
        checkWindow(1);

        this.ghostManager.update(segments, this.dragEl);
    }

    private async finishTimelineMove(e: PointerEvent, context: DragContext) {
        const ghostManagerToClean = this.ghostManager;
        this.ghostManager = null;

        if (!this.lastDragResult || !this.dragTask) {
            ghostManagerToClean?.clear();
            this.cleanup();
            return;
        }

        const updates: Partial<Task> = {
            startDate: this.lastDragResult.startDate,
            startTime: this.lastDragResult.startTime,
            endDate: this.lastDragResult.endDate,
            endTime: this.lastDragResult.endTime
        };

        const taskIdToRestore = this.dragTask.id;
        const containerRef = context.container;

        await context.taskIndex.updateTask(this.dragTask.id, updates);
        this.restoreSelection(context, taskIdToRestore);

        // DOM更新後にゴーストクリア
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                ghostManagerToClean?.clear();
                const selector = `.task-card[data-id="${taskIdToRestore}"], .task-card[data-split-original-id="${taskIdToRestore}"]`;
                containerRef.querySelectorAll(selector).forEach(el => {
                    if (el instanceof HTMLElement) {
                        el.style.opacity = '';
                    }
                });
            });
        });

        this.cleanup();
    }

    // ========== Calendar Move ==========

    private initCalendarMove(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        this.container = (el.closest('.calendar-week-row') as HTMLElement) || context.container;

        const headerCell = this.container?.querySelector('.calendar-date-header') as HTMLElement;
        this.refHeaderCell = headerCell;
        this.colWidth = headerCell?.getBoundingClientRect().width || 100;

        const viewStartDate = context.getViewStartDate();
        this.initialDate = task.startDate || viewStartDate || DateUtils.getToday();
        this.initialEndDate = task.endDate || this.initialDate;
        this.initialSpan = DateUtils.getDiffDays(this.initialDate, this.initialEndDate) + 1;

        const gridCol = el.style.gridColumn;
        const colMatch = gridCol.match(/^(\d+)\s*\/\s*span\s+(\d+)$/);
        this.startCol = colMatch ? parseInt(colMatch[1]) : 1;
        this.initialGridColumn = el.style.gridColumn;

        el.style.zIndex = '1000';

        const doc = context.container.ownerDocument || document;
        this.ghostEl = createGhostElement(el, doc, { useCloneNode: true });
        this.clearCalendarPreviewGhosts();
    }

    private processCalendarMove(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl) return;

        const sourceWeekRow = this.container as HTMLElement;
        const target = this.resolveCalendarPointerTarget(e.clientX, e.clientY, context);
        const sourceWeekStart = sourceWeekRow?.dataset.weekStart || context.getViewStartDate();

        let dayDelta = Math.round((e.clientX - this.initialX) / this.colWidth);
        if (target) {
            dayDelta = DateUtils.getDiffDays(sourceWeekStart, target.weekStart) + target.col - this.startCol;
            if (target.weekStart === sourceWeekStart) {
                const minColOffset = 1 - this.startCol;
                if (dayDelta < minColOffset) {
                    dayDelta = minColOffset;
                }
            }
        }

        if (this.ghostEl) {
            this.ghostEl.style.opacity = '0';
            this.ghostEl.style.left = '-9999px';
        }

        if (target && target.weekStart !== sourceWeekStart) {
            const movedStart = DateUtils.addDays(this.initialDate, dayDelta);
            const movedEnd = DateUtils.addDays(this.initialEndDate, dayDelta);
            this.updateCalendarSplitPreview(context, movedStart, movedEnd);
            this.dragEl.style.opacity = '0.15';
            this.dragEl.style.transform = '';
        } else {
            this.clearCalendarPreviewGhosts();
            this.dragEl.style.opacity = '';
            this.dragEl.style.transform = `translateX(${dayDelta * this.colWidth}px)`;
        }
    }

    private async finishCalendarMove(e: PointerEvent, context: DragContext) {
        removeGhostElement(this.ghostEl);
        this.ghostEl = null;
        this.clearCalendarPreviewGhosts();
        if (this.dragEl) {
            this.dragEl.style.opacity = '';
            this.dragEl.style.transform = '';
        }

        if (!this.dragTask || !this.dragEl) {
            this.cleanup();
            return;
        }

        const sourceWeekRow = this.container as HTMLElement;
        const sourceWeekStart = sourceWeekRow?.dataset.weekStart || context.getViewStartDate();
        const target = this.resolveCalendarPointerTarget(e.clientX, e.clientY, context);

        let dayDelta = Math.round((e.clientX - this.initialX) / this.colWidth);
        if (target) {
            dayDelta = DateUtils.getDiffDays(sourceWeekStart, target.weekStart) + target.col - this.startCol;
            if (target.weekStart === sourceWeekStart) {
                const minColOffset = 1 - this.startCol;
                if (dayDelta < minColOffset) {
                    dayDelta = minColOffset;
                }
            }
        }

        if (dayDelta === 0) {
            this.cleanup();
            return;
        }

        const newStart = DateUtils.addDays(this.initialDate, dayDelta);
        const duration = DateUtils.getDiffDays(this.initialDate, this.initialEndDate);
        const newEnd = DateUtils.addDays(newStart, duration);

        const updates: Partial<Task> = this.buildAllDayMoveUpdates(newStart, newEnd);
        if (Object.keys(updates).length > 0) {
            await context.taskIndex.updateTask(this.dragTask.id, updates);
        }

        this.cleanup();
    }

    // ========== AllDay Move ==========

    private initAllDayMove(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
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

        el.style.zIndex = '1000';

        const doc = context.container.ownerDocument || document;
        this.ghostEl = createGhostElement(el, doc, { useCloneNode: true });
    }

    private processAllDayMove(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl) return;

        const deltaX = e.clientX - this.initialX;
        const snapPixels = this.colWidth;
        let dayDelta = Math.round(deltaX / snapPixels);

        const minColOffset = 2 - this.startCol;
        if (dayDelta < minColOffset) dayDelta = minColOffset;

        const snappedDeltaX = dayDelta * snapPixels;

        // セクション外判定
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);
        const timelineSection = elBelow?.closest('.day-timeline-column');
        this.isOutsideSection = !!timelineSection;

        if (this.isOutsideSection && this.ghostEl) {
            this.ghostEl.style.opacity = '0.8';
            this.ghostEl.style.left = `${e.clientX + 10}px`;
            this.ghostEl.style.top = `${e.clientY + 10}px`;
            this.dragEl.style.opacity = '0.3';
            this.dragEl.style.transform = '';
            this.dragEl.style.gridColumn = this.initialGridColumn;

            const originalEndLine = this.startCol + this.initialSpan;
            this.updateArrowPosition(originalEndLine);
        } else if (this.ghostEl) {
            this.ghostEl.style.opacity = '0';
            this.ghostEl.style.left = '-9999px';
            this.dragEl.style.opacity = '';
            this.dragEl.style.transform = `translateX(${snappedDeltaX}px)`;

            const newTaskEndLine = this.startCol + this.initialSpan + dayDelta;
            this.updateArrowPosition(newTaskEndLine);
        }

        this.updateDropZoneHighlight(e, context);
    }

    private async finishAllDayMove(e: PointerEvent, context: DragContext) {
        removeGhostElement(this.ghostEl);
        this.ghostEl = null;

        if (!this.dragTask || !this.dragEl) {
            this.cleanup();
            return;
        }

        // タイムラインへのドロップ判定
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);
        const timelineSection = elBelow?.closest('.day-timeline-column') as HTMLElement;

        if (timelineSection) {
            const targetDate = timelineSection.dataset.date;
            if (targetDate) {
                const rect = timelineSection.getBoundingClientRect();
                const yInContainer = e.clientY - rect.top;

                const zoomLevel = context.plugin.settings.zoomLevel;
                const snapPixels = 15 * zoomLevel;
                const snappedTop = Math.round(yInContainer / snapPixels) * snapPixels;

                const startHour = context.plugin.settings.startHour;
                const startHourMinutes = startHour * 60;
                const minutesFromStart = snappedTop / zoomLevel;
                const totalMinutes = startHourMinutes + minutesFromStart;
                const totalEndMinutes = totalMinutes + 60;

                const startDayOffset = Math.floor(totalMinutes / 1440);
                const endDayOffset = Math.floor(totalEndMinutes / 1440);

                const updates: Partial<Task> = {
                    startDate: DateUtils.addDays(targetDate, startDayOffset),
                    startTime: DateUtils.minutesToTime(totalMinutes),
                    endTime: DateUtils.minutesToTime(totalEndMinutes),
                    endDate: DateUtils.addDays(targetDate, endDayOffset)
                };

                await context.taskIndex.updateTask(this.dragTask.id, updates);
                this.cleanup();
                return;
            }
        }

        // 通常のAllDay内移動
        const deltaX = e.clientX - this.initialX;
        const dayDelta = Math.round(deltaX / this.colWidth);

        if (dayDelta === 0) {
            this.cleanup();
            return;
        }

        const newStart = DateUtils.addDays(this.initialDate, dayDelta);
        const duration = DateUtils.getDiffDays(this.initialDate, this.initialEndDate);
        const newEnd = DateUtils.addDays(newStart, duration);

        const updates: Partial<Task> = this.buildAllDayMoveUpdates(newStart, newEnd);

        if (Object.keys(updates).length > 0) {
            await context.taskIndex.updateTask(this.dragTask.id, updates);
        }

        this.cleanup();
    }

    private buildAllDayMoveUpdates(newStart: string, newEnd: string): Partial<Task> {
        if (!this.dragTask) return {};

        const updates: Partial<Task> = {};
        const hasExplicitStart = !!this.dragTask.startDate;
        const hasExplicitEnd = !!this.dragTask.endDate;
        const hasDeadline = !!this.dragTask.deadline;

        if (hasExplicitStart && hasExplicitEnd) {
            updates.startDate = newStart;
            updates.endDate = newEnd;
        } else if (hasExplicitStart && !hasExplicitEnd && hasDeadline) {
            updates.startDate = newStart;
            updates.endDate = newEnd;
        } else if (!hasExplicitStart && hasExplicitEnd && hasDeadline) {
            updates.startDate = newStart;
            updates.endDate = newEnd;
        } else if (!hasExplicitStart && hasExplicitEnd && !hasDeadline) {
            updates.startDate = newStart;
            updates.endDate = newEnd;
        } else if (!hasExplicitStart && !hasExplicitEnd && hasDeadline) {
            updates.startDate = newStart;
        } else if (hasExplicitStart && !hasExplicitEnd && !hasDeadline) {
            updates.startDate = newStart;
        } else {
            updates.startDate = newStart;
            if (this.dragTask.endDate) {
                updates.endDate = newEnd;
            }
        }

        return updates;
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

    private updateDropZoneHighlight(e: PointerEvent, context: DragContext) {
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);

        document.body.style.cursor = '';
        this.ghostEl?.removeClass('is-invalid');

        this.clearHighlight();

        const timelineCol = elBelow?.closest('.day-timeline-column') as HTMLElement;
        if (timelineCol) {
            timelineCol.addClass('drag-over');
            this.lastHighlighted = timelineCol;
        }
    }

    private checkAutoScroll(mouseY: number): void {
        if (!this.scrollContainer) return;
        const rect = this.scrollContainer.getBoundingClientRect();
        const scrollThreshold = 50;
        const scrollSpeed = 10;

        const shouldScrollUp = mouseY < rect.top + scrollThreshold;
        const shouldScrollDown = mouseY > rect.bottom - scrollThreshold;

        if (shouldScrollUp || shouldScrollDown) {
            this.startAutoScroll(shouldScrollUp ? -scrollSpeed : scrollSpeed);
        } else {
            this.stopAutoScroll();
        }
    }

    private startAutoScroll(direction: number): void {
        if (this.autoScrollTimer !== null) return;
        this.autoScrollTimer = window.setInterval(() => {
            if (!this.scrollContainer) return;
            this.scrollContainer.scrollTop += direction;
            this.processTimelineMove(this.lastClientX, this.lastClientY);

            if ((direction < 0 && this.scrollContainer.scrollTop <= 0) ||
                (direction > 0 && this.scrollContainer.scrollTop >=
                    this.scrollContainer.scrollHeight - this.scrollContainer.clientHeight)) {
                this.stopAutoScroll();
            }
        }, 16);
    }

    private stopAutoScroll(): void {
        if (this.autoScrollTimer !== null) {
            clearInterval(this.autoScrollTimer);
            this.autoScrollTimer = null;
        }
    }

    private cleanupAndSelect(context: DragContext, taskId: string) {
        this.ghostManager?.clear();
        removeGhostElement(this.ghostEl);
        this.ghostEl = null;
        this.clearCalendarPreviewGhosts();
        context.onTaskClick(taskId);
        this.cleanup();
    }

    private updateCalendarSplitPreview(context: DragContext, movedStart: string, movedEnd: string): void {
        if (!this.dragEl) {
            return;
        }
        this.clearCalendarPreviewGhosts();

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
            if (movedStart > weekEnd || movedEnd < weekStart) {
                continue;
            }

            const segStart = movedStart < weekStart ? weekStart : movedStart;
            const segEnd = movedEnd > weekEnd ? weekEnd : movedEnd;
            const colStart = DateUtils.getDiffDays(weekStart, segStart) + 1;
            const span = DateUtils.getDiffDays(segStart, segEnd) + 1;
            if (colStart < 1 || span < 1) {
                continue;
            }

            const continuesBefore = movedStart < weekStart;
            const continuesAfter = movedEnd > weekEnd;
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

    private clearCalendarPreviewGhosts(): void {
        for (const ghost of this.calendarPreviewGhosts) {
            ghost.remove();
        }
        this.calendarPreviewGhosts = [];
    }

    private extractGridRow(gridRowStyle: string): number {
        const parsed = Number.parseInt(gridRowStyle, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
    }

    private getCalendarWeekRows(context: DragContext): HTMLElement[] {
        return Array.from(context.container.querySelectorAll('.calendar-week-row'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement);
    }

    private findNearestCalendarWeekRow(clientY: number, context: DragContext): HTMLElement | null {
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

    private resolveCalendarPointerTarget(clientX: number, clientY: number, context: DragContext): CalendarPointerTarget | null {
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

        const header = weekRow.querySelector('.calendar-date-header') as HTMLElement | null;
        if (!header) {
            return null;
        }

        const headerRect = header.getBoundingClientRect();
        const colWidth = headerRect.width > 0 ? headerRect.width : this.colWidth || 100;
        const rawCol = Math.round((clientX - headerRect.left) / colWidth) + 1;
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

    protected cleanup(): void {
        super.cleanup();
        this.hiddenElements = [];
        this.lastDragResult = null;
        this.currentDayDate = null;
        this.container = null;
        this.clearCalendarPreviewGhosts();
    }
}
