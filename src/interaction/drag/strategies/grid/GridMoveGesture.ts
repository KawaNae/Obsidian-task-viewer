import { BaseDragStrategy } from '../BaseDragStrategy';
import type { DragContext } from '../../DragStrategy';
import type { Task } from '../../../../types';
import { DateUtils } from '../../../../utils/DateUtils';
import { createGhostElement, removeGhostElement } from '../../ghost/GhostFactory';
import { DisplayDateEdits, getOriginalTaskId } from '../../../../services/display/DisplayTaskConverter';
import type { DragPlan } from '../../DragPlan';
import type { GridSurface } from '../../grid/GridSurface';
import { CalendarGridSurface } from '../../grid/CalendarGridSurface';
import { AllDayGridSurface } from '../../grid/AllDayGridSurface';

/**
 * Calendar / AllDay の両 Grid Surface を扱う Move Gesture。
 *
 * Surface 注入で Calendar/AllDay の差を吸収し、grid 座標系の dayDelta 平行移動
 * という共通モデルで実装する。Surface ごとの方言:
 *   - Calendar: cal-week-row × N、cross-week 判定で grabCol を使用
 *   - AllDay  : 単一 .allday-section、X 軸絶対で dayDelta 計算、Timeline drop
 *               (canCrossToTimeline) を許す
 *
 * Move 中の preview は GridSurface.planSegments による split-aware ghost。
 * Floating ghost (`ghostEl`) は cross-view drop 中に pointer に追従させるための補助。
 */
export class GridMoveGesture extends BaseDragStrategy {
    name = 'GridMove';

    private gridSurface: GridSurface | null = null;
    private ghostEl: HTMLElement | null = null;
    private colWidth: number = 0;
    private startCol: number = 0;
    private grabCol: number = 0;
    private initialSpan: number = 0;
    private initialVisualStart: string = '';
    private initialVisualEnd: string = '';
    private initialGridColumn: string = '';
    private container: HTMLElement | null = null;
    private refHeaderCell: HTMLElement | null = null;
    private baseTask: Task | null = null;
    private hiddenElements: HTMLElement[] = [];
    /** AllDay → Timeline drop 中なら true。preview/ghost 表示の切替に使う。 */
    private isOutsideSection: boolean = false;
    /** Calendar / AllDay どちらの Surface か。is-calendar 判定なしに updateArrowPosition 等の AllDay 限定機能を分岐するためのフラグ。 */
    private isAllDay: boolean = false;

    onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext): void {
        this.dragTask = task;
        this.dragEl = el;
        this.currentContext = context;
        this.hasMoved = false;
        this.initialX = e.clientX;
        this.initialY = e.clientY;

        const isCalendar = !!el.closest('.cal-week-row');
        this.isAllDay = !isCalendar;

        // Surface 選択
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

        // baseTask を split safety のため original から取る
        const originalId = getOriginalTaskId(task);
        this.baseTask = context.readService.getTask(originalId) ?? task;

        // Visual range (inclusive) — preview ghost 描画用
        const startHour = context.plugin.settings.startHour;
        const visual = this.getVisualDateRange(this.baseTask, startHour);
        this.initialVisualStart = visual.start;
        this.initialVisualEnd = visual.end;
        this.initialSpan = DateUtils.getDiffDays(visual.start, visual.end) + 1;
        this.colWidth = this.gridSurface.getColWidth();

        // grid 座標取得 + grabCol (Calendar 専用、AllDay は使わないが一応設定)
        const colStart = Number.parseInt(el.dataset.colStart || '1', 10);
        const span = Number.parseInt(el.dataset.span || '1', 10);
        if (isCalendar) {
            this.startCol = colStart;
            const target = e.target as HTMLElement;
            // bottom-right move handle なら grabCol は span 末端、それ以外は startCol
            this.grabCol = target.closest('.task-card__handle--move-bottom-right')
                ? Math.min(7, this.startCol + span - 1)
                : this.startCol;
        } else {
            // AllDay: dataset.colStart は dates[] 0-based、+1 で grid 1-based
            this.startCol = colStart + 1;
            this.grabCol = this.startCol; // unused for allday but set for safety
        }

        this.initialGridColumn = el.style.gridColumn;
        el.style.zIndex = '1000';

        // floating ghost (cross-view drop で pointer 追従に使う)
        const doc = context.container.ownerDocument || document;
        this.ghostEl = createGhostElement(el, doc);
        this.clearPreviewGhosts();

        // 同一 originalId の split segments を hide リストへ
        const selector = `.task-card[data-id="${originalId}"], .task-card[data-split-original-id="${originalId}"]`;
        context.container.querySelectorAll(selector).forEach(segment => {
            if (segment instanceof HTMLElement && !segment.closest('.tv-sidebar__pinned-lists')) {
                this.hiddenElements.push(segment);
            }
        });

        el.addClass('is-dragging');
    }

    onMove(e: PointerEvent, context: DragContext): void {
        if (!this.dragTask || !this.dragEl) return;
        this.currentContext = context;
        const deltaX = e.clientX - this.initialX;
        const deltaY = e.clientY - this.initialY;
        if (!this.checkMoveThreshold(deltaX, deltaY)) return;

        // 最初の move で source segments を非表示化
        if (this.hiddenElements.length > 0) {
            this.hiddenElements.forEach(el => el.classList.add('is-drag-hidden'));
        }

        if (this.isAllDay) {
            this.processAllDayLikeMove(e, context);
        } else {
            this.processCalendarLikeMove(e, context);
        }
    }

    async onUp(e: PointerEvent, context: DragContext): Promise<void> {
        if (!this.dragTask || !this.dragEl || !this.gridSurface || !this.baseTask) return;

        this.clearHighlight();
        removeGhostElement(this.ghostEl);
        this.ghostEl = null;

        if (!this.hasMoved) {
            // drag せず press-release: 単純な card click として selection 設定
            context.onTaskClick(this.dragTask.id);
            this.cleanup();
            return;
        }

        // AllDay 専用: timeline へのドロップ判定
        if (this.isAllDay) {
            const doc = context.container.ownerDocument || document;
            const tlSection = this.gridSurface.canCrossToTimeline?.(e.clientX, e.clientY, doc) ?? null;
            if (tlSection) {
                const plan = this.buildTimelineDropPlan(tlSection, e.clientY, context);
                await this.commitPlan(context, plan, this.dragTask.id);
                this.cleanup();
                return;
            }
        }

        // 通常の grid 内 move: dayDelta から DragPlan 構築 → commitPlan
        const dayDelta = this.computeDayDelta(e, context);
        await this.commitPlan(context, this.buildMoveDayShiftPlan(dayDelta), this.dragTask.id);
        this.cleanup();
    }

    /** Calendar 経路: locatePointer 経由で dayDelta、preview を planSegments で更新。 */
    private processCalendarLikeMove(e: PointerEvent, context: DragContext): void {
        if (!this.dragEl || !this.gridSurface) return;
        const dayDelta = this.computeDayDelta(e, context);

        if (this.ghostEl) {
            this.ghostEl.classList.add('is-drag-hidden');
            this.ghostEl.style.left = '-9999px';
        }

        const movedStart = DateUtils.addDays(this.initialVisualStart, dayDelta);
        const movedEnd = DateUtils.addDays(this.initialVisualEnd, dayDelta);
        const trackIndex = Number.parseInt(this.dragEl.dataset.trackIndex || '0', 10);
        this.updateSplitPreview(this.gridSurface.planSegments({ rangeStart: movedStart, rangeEnd: movedEnd, trackIndex }));
        this.dragEl.style.transform = '';
    }

    /**
     * AllDay 経路: X 軸絶対値で dayDelta、Timeline drop 検出 → floating ghost or
     * 通常 split-aware preview。
     */
    private processAllDayLikeMove(e: PointerEvent, context: DragContext): void {
        if (!this.dragEl || !this.gridSurface) return;
        const deltaX = e.clientX - this.initialX;
        const dayDelta = this.gridSurface.clampDayDelta(
            Math.round(deltaX / this.colWidth),
            this.initialVisualStart,
            this.initialVisualEnd,
        );

        const doc = context.container.ownerDocument || document;
        const tlSection = this.gridSurface.canCrossToTimeline?.(e.clientX, e.clientY, doc) ?? null;
        this.isOutsideSection = !!tlSection;

        if (this.isOutsideSection && this.ghostEl) {
            // timeline ドロップ用 floating ghost を pointer に追従、preview は消す。
            // source 側は dimmed 表示で視覚的にドラッグ中であることを示す。
            this.ghostEl.classList.remove('is-drag-hidden');
            this.ghostEl.style.left = `${e.clientX + 10}px`;
            this.ghostEl.style.top = `${e.clientY + 10}px`;
            this.hiddenElements.forEach(el => {
                el.classList.remove('is-drag-hidden');
                el.classList.add('is-drag-source-dimmed');
            });
            this.dragEl.style.transform = '';
            this.dragEl.style.gridColumn = this.initialGridColumn;
            this.clearPreviewGhosts();
            this.updateArrowPosition(this.startCol + this.initialSpan); // 元位置のまま
        } else if (this.ghostEl) {
            // section 内: source を hide → split-aware preview ghost で WYSIWYG 表示
            this.ghostEl.classList.add('is-drag-hidden');
            this.ghostEl.style.left = '-9999px';
            this.hiddenElements.forEach(el => {
                el.classList.remove('is-drag-source-dimmed', 'is-drag-source-faint');
                el.classList.add('is-drag-hidden');
            });
            this.dragEl.style.transform = '';
            this.dragEl.style.gridColumn = this.initialGridColumn;

            const movedStart = DateUtils.addDays(this.initialVisualStart, dayDelta);
            const movedEnd = DateUtils.addDays(this.initialVisualEnd, dayDelta);
            const trackIndex = Number.parseInt(this.dragEl.dataset.trackIndex || '0', 10);
            this.updateSplitPreview(this.gridSurface.planSegments({ rangeStart: movedStart, rangeEnd: movedEnd, trackIndex }));
            this.updateArrowPosition(this.startCol + this.initialSpan + dayDelta);
        }

        this.updateDropZoneHighlight(e, context);
    }

    /**
     * locatePointer 経由を第 1 候補、X 軸絶対値を fallback として dayDelta を出す。
     * Calendar 経路では cross-week 跨ぎを正しく検出するため target.weekStart 経由必須。
     */
    private computeDayDelta(e: PointerEvent, context: DragContext): number {
        if (!this.gridSurface) return 0;

        if (this.isAllDay) {
            return this.gridSurface.clampDayDelta(
                Math.round((e.clientX - this.initialX) / this.colWidth),
                this.initialVisualStart,
                this.initialVisualEnd,
            );
        }

        // Calendar
        const sourceWeekRow = this.container as HTMLElement | null;
        const sourceWeekStart = sourceWeekRow?.dataset.weekStart || context.getViewStartDate();
        const target = this.gridSurface.locatePointer(e.clientX, e.clientY, { suppressEl: this.dragEl });
        if (target && target.weekStart) {
            return DateUtils.getDiffDays(sourceWeekStart, target.weekStart) + target.col - this.grabCol;
        }
        return Math.round((e.clientX - this.initialX) / this.colWidth);
    }

    /**
     * Calendar/AllDay 共通の Move 用 DragPlan ビルダ。endDate 系の値があれば
     * effectiveEndDate も同 dayDelta だけ shift し、なければ start のみ更新。
     */
    private buildMoveDayShiftPlan(dayDelta: number): DragPlan | null {
        if (dayDelta === 0 || !this.baseTask) return null;
        const movedStart = DateUtils.addDays(this.initialVisualStart, dayDelta);
        const movedEnd = DateUtils.addDays(this.initialVisualEnd, dayDelta);
        const edits: DisplayDateEdits = { effectiveStartDate: movedStart };
        if (this.baseTask.endDate || this.baseTask.endTime) {
            edits.effectiveEndDate = movedEnd;
        }
        return { edits, baseTask: this.baseTask };
    }

    /**
     * AllDay → Timeline cross-view drop の DragPlan ビルダ。
     * effectiveStart/End × Date/Time 4 つを visual edit で渡し、
     * materializeRawDates の inclusive semantic (willHaveEndTime=true) で raw 化。
     */
    private buildTimelineDropPlan(timelineSection: HTMLElement, clientY: number, context: DragContext): DragPlan | null {
        if (!this.baseTask) return null;
        const targetDate = timelineSection.dataset.date;
        if (!targetDate) return null;

        const rect = timelineSection.getBoundingClientRect();
        const yInContainer = clientY - rect.top;
        const zoomLevel = context.getZoomLevel();
        const snapPixels = 15 * zoomLevel;
        const snappedTop = Math.round(yInContainer / snapPixels) * snapPixels;

        const startHour = context.plugin.settings.startHour;
        const startHourMinutes = startHour * 60;
        const minutesFromStart = snappedTop / zoomLevel;
        const totalMin = startHourMinutes + minutesFromStart;
        const totalEndMin = totalMin + DateUtils.DEFAULT_TIMED_DURATION_MINUTES;

        const startDayOffset = Math.floor(totalMin / 1440);
        const endDayOffset = Math.floor(totalEndMin / 1440);

        const edits: DisplayDateEdits = {
            effectiveStartDate: DateUtils.addDays(targetDate, startDayOffset),
            effectiveStartTime: DateUtils.minutesToTime(totalMin),
            effectiveEndDate: DateUtils.addDays(targetDate, endDayOffset),
            effectiveEndTime: DateUtils.minutesToTime(totalEndMin),
        };
        return { edits, baseTask: this.baseTask };
    }

    /** AllDay の due-arrow 位置更新 (Calendar では .due-arrow 自体が無いので no-op)。 */
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

    private updateDropZoneHighlight(e: PointerEvent, context: DragContext): void {
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);
        document.body.style.cursor = '';
        this.ghostEl?.removeClass('is-invalid');
        this.clearHighlight();

        const timelineCol = elBelow?.closest('.timeline-scroll-area__day-column') as HTMLElement;
        if (timelineCol) {
            timelineCol.addClass('drag-over');
            this.lastHighlighted = timelineCol;
        }
    }

    protected cleanup(): void {
        for (const el of this.hiddenElements) {
            el.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
        }
        super.cleanup();
        this.hiddenElements = [];
        this.container = null;
        this.baseTask = null;
        this.gridSurface = null;
        this.ghostEl = null;
    }
}
