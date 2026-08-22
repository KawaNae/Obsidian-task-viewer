import { BaseDragStrategy } from '../BaseDragStrategy';
import type { DragContext } from '../../DragStrategy';
import type { Task } from '../../../../types';
import { DateUtils } from '../../../../utils/DateUtils';
import { GhostRenderer } from '../../ghost/GhostRenderer';
import type { GhostPlan } from '../../ghost/GhostPlan';
import { type DisplayDateEdits, getOriginalTaskId } from '../../../../services/display/DisplayTaskConverter';
import type { GridSurface } from '../../grid/GridSurface';
import { CalendarGridSurface } from '../../grid/CalendarGridSurface';
import { AllDayGridSurface } from '../../grid/AllDayGridSurface';

/**
 * pointer 解決の結果。state に依存しない pure な意味単位。
 *  - dayDelta : 視覚的に何日分動いたか (clamp/locate 適用後)
 *  - crossViewSection : AllDay→Timeline drop のターゲット。Calendar では常に null
 */
export interface GridMoveTarget {
    dayDelta: number;
    crossViewSection: HTMLElement | null;
}

/**
 * planChange の結果。render と commit に渡す全情報。
 *  - render        : 描画方針 (preview ghost or cross-view floating)
 *  - commit        : 書き戻し時に使う edits。dayDelta=0 のときは null
 */
export interface GridMovePlan {
    render: GridMoveRenderPlan;
    commit: { edits: DisplayDateEdits; baseTask: Task } | null;
}

export type GridMoveRenderPlan =
    | {
          mode: 'preview';
          ghostPlans: GhostPlan[];
          arrowEndLine: number;
      }
    | {
          mode: 'cross-view-drop';
          floatingGhostPos: { x: number; y: number };
          arrowEndLine: number;
      };

/**
 * Calendar / AllDay の両 Grid Surface を扱う Move Gesture。
 *
 * onMove / onUp は **resolveTarget → planChange → render → commit** の 4 段
 * pipeline。pure 部 (resolveTarget の DOM 読みは Surface 内に隔離、planChange
 * 自体は state + target → plan の組み立て) と副作用 (render の DOM 操作、
 * commit の updateTask) の境界が分離されており、planChange の核は static
 * helper として unit test 可能。
 */
export class GridMoveGesture extends BaseDragStrategy {
    name = 'GridMove';

    private gridSurface: GridSurface | null = null;
    private ghostRenderer: GhostRenderer | null = null;
    private colWidth: number = 0;
    private startCol: number = 0;
    private grabCol: number = 0;
    private initialSpan: number = 0;
    private initialVisualStart: string = '';
    private initialVisualEnd: string = '';
    private initialGridColumn: string = '';
    private refHeaderCell: HTMLElement | null = null;
    private baseTask: Task | null = null;
    private hiddenElements: HTMLElement[] = [];
    /** Pointer がカード内のどこを掴んだかの相対オフセット (px)。cross-view drop の
     *  fixed ghost を pointer 追従しつつ「掴んだ位置」を維持するため。 */
    private grabOffsetX: number = 0;
    private grabOffsetY: number = 0;

    onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext): void {
        this.dragTask = task;
        this.dragEl = el;
        this.currentContext = context;
        this.hasMoved = false;
        this.initialX = e.clientX;
        this.initialY = e.clientY;

        // Pointer がカード内のどこを掴んだかを保存。cross-view drop で fixed ghost を
        // 配置する際、ghost top-left = pointer - grabOffset とすることで掴んだ
        // 相対位置が保たれる。getBoundingClientRect は viewport 座標を返すので
        // clientX/Y との差し引きで pure に相対オフセットが取れる。
        const elRect = el.getBoundingClientRect();
        this.grabOffsetX = e.clientX - elRect.left;
        this.grabOffsetY = e.clientY - elRect.top;

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

        const originalId = getOriginalTaskId(task);
        this.baseTask = context.readService.getTask(originalId) ?? task;

        const startHour = context.plugin.settings.startHour;
        const visual = this.getVisualDateRange(this.baseTask, startHour);
        this.initialVisualStart = visual.start;
        this.initialVisualEnd = visual.end;
        this.initialSpan = DateUtils.getDiffDays(visual.start, visual.end) + 1;
        this.colWidth = this.gridSurface.getColWidth();

        const colStart = Number.parseInt(el.dataset.colStart || '1', 10);
        const span = Number.parseInt(el.dataset.span || '1', 10);
        if (isCalendar) {
            this.startCol = colStart;
            const target = e.target as HTMLElement;
            this.grabCol = target.closest('.task-card__handle--move-bottom-right')
                ? Math.min(7, this.startCol + span - 1)
                : this.startCol;
        } else {
            this.startCol = colStart + 1; // AllDay: dataset.colStart は 0-based、+1 で grid 1-based
            this.grabCol = this.startCol;
        }

        this.initialGridColumn = el.style.gridColumn;

        const doc = context.container.ownerDocument || document;
        this.ghostRenderer = new GhostRenderer(el, doc);

        this.hiddenElements.push(...this.collectSplitSiblings(context, originalId));

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

        const target = this.resolveTarget(e, context);
        const plan = this.planChange(target, e, context);
        this.render(plan);
        this.updateDropZoneHighlight(e, context);
    }

    async onUp(e: PointerEvent, context: DragContext): Promise<void> {
        if (!this.dragTask || !this.dragEl || !this.gridSurface || !this.baseTask) return;

        this.clearHighlight();

        if (!this.hasMoved) {
            // drag せず press-release → 単純な card click として selection 設定
            this.ghostRenderer?.clear();
            context.onTaskClick(this.dragTask.id);
            this.cleanup();
            return;
        }

        const target = this.resolveTarget(e, context);
        const plan = this.planChange(target, e, context);
        // ghost の撤去は commit → 確定ジオメトリ反映のあと。旧実装はここに来る
        // 前（await の手前）で clear していたため、ソースカードが旧位置で
        // 再表示される時間が write の往復ぶんだけ伸びていた。
        await this.commitAndReveal({
            context,
            plan: plan.commit ? { edits: plan.commit.edits, baseTask: plan.commit.baseTask } : null,
            taskId: this.dragTask.id,
            sourceElements: this.hiddenElements,
            applyGeometry: () => this.applyCommittedGeometry(plan),
            clearGhosts: () => this.ghostRenderer?.clear(),
        });
        this.cleanup();
    }

    /**
     * ドロップ確定位置をソースカードへ反映する（{@link DropReveal} の許可証）。
     *
     * grid 内 move では ghost が既に確定 grid 座標で描かれているので、その
     * `gridColumn` / `gridRow` をソースカードへそのまま移すだけでよい。
     * grid 座標は render 側が毎回書き直すキーなので次 render で自己修復する。
     *
     * cross-view drop (AllDay→Timeline) は反映しない: カードは別 section へ
     * 移るので旧要素は確定 stale であり、reconciler が detach して消す。
     * ここで可視に戻すと「移動元に一瞬だけ戻る」フラッシュそのものになる。
     */
    private applyCommittedGeometry(plan: GridMovePlan): void {
        if (plan.render.mode !== 'preview') return;

        const ghostPlans = plan.render.ghostPlans;
        const count = Math.min(this.hiddenElements.length, ghostPlans.length);
        for (let i = 0; i < count; i++) {
            const el = this.hiddenElements[i];
            const ghost = ghostPlans[i];
            if (ghost.layout !== 'grid') continue;

            el.style.gridColumn = ghost.gridColumn;
            el.style.gridRow = ghost.gridRow;

            el.classList.remove('task-card--split-continues-before', 'task-card--split-continues-after');
            for (const cls of ghost.splitClasses) el.classList.add(cls);

            this.dropReveal.markApplied(el);
        }
    }

    // ========== Pipeline 4 段 ==========

    /**
     * pointer (clientX, clientY) を意味のある target に解決する。
     * Surface 内部で DOM を読むが、Gesture 側は target 構造体を受け取るだけ。
     */
    private resolveTarget(e: PointerEvent, context: DragContext): GridMoveTarget {
        if (!this.gridSurface) return { dayDelta: 0, crossViewSection: null };

        if (this.isAllDay) {
            const doc = context.container.ownerDocument || document;
            const crossViewSection = this.gridSurface.canCrossToTimeline?.(e.clientX, e.clientY, doc) ?? null;
            const dayDelta = this.gridSurface.clampDayDelta(
                Math.round((e.clientX - this.initialX) / this.colWidth),
                this.initialVisualStart,
                this.initialVisualEnd,
            );
            return { dayDelta, crossViewSection };
        }

        // Calendar
        const sourceWeekRow = this.container as HTMLElement | null;
        const sourceWeekStart = sourceWeekRow?.dataset.weekStart || context.getViewStartDate();
        const located = this.gridSurface.locatePointer(e.clientX, e.clientY, { suppressEl: this.dragEl });
        const dayDelta = (located && located.weekStart)
            ? DateUtils.getDiffDays(sourceWeekStart, located.weekStart) + located.col - this.grabCol
            : Math.round((e.clientX - this.initialX) / this.colWidth);
        return { dayDelta, crossViewSection: null };
    }

    /**
     * target + 内部 state から render/commit プランを組み立てる。Surface への
     * 呼び出しはここで起きるが、計算自体は (initialVisualStart/End, baseTask,
     * dayDelta, crossViewSection) のみに依存し、副作用なし。
     */
    private planChange(target: GridMoveTarget, e: PointerEvent, context: DragContext): GridMovePlan {
        if (!this.dragEl || !this.gridSurface || !this.baseTask) {
            return { render: { mode: 'preview', ghostPlans: [], arrowEndLine: 0 }, commit: null };
        }
        const trackIndex = Number.parseInt(this.dragEl.dataset.trackIndex || '0', 10);

        if (target.crossViewSection) {
            // AllDay → Timeline drop
            const edits = GridMoveGesture.buildTimelineDropEdits(
                target.crossViewSection,
                e.clientY,
                context.getZoomLevel(),
                context.plugin.settings.startHour,
            );
            return {
                render: {
                    mode: 'cross-view-drop',
                    floatingGhostPos: GridMoveGesture.computeFloatingGhostPos(
                        e.clientX, e.clientY, this.grabOffsetX, this.grabOffsetY,
                    ),
                    arrowEndLine: this.startCol + this.initialSpan,
                },
                commit: edits ? { edits, baseTask: this.baseTask } : null,
            };
        }

        // 通常の grid 内 move
        const movedStart = DateUtils.addDays(this.initialVisualStart, target.dayDelta);
        const movedEnd = DateUtils.addDays(this.initialVisualEnd, target.dayDelta);
        const ghostPlans = this.gridSurface.planSegments({ rangeStart: movedStart, rangeEnd: movedEnd, trackIndex });
        const edits = GridMoveGesture.buildMoveEdits(
            this.initialVisualStart,
            this.initialVisualEnd,
            target.dayDelta,
            this.baseTask,
        );
        return {
            render: {
                mode: 'preview',
                ghostPlans,
                arrowEndLine: this.startCol + this.initialSpan + target.dayDelta,
            },
            commit: edits ? { edits, baseTask: this.baseTask } : null,
        };
    }

    /**
     * plan を DOM に反映 (副作用)。
     *
     * - cross-view-drop: source を dimmed、ghost は単一 fixed (pointer 追従)
     * - preview        : source を hide、ghost は plan.ghostPlans の grid layout で展開
     *
     * ghost 描画は全て {@link GhostRenderer.render} 経由 (旧 ghostEl /
     * updateSplitPreview の二重実装が一本化された)。
     */
    private render(plan: GridMovePlan): void {
        if (!this.dragEl || !this.ghostRenderer) return;

        if (plan.render.mode === 'cross-view-drop') {
            // floating fixed ghost を pointer に追従。source は dimmed。
            this.hiddenElements.forEach(el => {
                el.classList.remove('is-drag-hidden');
                el.classList.add('is-drag-source-dimmed');
            });
            this.dragEl.style.transform = '';
            this.dragEl.style.gridColumn = this.initialGridColumn;

            const rect = this.dragEl.getBoundingClientRect();
            const fixedGhost: GhostPlan = {
                layout: 'fixed',
                left: plan.render.floatingGhostPos.x,
                top: plan.render.floatingGhostPos.y,
                width: rect.width,
                height: rect.height,
                splitClasses: [],
            };
            this.ghostRenderer.render([fixedGhost]);
        } else {
            // grid 内 preview: source を hide、ghost は split-aware grid layout で展開
            this.hiddenElements.forEach(el => {
                el.classList.remove('is-drag-source-dimmed', 'is-drag-source-faint');
                el.classList.add('is-drag-hidden');
            });
            this.dragEl.style.transform = '';
            this.dragEl.style.gridColumn = this.initialGridColumn;
            this.ghostRenderer.render(plan.render.ghostPlans);
        }
        this.updateArrowPosition(plan.render.arrowEndLine);
    }

    // ========== Pure helpers (unit-testable) ==========

    /**
     * Cross-view drop の fixed ghost top-left を計算する pure helper。
     * Pointer から grabOffset を引くことで、ghost 内の掴み位置が常に pointer に
     * 一致する (= 掴んだ相対位置を保ったまま追従)。grabOffset 無視の +10/+10
     * オフセットは ghost が pointer の右下にジャンプする旧バグの根因だった。
     */
    static computeFloatingGhostPos(
        clientX: number,
        clientY: number,
        grabOffsetX: number,
        grabOffsetY: number,
    ): { x: number; y: number } {
        return { x: clientX - grabOffsetX, y: clientY - grabOffsetY };
    }

    /**
     * Calendar/AllDay 共通の Move 用 edits ビルダ。endDate 系の値があれば
     * effectiveEndDate も同 dayDelta だけ shift し、なければ start のみ更新。
     *
     * pure: 入力 (initialVisualStart, initialVisualEnd, dayDelta, baseTask の
     * endDate/endTime 有無) のみで結果が決まる。
     */
    static buildMoveEdits(
        initialVisualStart: string,
        initialVisualEnd: string,
        dayDelta: number,
        baseTask: Task,
    ): DisplayDateEdits | null {
        if (dayDelta === 0) return null;
        const movedStart = DateUtils.addDays(initialVisualStart, dayDelta);
        const movedEnd = DateUtils.addDays(initialVisualEnd, dayDelta);
        const edits: DisplayDateEdits = { effectiveStartDate: movedStart };
        if (baseTask.endDate || baseTask.endTime) {
            edits.effectiveEndDate = movedEnd;
        }
        return edits;
    }

    /**
     * AllDay → Timeline cross-view drop 用 edits ビルダ。day-column の dataset.date
     * と clientY から、startTime ＝ 15 分単位 snap、endTime ＝ start +
     * DEFAULT_TIMED_DURATION_MINUTES。day boundary を跨ぐ場合は startDate /
     * endDate も day オフセットで補正。
     *
     * pure: timelineSection.dataset.date と timelineSection.getBoundingClientRect()
     * への依存はあるが、それ以外は引数のみ。
     */
    static buildTimelineDropEdits(
        timelineSection: HTMLElement,
        clientY: number,
        zoomLevel: number,
        startHour: number,
    ): DisplayDateEdits | null {
        const targetDate = timelineSection.dataset.date;
        if (!targetDate) return null;

        const rect = timelineSection.getBoundingClientRect();
        const yInContainer = clientY - rect.top;
        const snapPixels = 15 * zoomLevel;
        const snappedTop = Math.round(yInContainer / snapPixels) * snapPixels;

        const startHourMinutes = startHour * 60;
        const minutesFromStart = snappedTop / zoomLevel;
        const totalMin = startHourMinutes + minutesFromStart;
        const totalEndMin = totalMin + DateUtils.DEFAULT_TIMED_DURATION_MINUTES;

        const startDayOffset = Math.floor(totalMin / 1440);
        const endDayOffset = Math.floor(totalEndMin / 1440);

        return {
            effectiveStartDate: DateUtils.addDays(targetDate, startDayOffset),
            effectiveStartTime: DateUtils.minutesToTime(totalMin),
            effectiveEndDate: DateUtils.addDays(targetDate, endDayOffset),
            effectiveEndTime: DateUtils.minutesToTime(totalEndMin),
        };
    }

    // ========== UI side-effects ==========

    private updateDropZoneHighlight(e: PointerEvent, context: DragContext): void {
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);
        this.clearHighlight();

        const timelineCol = elBelow?.closest('.timeline-scroll-area__day-column') as HTMLElement;
        if (timelineCol) {
            timelineCol.addClass('drag-over');
            this.lastHighlighted = timelineCol;
        }
    }

    protected cleanup(): void {
        // 再可視化はゲート越し（DropReveal 参照）。cross-view drop のように
        // 確定ジオメトリを持てなかった要素は隠したまま次 render に渡る。
        this.dropReveal.finish(this.hiddenElements);
        this.ghostRenderer?.clear();
        this.ghostRenderer = null;
        super.cleanup();
        this.hiddenElements = [];
        this.container = null;
        this.baseTask = null;
        this.gridSurface = null;
    }
}
