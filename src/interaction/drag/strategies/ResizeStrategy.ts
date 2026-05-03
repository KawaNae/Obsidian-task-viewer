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
import {
    DisplayDateEdits,
    getOriginalTaskId,
    toDisplayTask,
} from '../../../services/display/DisplayTaskConverter';
import type { DragPlan } from '../DragPlan';
import type { GridSurface } from '../grid/GridSurface';
import { CalendarGridSurface } from '../grid/CalendarGridSurface';
import { AllDayGridSurface } from '../grid/AllDayGridSurface';

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
    private initialCalendarVisualStart: string = '';
    private initialCalendarVisualEnd: string = '';
    private initialGridColumn: string = '';
    /** Original (pre-split) raw task. Cached at drag start so write-back has
     *  access to baseTask.endTime without re-resolving from a split segment. */
    private baseTask: Task | null = null;
    private container: HTMLElement | null = null;
    private refHeaderCell: HTMLElement | null = null;
    private hiddenElements: HTMLElement[] = [];
    private calendarPreviewTargetDate: string | null = null;
    /** Calendar/AllDay 共通の grid 操作を委譲する surface。Timeline では未使用。 */
    private gridSurface: GridSurface | null = null;

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
            // hysteresis は GridSurface.locatePointer の opts.resizeDirection で
            // 有効化される (this.resizeDirection を渡すだけ)。Strategy 側で別途
            // フラグを持つ必要はない。
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
        const weekRow = (el.closest('.cal-week-row') as HTMLElement) || context.container;
        this.container = weekRow;

        const headerCell = weekRow.querySelector('.cal-day-cell') as HTMLElement;
        this.refHeaderCell = headerCell;
        this.gridSurface = new CalendarGridSurface(context.container, () => this.colWidth || 100);
        this.colWidth = this.gridSurface.getColWidth();

        // Resolve the original (pre-split) raw task. dragTask may be a split
        // segment whose endTime/endDate differ from the source. Write-back
        // needs to see the source's endTime to pick the correct inclusive/
        // exclusive endDate semantic.
        const originalId = getOriginalTaskId(task);
        this.baseTask = context.readService.getTask(originalId) ?? task;

        const viewStartDate = context.getViewStartDate();
        this.initialCalendarDate = this.baseTask.startDate || viewStartDate || DateUtils.getToday();
        this.initialCalendarEndDate = this.baseTask.endDate || this.initialCalendarDate;
        // Visual range (inclusive) for ghost rendering — matches task card renderer.
        const startHour = context.plugin.settings.startHour;
        const visual = this.getVisualDateRange(this.baseTask, startHour);
        this.initialCalendarVisualStart = visual.start;
        this.initialCalendarVisualEnd = visual.end;

        // Read position from data attributes
        this.startCol = Number.parseInt(el.dataset.colStart || '1', 10);
        this.initialSpan = Number.parseInt(el.dataset.span || '1', 10);
        this.initialGridColumn = el.style.gridColumn;
        this.calendarPreviewTargetDate = null;
        this.hiddenElements = [];
        this.clearPreviewGhosts();

        const selector = `.task-card[data-id="${originalId}"], .task-card[data-split-original-id="${originalId}"]`;
        context.container.querySelectorAll(selector).forEach(segment => {
            if (segment instanceof HTMLElement && !segment.closest('.tv-sidebar__pinned-lists')) {
                this.hiddenElements.push(segment);
            }
        });
    }

    private processCalendarResize(e: PointerEvent, context: DragContext) {
        if (!this.dragEl || !this.gridSurface) return;

        const sourceWeekRow = this.container as HTMLElement;
        // colOffset は cal-week-row 直下の has-week-numbers class で決まる単純な
        // 値で、planSegments 戻り値の gridColumn には既に適用済。dragEl の grid-
        // column を直接書き換える same-week パス用にだけここでローカル計算する。
        const colOffset = sourceWeekRow.classList.contains('has-week-numbers') ? 1 : 0;
        const sourceWeekStart = sourceWeekRow?.dataset.weekStart || context.getViewStartDate();
        const target = this.gridSurface.locatePointer(e.clientX, e.clientY, {
            resizeDirection: this.resizeDirection as 'left' | 'right',
            suppressEl: this.dragEl,
        });
        if (!target) return;

        const crossWeek = target.weekStart !== sourceWeekStart;
        const trackIndex = Number.parseInt(this.dragEl.dataset.trackIndex || '0', 10);

        if (this.resizeDirection === 'right') {
            // クランプは visual 座標で行う (target.targetDate も visual)。raw startDate と
            // 直接比較すると深夜タスクの startHour シフトでズレる。
            const boundedEnd = target.targetDate < this.initialCalendarVisualStart
                ? this.initialCalendarVisualStart : target.targetDate;
            this.calendarPreviewTargetDate = boundedEnd;

            if (crossWeek) {
                this.hiddenElements.forEach(el => el.classList.add('is-drag-hidden'));
                this.dragEl.classList.add('is-drag-source-faint');
                this.updateSplitPreview(this.gridSurface.planSegments({
                    rangeStart: this.initialCalendarVisualStart, rangeEnd: boundedEnd, trackIndex,
                }));
                return;
            }

            this.hiddenElements.forEach(el => el.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint'));
            this.clearPreviewGhosts();
            this.dragEl.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
            const newSpan = Math.max(1, target.col - this.startCol + 1);
            this.dragEl.style.gridColumn = `${this.startCol + colOffset} / span ${newSpan}`;
        } else if (this.resizeDirection === 'left') {
            const boundedStart = target.targetDate > this.initialCalendarVisualEnd ? this.initialCalendarVisualEnd : target.targetDate;
            this.calendarPreviewTargetDate = boundedStart;

            if (crossWeek) {
                this.hiddenElements.forEach(el => el.classList.add('is-drag-hidden'));
                this.dragEl.classList.add('is-drag-source-faint');
                this.updateSplitPreview(this.gridSurface.planSegments({
                    rangeStart: boundedStart, rangeEnd: this.initialCalendarVisualEnd, trackIndex,
                }));
                return;
            }

            this.hiddenElements.forEach(el => el.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint'));
            this.clearPreviewGhosts();
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
        if (!this.dragTask || !this.dragEl || !this.baseTask || !this.gridSurface) {
            this.cleanup();
            return;
        }

        const target = this.gridSurface.locatePointer(e.clientX, e.clientY, {
            resizeDirection: this.resizeDirection as 'left' | 'right',
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

    /**
     * Calendar resize の DragPlan ビルダ。target.targetDate（visual）から
     * direction 別に edits を組み立て、`materializeRawDates` で endDate
     * dual-semantic を判定させる。
     */
    private buildCalendarResizePlan(targetDate: string): DragPlan | null {
        if (!this.baseTask) return null;

        let edits: DisplayDateEdits | null = null;
        if (this.resizeDirection === 'right') {
            const newEnd = targetDate < this.initialCalendarVisualStart
                ? this.initialCalendarVisualStart : targetDate;
            edits = { effectiveEndDate: newEnd };
        } else if (this.resizeDirection === 'left') {
            const newStart = targetDate > this.initialCalendarVisualEnd
                ? this.initialCalendarVisualEnd : targetDate;
            edits = { effectiveStartDate: newStart };
            if (!this.baseTask.endDate) {
                // 元の右端 (visual) を固定して endDate を明示化
                edits.effectiveEndDate = this.initialCalendarVisualEnd;
            }
        }

        return edits ? { edits, baseTask: this.baseTask } : null;
    }

    // ========== AllDay Resize ==========

    private initAllDayResize(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        this.container = context.container;

        const grid = el.closest('.timeline-grid');
        const headerCell = grid?.querySelector('.date-header__cell:nth-child(2)') as HTMLElement;
        this.refHeaderCell = headerCell;
        this.gridSurface = new AllDayGridSurface(context.container, () => context.getViewStartDate(), () => context.getViewEndDate());
        this.colWidth = this.gridSurface.getColWidth();

        // Resolve original task (split segment safety, see initCalendarResize).
        const originalId = getOriginalTaskId(task);
        this.baseTask = context.readService.getTask(originalId) ?? task;

        const viewStartDate = context.getViewStartDate();
        this.initialCalendarDate = this.baseTask.startDate || viewStartDate || DateUtils.getToday();
        this.initialCalendarEndDate = this.baseTask.endDate || this.initialCalendarDate;
        // Visual range (inclusive) — matches task card renderer
        const startHour = context.plugin.settings.startHour;
        const visual = this.getVisualDateRange(this.baseTask, startHour);
        this.initialCalendarVisualStart = visual.start;
        this.initialCalendarVisualEnd = visual.end;
        this.initialSpan = DateUtils.getDiffDays(visual.start, visual.end) + 1;

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
        if (!this.dragTask || !this.dragEl || !this.baseTask) {
            this.cleanup();
            return;
        }

        // gridColumn から現在のスパンを取得して plan を組み立て、commitPlan に流す
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

    /**
     * AllDay resize の DragPlan ビルダ。grid column の差分から visual 範囲を
     * 計算し、calendar resize と同じく left 方向で endDate 明示化を行う。
     */
    private buildAllDayResizePlan(currentStartCol: number, currentSpan: number): DragPlan | null {
        if (!this.baseTask) return null;
        // span 不変・startCol 不変 → 変更なし
        if (currentStartCol === this.startCol && currentSpan === this.initialSpan) return null;

        let edits: DisplayDateEdits | null = null;
        if (this.resizeDirection === 'right') {
            const spanDelta = currentSpan - this.initialSpan;
            const newVisualEnd = DateUtils.addDays(this.initialCalendarVisualEnd, spanDelta);
            if (newVisualEnd >= this.initialCalendarVisualStart) {
                edits = { effectiveEndDate: newVisualEnd };
            }
        } else if (this.resizeDirection === 'left') {
            const startColDelta = currentStartCol - this.startCol;
            const newVisualStart = DateUtils.addDays(this.initialCalendarVisualStart, startColDelta);
            if (newVisualStart <= this.initialCalendarVisualEnd) {
                edits = { effectiveStartDate: newVisualStart };
                if (!this.baseTask.endDate) {
                    edits.effectiveEndDate = this.initialCalendarVisualEnd;
                }
            }
        }

        return edits ? { edits, baseTask: this.baseTask } : null;
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
        // hiddenElements は drag 中に `is-drag-*` 等を付与した DOM 要素群。
        // super.cleanup() は dragEl のみ class 除去するため、関連 segments を
        // ここで一括 remove する (MoveStrategy.cleanup と対称)。
        for (const el of this.hiddenElements) {
            el.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
        }
        super.cleanup();
        this.currentDayDate = null;
        this.container = null;
        this.hiddenElements = [];
        this.calendarPreviewTargetDate = null;
        this.baseTask = null;
        this.gridSurface = null;
    }
}
