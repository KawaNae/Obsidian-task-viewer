import { BaseDragStrategy } from '../BaseDragStrategy';
import { TRANSIENT_DRAG_CLASSES } from '../../constants';
import type { DragContext } from '../../DragStrategy';
import type { Task } from '../../../../types';
import { type DisplayDateEdits, getOriginalTaskId } from '../../../../services/display/DisplayTaskConverter';
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
    /** 1-based date col index (calendar: 週 row 内 1-7、allday: dates[] 内 1..N)。renderer の dataset.colStart に対応。 */
    private startCol: number = 0;
    /**
     * gridColumn 書き込み時の軸オフセット。Calendar: 週番号列ありなら 1、無しなら 0。
     * AllDay: 常に 1 (左端に axis col)。`startCol + colOffset` で gridColumn col に変換。
     */
    private colOffset: number = 0;
    /** 表示値由来 (`dataset.span`)。commit には参照しない (= calendar/allday 共通契約)。 */
    private initialSpan: number = 0;
    private initialVisualStart: string = '';
    private initialVisualEnd: string = '';
    private initialGridColumn: string = '';
    private container: HTMLElement | null = null;
    private refHeaderCell: HTMLElement | null = null;
    private baseTask: Task | null = null;
    private hiddenElements: HTMLElement[] = [];
    /** Resize 中の preview target date。`onUp` で commit に渡す絶対日付 (両 surface 共用)。 */
    private previewTargetDate: string | null = null;
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
        this.colWidth = this.gridSurface.getColWidth();

        // startCol / initialSpan は **表示値** から取り直す。両 surface とも renderer で
        // dataset に出力済 (calendar: CalendarView.ts、allday: AllDaySectionRenderer.ts)。
        // 旧実装では allday だけ visual range 由来で initialSpan を計算しており、view 端
        // clip された split segment (visualSpan > displaySpan) で commit が delta ずれを
        // 起こす reference frame バグの根本だった。表示値統一で対称化。
        this.startCol = Number.parseInt(el.dataset.colStart || '1', 10);
        this.initialSpan = Number.parseInt(el.dataset.span || '1', 10);
        if (isCalendar) {
            const weekRow = el.closest('.cal-week-row') as HTMLElement | null;
            this.colOffset = weekRow?.classList.contains('has-week-numbers') ? 1 : 0;
        } else {
            this.colOffset = 1; // axis col 固定
        }
        this.initialGridColumn = el.style.gridColumn;
        this.previewTargetDate = null;
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
    }

    onMove(e: PointerEvent, context: DragContext): void {
        if (!this.dragTask || !this.dragEl) return;
        this.currentContext = context;
        const deltaX = e.clientX - this.initialX;
        const deltaY = e.clientY - this.initialY;
        if (!this.checkMoveThreshold(deltaX, deltaY)) return;

        this.processResize(e, context);
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

    // ========== Resize 経路 (calendar / allday 共通) ==========

    /**
     * pointermove 中の display 更新と previewTargetDate の保存。
     * Surface 差分は cross-week ghost preview (calendar 限定) のみで、commit に
     * 流れる targetDate と display gridColumn 更新は両 surface 共通の流れ。
     */
    private processResize(e: PointerEvent, context: DragContext): void {
        if (!this.dragEl || !this.gridSurface) return;
        const target = this.gridSurface.locatePointer(e.clientX, e.clientY, {
            resizeDirection: this.resizeDirection,
            suppressEl: this.dragEl,
        });
        if (!target) return;

        const trackIndex = Number.parseInt(this.dragEl.dataset.trackIndex || '0', 10);
        const sourceWeekRow = this.isAllDay ? null : (this.container as HTMLElement | null);
        const sourceWeekStart = sourceWeekRow?.dataset.weekStart ?? context.getViewStartDate();
        const crossWeek = !this.isAllDay && target.weekStart !== sourceWeekStart;

        if (this.resizeDirection === 'right') {
            const boundedEnd = target.targetDate < this.initialVisualStart
                ? this.initialVisualStart : target.targetDate;
            this.previewTargetDate = boundedEnd;

            if (crossWeek) {
                this.hiddenElements.forEach(el => el.classList.add('is-drag-hidden'));
                this.dragEl.classList.add('is-drag-source-faint');
                this.ghostRenderer?.render(this.gridSurface.planSegments({
                    rangeStart: this.initialVisualStart, rangeEnd: boundedEnd, trackIndex,
                }));
                return;
            }

            this.clearCrossWeekPreview();
            const newSpan = Math.max(1, target.col - this.startCol + 1);
            this.dragEl.style.gridColumn = `${this.startCol + this.colOffset} / span ${newSpan}`;
            if (this.isAllDay) this.updateArrowPosition(this.startCol + this.colOffset + newSpan);
        } else {
            const boundedStart = target.targetDate > this.initialVisualEnd
                ? this.initialVisualEnd : target.targetDate;
            this.previewTargetDate = boundedStart;

            if (crossWeek) {
                this.hiddenElements.forEach(el => el.classList.add('is-drag-hidden'));
                this.dragEl.classList.add('is-drag-source-faint');
                this.ghostRenderer?.render(this.gridSurface.planSegments({
                    rangeStart: boundedStart, rangeEnd: this.initialVisualEnd, trackIndex,
                }));
                return;
            }

            this.clearCrossWeekPreview();
            const currentEndCol = this.startCol + this.initialSpan - 1;
            let targetStartCol = Math.min(target.col, currentEndCol);
            targetStartCol = Math.max(targetStartCol, 1);
            const newSpan = Math.max(1, currentEndCol - targetStartCol + 1);
            this.dragEl.style.gridColumn = `${targetStartCol + this.colOffset} / span ${newSpan}`;
        }
    }

    private async finishResize(context: DragContext): Promise<void> {
        if (!this.dragTask || !this.dragEl || !this.baseTask) {
            this.cleanup();
            return;
        }
        const targetDate = this.previewTargetDate;
        if (!targetDate) {
            this.cleanup();
            return;
        }
        await this.commitPlan(context, this.buildResizePlan(targetDate), this.dragTask.id);
        this.cleanup();
    }

    /**
     * Resize の commit プラン。targetDate (絶対日付) を受け取って effectiveStartDate /
     * effectiveEndDate を絶対値で書き出す。calendar / allday で完全共通、surface 由来の
     * delta / span は登場しない (= 過去 reference frame 不整合バグの再発防止)。
     */
    private buildResizePlan(targetDate: string): DragPlan | null {
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

    private clearCrossWeekPreview(): void {
        if (!this.dragEl) return;
        this.hiddenElements.forEach(el => el.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint'));
        this.ghostRenderer?.clear();
        this.dragEl.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
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
            el.classList.remove(...TRANSIENT_DRAG_CLASSES);
        }
        this.ghostRenderer?.clear();
        this.ghostRenderer = null;
        super.cleanup();
        this.container = null;
        this.hiddenElements = [];
        this.previewTargetDate = null;
        this.baseTask = null;
        this.gridSurface = null;
    }
}
