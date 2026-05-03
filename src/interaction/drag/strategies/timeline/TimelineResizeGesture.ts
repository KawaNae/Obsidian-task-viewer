import { BaseDragStrategy } from '../BaseDragStrategy';
import type { DragContext } from '../../DragStrategy';
import type { Task } from '../../../../types';
import { DateUtils } from '../../../../utils/DateUtils';
import {
    toDisplayHeightPx,
    toDisplayTopPx,
    toLogicalHeightPx,
    toLogicalTopPx,
} from '../../../../views/sharedLogic/TimelineCardPosition';
import { getOriginalTaskId, toDisplayTask } from '../../../../services/display/DisplayTaskConverter';

/**
 * Timeline (timed タスク) の Resize Gesture。
 * resize 方向は top / bottom のみ。
 */
export class TimelineResizeGesture extends BaseDragStrategy {
    name = 'TimelineResize';

    private resizeDirection: 'top' | 'bottom' = 'bottom';
    private currentDayDate: string | null = null;
    private initialTop: number = 0;
    private initialHeight: number = 0;
    private initialBottom: number = 0;

    onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext): void {
        this.dragTask = task;
        this.dragEl = el;
        this.currentContext = context;
        this.hasMoved = false;
        this.initialX = e.clientX;
        this.initialY = e.clientY;

        const target = e.target as HTMLElement;
        if (target.closest('.task-card__handle--resize-top')) {
            this.resizeDirection = 'top';
        } else {
            this.resizeDirection = 'bottom';
        }

        // split task の無効な resize は早期 abort (top from continues-before / bottom from continues-after)
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

        const zoomLevel = context.getZoomLevel();
        const startMinutes = Number.parseFloat(el.style.getPropertyValue('--start-minutes') || '0');
        const durationMinutes = Number.parseFloat(el.style.getPropertyValue('--duration-minutes') || '0');
        this.initialTop = Number.isFinite(startMinutes) ? startMinutes * zoomLevel : 0;
        this.initialHeight = Number.isFinite(durationMinutes) ? durationMinutes * zoomLevel : 0;
        this.initialBottom = this.initialTop + this.initialHeight;

        const dayCol = el.closest('.timeline-scroll-area__day-column') as HTMLElement;
        this.currentDayDate = dayCol?.dataset.date || task.startDate || null;

        el.addClass('is-dragging');
        el.style.zIndex = '1000';
    }

    onMove(e: PointerEvent, _context: DragContext): void {
        if (!this.dragTask || !this.dragEl) return;
        const deltaX = e.clientX - this.initialX;
        const deltaY = e.clientY - this.initialY;
        if (!this.checkMoveThreshold(deltaX, deltaY)) return;
        this.processResize(e.clientX, e.clientY);
    }

    async onUp(_e: PointerEvent, context: DragContext): Promise<void> {
        if (!this.dragTask || !this.dragEl) return;
        this.clearHighlight();

        if (!this.hasMoved) {
            context.onTaskClick(this.dragTask.id);
            this.cleanup();
            return;
        }

        await this.finishResize(context);
    }

    private processResize(clientX: number, clientY: number): void {
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
        } else {
            const currentBottom = this.initialBottom;
            const newTop = snappedMouseY;
            const clampedLogicalHeight = Math.max(snapPixels, currentBottom - newTop);
            const finalLogicalTop = currentBottom - clampedLogicalHeight;

            this.dragEl.style.top = `${toDisplayTopPx(finalLogicalTop)}px`;
            this.dragEl.style.height = `${toDisplayHeightPx(clampedLogicalHeight)}px`;
        }
    }

    private async finishResize(context: DragContext): Promise<void> {
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
        const logicalTop = hasInlineTop ? toLogicalTopPx(parseFloat(this.dragEl.style.top)) : this.initialTop;
        const hasInlineHeight = this.dragEl.style.height.length > 0;
        const logicalHeight = hasInlineHeight ? toLogicalHeightPx(parseFloat(this.dragEl.style.height)) : this.initialHeight;

        const totalStartMin = startHourMinutes + (logicalTop / zoomLevel);
        const totalEndMin = totalStartMin + (logicalHeight / zoomLevel);
        const roundedStart = Math.round(totalStartMin);
        const roundedEnd = Math.round(totalEndMin);
        const startDayOffset = Math.floor(roundedStart / 1440);
        const endDayOffset = Math.floor(roundedEnd / 1440);
        const normStart = ((roundedStart % 1440) + 1440) % 1440;
        const normEnd = ((roundedEnd % 1440) + 1440) % 1440;

        const newStartDate = DateUtils.addDays(this.currentDayDate, startDayOffset);
        const newStartTime = DateUtils.minutesToTime(normStart);
        const newEndDate = DateUtils.addDays(this.currentDayDate, endDayOffset);
        const newEndTime = DateUtils.minutesToTime(normEnd);

        const updates: Partial<Task> = {};
        if (this.resizeDirection === 'top') {
            updates.startDate = newStartDate;
            updates.startTime = newStartTime;
            updates.endDate = displayTask.effectiveEndDate;
            updates.endTime = displayTask.effectiveEndTime;
        } else {
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

    protected cleanup(): void {
        super.cleanup();
        this.currentDayDate = null;
    }
}
