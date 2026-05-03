import { BaseDragStrategy } from '../BaseDragStrategy';
import type { DragContext } from '../../DragStrategy';
import type { Task } from '../../../../types';
import { DateUtils } from '../../../../utils/DateUtils';
import { DisplayDateEdits, getOriginalTaskId } from '../../../../services/display/DisplayTaskConverter';
import type { DragPlan } from '../../DragPlan';
import type { GridSurface } from '../../grid/GridSurface';
import { CalendarGridSurface } from '../../grid/CalendarGridSurface';
import { AllDayGridSurface } from '../../grid/AllDayGridSurface';
import { GhostRenderer } from '../../ghost/GhostRenderer';

/**
 * Calendar / AllDay の両 Grid Surface を扱う Resize Gesture。
 * resize 方向は left / right のみ。
 *
 * - Calendar: cross-week 跨ぎでは split-aware preview ghost、same-week では
 *   dragEl の grid-column を直接書き換える 2 経路（既存挙動維持）
 * - AllDay: 単一 section、X 軸絶対値で span を再計算して dragEl の grid-column を書き換え
 */
export class GridResizeGesture extends BaseDragStrategy {
    name = 'GridResize';

    private resizeDirection: 'left' | 'right' = 'right';
    private gridSurface: GridSurface | null = null;
    private colWidth: number = 0;
    private startCol: number = 0;
    private initialSpan: number = 0;
    private initialVisualStart: string = '';
    private initialVisualEnd: string = '';
    private initialGridColumn: string = '';
    private container: HTMLElement | null = null;
    private refHeaderCell: HTMLElement | null = null;
    private baseTask: Task | null = null;
    private hiddenElements: HTMLElement[] = [];
    private calendarPreviewTargetDate: string | null = null;
    private isAllDay: boolean = false;
    private ghostRenderer: GhostRenderer | null = null;

    onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext): void {
        this.dragTask = task;
        this.dragEl = el;
        this.currentContext = context;
        this.hasMoved = false;
        this.initialX = e.clientX;
        this.initialY = e.clientY;

        const target = e.target as HTMLElement;
        this.resizeDirection = target.closest('.task-card__handle--resize-left') ? 'left' : 'right';

        const isCalendar = !!el.closest('.cal-week-row');
        this.isAllDay = !isCalendar;

        if (isCalendar) {
            const weekRow = el.closest('.cal-week-row') as HTMLElement;
            this.container = weekRow;
            this.refHeaderCell = weekRow.querySelector('.cal-day-cell') as HTMLElement;
            this.gridSurface = new CalendarGridSurface(context.container, () => this.colWidth || 100);
        } else {
            this.container = context.container;
            const grid = el.closest('.timeline-grid');
            this.refHeaderCell = (grid?.querySelector('.date-header__cell:nth-child(2)') as HTMLElement) || null;
            this.gridSurface = new AllDayGridSurface(
                context.container,
                () => context.getViewStartDate(),
                () => context.getViewEndDate(),
            );
        }

        // baseTask: split segment safety
        const originalId = getOriginalTaskId(task);
        this.baseTask = context.readService.getTask(originalId) ?? task;

        const startHour = context.plugin.settings.startHour;
        const visual = this.getVisualDateRange(this.baseTask, startHour);
        this.initialVisualStart = visual.start;
        this.initialVisualEnd = visual.end;
        this.initialSpan = DateUtils.getDiffDays(visual.start, visual.end) + 1;
        this.colWidth = this.gridSurface.getColWidth();

        if (isCalendar) {
            this.startCol = Number.parseInt(el.dataset.colStart || '1', 10);
            this.initialSpan = Number.parseInt(el.dataset.span || '1', 10);
        } else {
            const gridCol = el.style.gridColumn;
            const colMatch = gridCol.match(/^(\d+)\s*\/\s*span\s+(\d+)$/);
            this.startCol = colMatch ? parseInt(colMatch[1]) : 2;
        }
        this.initialGridColumn = el.style.gridColumn;
        this.calendarPreviewTargetDate = null;
        this.hiddenElements = [];
        const doc = context.container.ownerDocument || document;
        this.ghostRenderer = new GhostRenderer(el, doc);

        // Calendar 限定: 跨週 resize で source segments を hide するため事前収集
        if (isCalendar) {
            const selector = `.task-card[data-id="${originalId}"], .task-card[data-split-original-id="${originalId}"]`;
            context.container.querySelectorAll(selector).forEach(segment => {
                if (segment instanceof HTMLElement && !segment.closest('.tv-sidebar__pinned-lists')) {
                    this.hiddenElements.push(segment);
                }
            });
        }

        el.addClass('is-dragging');
        el.style.zIndex = '1000';
    }

    onMove(e: PointerEvent, context: DragContext): void {
        if (!this.dragTask || !this.dragEl) return;
        this.currentContext = context;
        const deltaX = e.clientX - this.initialX;
        const deltaY = e.clientY - this.initialY;
        if (!this.checkMoveThreshold(deltaX, deltaY)) return;

        if (this.isAllDay) {
            this.processAllDayResize(e);
        } else {
            this.processCalendarResize(e, context);
        }
    }

    async onUp(e: PointerEvent, context: DragContext): Promise<void> {
        if (!this.dragTask || !this.dragEl) return;
        this.clearHighlight();

        if (!this.hasMoved) {
            context.onTaskClick(this.dragTask.id);
            this.cleanup();
            return;
        }

        if (this.isAllDay) {
            await this.finishAllDayResize(context);
        } else {
            await this.finishCalendarResize(e, context);
        }
    }

    // ========== Calendar resize ==========

    private processCalendarResize(e: PointerEvent, context: DragContext): void {
        if (!this.dragEl || !this.gridSurface) return;
        const sourceWeekRow = this.container as HTMLElement;
        const colOffset = sourceWeekRow.classList.contains('has-week-numbers') ? 1 : 0;
        const sourceWeekStart = sourceWeekRow?.dataset.weekStart || context.getViewStartDate();
        const target = this.gridSurface.locatePointer(e.clientX, e.clientY, {
            resizeDirection: this.resizeDirection,
            suppressEl: this.dragEl,
        });
        if (!target) return;

        const crossWeek = target.weekStart !== sourceWeekStart;
        const trackIndex = Number.parseInt(this.dragEl.dataset.trackIndex || '0', 10);

        if (this.resizeDirection === 'right') {
            const boundedEnd = target.targetDate < this.initialVisualStart
                ? this.initialVisualStart : target.targetDate;
            this.calendarPreviewTargetDate = boundedEnd;

            if (crossWeek) {
                this.hiddenElements.forEach(el => el.classList.add('is-drag-hidden'));
                this.dragEl.classList.add('is-drag-source-faint');
                this.ghostRenderer?.render(this.gridSurface.planSegments({
                    rangeStart: this.initialVisualStart, rangeEnd: boundedEnd, trackIndex,
                }));
                return;
            }

            this.hiddenElements.forEach(el => el.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint'));
            this.ghostRenderer?.clear();
            this.dragEl.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
            const newSpan = Math.max(1, target.col - this.startCol + 1);
            this.dragEl.style.gridColumn = `${this.startCol + colOffset} / span ${newSpan}`;
        } else {
            const boundedStart = target.targetDate > this.initialVisualEnd ? this.initialVisualEnd : target.targetDate;
            this.calendarPreviewTargetDate = boundedStart;

            if (crossWeek) {
                this.hiddenElements.forEach(el => el.classList.add('is-drag-hidden'));
                this.dragEl.classList.add('is-drag-source-faint');
                this.ghostRenderer?.render(this.gridSurface.planSegments({
                    rangeStart: boundedStart, rangeEnd: this.initialVisualEnd, trackIndex,
                }));
                return;
            }

            this.hiddenElements.forEach(el => el.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint'));
            this.ghostRenderer?.clear();
            this.dragEl.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
            const currentEndCol = this.startCol + this.initialSpan - 1;
            let targetStartCol = target.col;
            targetStartCol = Math.min(targetStartCol, currentEndCol);
            targetStartCol = Math.max(targetStartCol, 1);
            const newSpan = Math.max(1, currentEndCol - targetStartCol + 1);
            this.dragEl.style.gridColumn = `${targetStartCol + colOffset} / span ${newSpan}`;
        }
    }

    private async finishCalendarResize(e: PointerEvent, context: DragContext): Promise<void> {
        if (!this.dragTask || !this.dragEl || !this.baseTask || !this.gridSurface) {
            this.cleanup();
            return;
        }

        const target = this.gridSurface.locatePointer(e.clientX, e.clientY, {
            resizeDirection: this.resizeDirection,
            suppressEl: this.dragEl,
        });
        const targetDate = this.calendarPreviewTargetDate || target?.targetDate;
        if (!targetDate) {
            this.cleanup();
            return;
        }

        await this.commitPlan(context, this.buildCalendarResizePlan(targetDate), this.dragTask.id);
        this.cleanup();
    }

    private buildCalendarResizePlan(targetDate: string): DragPlan | null {
        if (!this.baseTask) return null;
        let edits: DisplayDateEdits | null = null;
        if (this.resizeDirection === 'right') {
            const newEnd = targetDate < this.initialVisualStart ? this.initialVisualStart : targetDate;
            edits = { effectiveEndDate: newEnd };
        } else {
            const newStart = targetDate > this.initialVisualEnd ? this.initialVisualEnd : targetDate;
            edits = { effectiveStartDate: newStart };
            if (!this.baseTask.endDate) {
                edits.effectiveEndDate = this.initialVisualEnd;
            }
        }
        return edits ? { edits, baseTask: this.baseTask } : null;
    }

    // ========== AllDay resize ==========

    private processAllDayResize(e: PointerEvent): void {
        if (!this.dragEl || !this.refHeaderCell) return;
        const baseX = this.refHeaderCell.getBoundingClientRect().left;

        if (this.resizeDirection === 'right') {
            const taskLeft = baseX + (this.startCol - 2) * this.colWidth;
            const widthPx = e.clientX - taskLeft;
            const newSpan = Math.max(1, Math.ceil(widthPx / this.colWidth));
            this.dragEl.style.gridColumn = `${this.startCol} / span ${newSpan}`;
            this.updateArrowPosition(this.startCol + newSpan);
        } else {
            const colIndex = Math.floor((e.clientX - baseX) / this.colWidth);
            let targetStartCol = colIndex + 2;
            const currentEndCol = this.startCol + this.initialSpan - 1;
            targetStartCol = Math.min(targetStartCol, currentEndCol);
            const newSpan = Math.max(1, currentEndCol - targetStartCol + 1);
            this.dragEl.style.gridColumn = `${targetStartCol} / span ${newSpan}`;
        }
    }

    private async finishAllDayResize(context: DragContext): Promise<void> {
        if (!this.dragTask || !this.dragEl || !this.baseTask) {
            this.cleanup();
            return;
        }
        const gridCol = this.dragEl.style.gridColumn;
        const colMatch = gridCol.match(/^(\d+)\s*\/\s*span\s+(\d+)$/);
        if (!colMatch) {
            this.cleanup();
            return;
        }
        const currentStartCol = parseInt(colMatch[1]);
        const currentSpan = parseInt(colMatch[2]);
        await this.commitPlan(context, this.buildAllDayResizePlan(currentStartCol, currentSpan), this.dragTask.id);
        this.cleanup();
    }

    private buildAllDayResizePlan(currentStartCol: number, currentSpan: number): DragPlan | null {
        if (!this.baseTask) return null;
        if (currentStartCol === this.startCol && currentSpan === this.initialSpan) return null;

        let edits: DisplayDateEdits | null = null;
        if (this.resizeDirection === 'right') {
            const spanDelta = currentSpan - this.initialSpan;
            const newVisualEnd = DateUtils.addDays(this.initialVisualEnd, spanDelta);
            if (newVisualEnd >= this.initialVisualStart) {
                edits = { effectiveEndDate: newVisualEnd };
            }
        } else {
            const startColDelta = currentStartCol - this.startCol;
            const newVisualStart = DateUtils.addDays(this.initialVisualStart, startColDelta);
            if (newVisualStart <= this.initialVisualEnd) {
                edits = { effectiveStartDate: newVisualStart };
                if (!this.baseTask.endDate) {
                    edits.effectiveEndDate = this.initialVisualEnd;
                }
            }
        }
        return edits ? { edits, baseTask: this.baseTask } : null;
    }

    // ========== ヘルパー ==========

    private updateArrowPosition(taskEndGridLine: number): void {
        if (!this.isAllDay) return;
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
        for (const el of this.hiddenElements) {
            el.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
        }
        this.ghostRenderer?.clear();
        this.ghostRenderer = null;
        super.cleanup();
        this.container = null;
        this.hiddenElements = [];
        this.calendarPreviewTargetDate = null;
        this.baseTask = null;
        this.gridSurface = null;
    }
}
