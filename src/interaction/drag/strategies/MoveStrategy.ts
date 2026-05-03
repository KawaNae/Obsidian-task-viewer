import { BaseDragStrategy } from './BaseDragStrategy';
import { DragContext } from '../DragStrategy';
import { Task } from '../../../types';
import { DateUtils } from '../../../utils/DateUtils';
import { GhostManager, GhostSegment } from '../ghost/GhostManager';
import { createGhostElement, removeGhostElement } from '../ghost/GhostFactory';
import { DisplayDateEdits, getOriginalTaskId } from '../../../services/display/DisplayTaskConverter';
import type { DragPlan } from '../DragPlan';

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
    private grabCol: number = 0;
    private initialSpan: number = 0;
    private initialCalendarVisualStart: string = '';
    private initialCalendarVisualEnd: string = '';
    private initialGridColumn: string = '';
    private container: HTMLElement | null = null;
    private isOutsideSection: boolean = false;
    private refHeaderCell: HTMLElement | null = null;
    /** Original (pre-split) raw task. Cached at drag start so commitPlan
     *  has access for materializeRawDates' endDate-semantic decision. */
    private baseTask: Task | null = null;

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
                this.hiddenElements.forEach(el => el.classList.add('is-drag-hidden'));
            }
            this.processTimelineMove(e.clientX, e.clientY);
            this.checkAutoScroll(e.clientY);
        } else if (this.viewType === 'calendar') {
            if (this.hiddenElements.length > 0) {
                this.hiddenElements.forEach(el => el.classList.add('is-drag-hidden'));
            }
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
        this.scrollContainer = context.container.querySelector('.timeline-grid') as HTMLElement;
        const ghostContainer = this.scrollContainer?.querySelector('.timeline-scroll-area__grid') as HTMLElement
            || this.scrollContainer || context.container;
        this.ghostManager = new GhostManager(ghostContainer);

        const zoomLevel = context.getZoomLevel();
        const startMinutes = Number.parseFloat(el.style.getPropertyValue('--start-minutes') || '0');
        const durationMinutes = Number.parseFloat(el.style.getPropertyValue('--duration-minutes') || '0');
        this.initialTop = Number.isFinite(startMinutes) ? startMinutes * zoomLevel : 0;
        this.initialHeight = Number.isFinite(durationMinutes) ? durationMinutes * zoomLevel : 0;

        const dayCol = el.closest('.timeline-scroll-area__day-column') as HTMLElement;
        this.currentDayDate = dayCol ? dayCol.dataset.date || null : (task.startDate || null);

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
        const originalId = getOriginalTaskId(task);
        const originalTask = context.readService.getTask(originalId);

        let originalTaskStartMinutes: number | null = null;
        let originalTaskEndMinutes: number | null = null;

        const effectiveEndDate = originalTask?.endDate || originalTask?.startDate;
        if (originalTask?.startDate && originalTask.startTime && effectiveEndDate && originalTask.endTime) {
            const start = new Date(`${originalTask.startDate}T${originalTask.startTime}`);
            const end = new Date(`${effectiveEndDate}T${originalTask.endTime}`);
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

        // 分割タスクの全セグメントを非表示リストに追加（pinnedList内のカードは除外）
        const selector = `.task-card[data-id="${originalId}"], .task-card[data-split-original-id="${originalId}"]`;
        const allSegments = context.container.querySelectorAll(selector);
        allSegments.forEach(segment => {
            if (segment instanceof HTMLElement && !segment.closest('.tv-sidebar__pinned-lists')) {
                this.hiddenElements.push(segment);
            }
        });
    }

    private processTimelineMove(clientX: number, clientY: number) {
        if (!this.dragTask || !this.dragEl || !this.currentContext || !this.ghostManager) return;
        const context = this.currentContext;

        const zoomLevel = context.getZoomLevel();
        const startHour = context.plugin.settings.startHour;
        const startHourMinutes = startHour * 60;
        const durationMinutes = this.initialHeight / zoomLevel;

        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(clientX, clientY);
        let dayCol = elBelow?.closest('.timeline-scroll-area__day-column') as HTMLElement;

        if (!dayCol && this.dragEl.parentElement?.classList.contains('timeline-scroll-area__day-column')) {
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

        await context.writeService.updateTask(this.dragTask.id, updates);
        this.restoreSelection(context, taskIdToRestore);
        ghostManagerToClean?.clear();

        this.cleanup();
    }

    // ========== Calendar Move ==========

    private initCalendarMove(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        const weekRow = (el.closest('.cal-week-row') as HTMLElement) || context.container;
        this.container = weekRow;

        const headerCell = weekRow.querySelector('.cal-day-cell') as HTMLElement;
        this.refHeaderCell = headerCell;
        this.colWidth = this.getCalendarDayColumnWidth(weekRow);

        // Resolve original (pre-split) raw task. dragTask may be a split
        // segment whose dates differ from the source.
        const originalId = getOriginalTaskId(task);
        this.baseTask = context.readService.getTask(originalId) ?? task;

        // Visual dates (inclusive) for ghost rendering — matches task card renderer
        const startHour = context.plugin.settings.startHour;
        const visual = this.getVisualDateRange(this.baseTask, startHour);
        this.initialCalendarVisualStart = visual.start;
        this.initialCalendarVisualEnd = visual.end;
        this.initialSpan = DateUtils.getDiffDays(visual.start, visual.end) + 1;

        // Read position from data attributes (absolute positioning)
        const colStart = Number.parseInt(el.dataset.colStart || '1', 10);
        const span = Number.parseInt(el.dataset.span || '1', 10);
        this.startCol = colStart;
        const target = e.target as HTMLElement;
        // Calendar / AllDay では HandleManager が move handle を `bottom-left` /
        // `bottom-right` で生成する (top-* は Timeline 縦タスク専用)。
        // 以前は `move-top-right` で判定しており常に false 評価 → grabCol が
        // 左端に固定され、右側 handle を握っても startDate 基準で平行移動する
        // バグになっていた。
        if (target.closest('.task-card__handle--move-bottom-right')) {
            this.grabCol = Math.min(7, this.startCol + span - 1);
        } else {
            this.grabCol = this.startCol;
        }
        this.initialGridColumn = el.style.gridColumn;

        el.style.zIndex = '1000';

        const doc = context.container.ownerDocument || document;
        this.ghostEl = createGhostElement(el, doc);
        this.clearPreviewGhosts();

        const selector = `.task-card[data-id="${originalId}"], .task-card[data-split-original-id="${originalId}"]`;
        context.container.querySelectorAll(selector).forEach(segment => {
            if (segment instanceof HTMLElement && !segment.closest('.tv-sidebar__pinned-lists')) {
                this.hiddenElements.push(segment);
            }
        });
    }

    private processCalendarMove(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl) return;

        const sourceWeekRow = this.container as HTMLElement;
        const target = this.resolveCalendarPointerTarget(e.clientX, e.clientY, context);
        const sourceWeekStart = sourceWeekRow?.dataset.weekStart || context.getViewStartDate();

        let dayDelta = Math.round((e.clientX - this.initialX) / this.colWidth);
        if (target) {
            dayDelta = DateUtils.getDiffDays(sourceWeekStart, target.weekStart) + target.col - this.grabCol;
        }

        if (this.ghostEl) {
            this.ghostEl.classList.add('is-drag-hidden');
            this.ghostEl.style.left = '-9999px';
        }

        const movedStart = DateUtils.addDays(this.initialCalendarVisualStart, dayDelta);
        const movedEnd = DateUtils.addDays(this.initialCalendarVisualEnd, dayDelta);
        this.updateSplitPreview(this.planCalendarSegments(context, movedStart, movedEnd));
        this.dragEl.style.transform = '';
    }

    private async finishCalendarMove(e: PointerEvent, context: DragContext) {
        removeGhostElement(this.ghostEl);
        this.ghostEl = null;

        if (!this.dragTask || !this.dragEl) {
            this.cleanup();
            return;
        }

        const sourceWeekRow = this.container as HTMLElement;
        const sourceWeekStart = sourceWeekRow?.dataset.weekStart || context.getViewStartDate();
        const target = this.resolveCalendarPointerTarget(e.clientX, e.clientY, context);

        let dayDelta = Math.round((e.clientX - this.initialX) / this.colWidth);
        if (target) {
            dayDelta = DateUtils.getDiffDays(sourceWeekStart, target.weekStart) + target.col - this.grabCol;
        }

        await this.commitPlan(context, this.buildMoveDayShiftPlan(dayDelta), this.dragTask.id);
        this.cleanup();
    }

    // ========== AllDay Move ==========

    private initAllDayMove(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        this.container = context.container;

        const grid = el.closest('.timeline-grid');
        const headerCell = grid?.querySelector('.date-header__cell:nth-child(2)') as HTMLElement;
        this.refHeaderCell = headerCell;
        this.colWidth = headerCell?.getBoundingClientRect().width || 100;

        // Resolve original (pre-split) raw task — used by commitPlan for endDate semantic.
        const originalId = getOriginalTaskId(task);
        this.baseTask = context.readService.getTask(originalId) ?? task;

        // Visual dates (inclusive) for ghost rendering — matches task card renderer
        const startHour = context.plugin.settings.startHour;
        const visual = this.getVisualDateRange(this.baseTask, startHour);
        this.initialCalendarVisualStart = visual.start;
        this.initialCalendarVisualEnd = visual.end;
        this.initialSpan = DateUtils.getDiffDays(visual.start, visual.end) + 1;

        // dataset から grid 座標を取得 (calendar 側と対称)。dataset.colStart は
        // dates 配列内 1-based (dates[0] → 1)、`AllDaySectionRenderer` が
        // `gridColumn = entry.colStart + 1 / span N` と axis col 補正で +1 する。
        // due-arrow の座標計算は startCol を 1-based grid column で扱うため +1。
        const dataColStart = Number.parseInt(el.dataset.colStart || '1', 10);
        this.startCol = dataColStart + 1;
        this.initialGridColumn = el.style.gridColumn;

        el.style.zIndex = '1000';

        const doc = context.container.ownerDocument || document;
        this.ghostEl = createGhostElement(el, doc);

        // 同一 originalId の split segments を hide する (calendar と同じパターン)。
        // preview ghost で正本を出すため、source 側はすべて消しておく。
        const selector = `.task-card[data-id="${originalId}"], .task-card[data-split-original-id="${originalId}"]`;
        context.container.querySelectorAll(selector).forEach(segment => {
            if (segment instanceof HTMLElement && !segment.closest('.tv-sidebar__pinned-lists')) {
                this.hiddenElements.push(segment);
            }
        });
    }

    /**
     * Allday は単一 view (week 切替の cal-week-row 相当が無い) なので、task が
     * view 範囲と完全に切り離れる drag を許すと「card が消える」=「selection が
     * 失われる」体感バグになる。task が view と少なくとも 1 日重なるよう dayDelta
     * を clamp する。
     */
    private clampAllDayDayDelta(dayDelta: number, context: DragContext): number {
        const viewStart = context.getViewStartDate();
        const viewEnd = context.getViewEndDate();
        if (!viewStart || !viewEnd) return dayDelta;
        // movedEnd >= viewStart  → dayDelta >= viewStart - initialEnd
        const minDelta = DateUtils.getDiffDays(this.initialCalendarVisualEnd, viewStart);
        // movedStart <= viewEnd  → dayDelta <= viewEnd - initialStart
        const maxDelta = DateUtils.getDiffDays(this.initialCalendarVisualStart, viewEnd);
        return Math.max(minDelta, Math.min(maxDelta, dayDelta));
    }

    private processAllDayMove(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl) return;

        const deltaX = e.clientX - this.initialX;
        const snapPixels = this.colWidth;
        const dayDelta = this.clampAllDayDayDelta(Math.round(deltaX / snapPixels), context);

        // セクション外判定 (timeline 列にホバー)
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);
        const timelineSection = elBelow?.closest('.timeline-scroll-area__day-column');
        this.isOutsideSection = !!timelineSection;

        if (this.isOutsideSection && this.ghostEl) {
            // timeline ドロップ用 floating ghost をポインタに追従させ、preview は消す。
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

            const originalEndLine = this.startCol + this.initialSpan;
            this.updateArrowPosition(originalEndLine);
        } else if (this.ghostEl) {
            // section 内: source を hide → split-aware preview ghost で WYSIWYG 表示。
            this.ghostEl.classList.add('is-drag-hidden');
            this.ghostEl.style.left = '-9999px';
            this.hiddenElements.forEach(el => {
                el.classList.remove('is-drag-source-dimmed', 'is-drag-source-faint');
                el.classList.add('is-drag-hidden');
            });
            this.dragEl.style.transform = '';
            this.dragEl.style.gridColumn = this.initialGridColumn;

            const movedStart = DateUtils.addDays(this.initialCalendarVisualStart, dayDelta);
            const movedEnd = DateUtils.addDays(this.initialCalendarVisualEnd, dayDelta);
            this.updateSplitPreview(this.planAllDaySegments(context, movedStart, movedEnd));

            const newTaskEndLine = this.startCol + this.initialSpan + dayDelta;
            this.updateArrowPosition(newTaskEndLine);
        }

        this.updateDropZoneHighlight(e, context);
    }

    private async finishAllDayMove(e: PointerEvent, context: DragContext) {
        removeGhostElement(this.ghostEl);
        this.ghostEl = null;

        if (!this.dragTask || !this.dragEl || !this.baseTask) {
            this.cleanup();
            return;
        }

        // タイムラインへのドロップ判定
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);
        const timelineSection = elBelow?.closest('.timeline-scroll-area__day-column') as HTMLElement;

        if (timelineSection) {
            const plan = this.buildTimelineDropPlan(timelineSection, e.clientY, context);
            await this.commitPlan(context, plan, this.dragTask.id);
            this.cleanup();
            return;
        }

        // 通常のAllDay内移動。process と同じ clamp を適用して task が view と
        // 完全に切り離れるドロップを防ぐ (selection-loss 体感バグの根本対処)。
        const deltaX = e.clientX - this.initialX;
        const dayDelta = this.clampAllDayDayDelta(Math.round(deltaX / this.colWidth), context);

        await this.commitPlan(context, this.buildMoveDayShiftPlan(dayDelta), this.dragTask.id);
        this.cleanup();
    }

    /**
     * AllDay → Timeline cross-view drop の DragPlan ビルダ。
     *
     * targetDate（drop 先 day-column の日付）と clientY を起点に、startTime ＝
     * 15 分単位 snap、endTime ＝ start + DEFAULT_TIMED_DURATION_MINUTES。
     * day boundary を跨ぐ場合は startDate / endDate も day オフセットで補正。
     *
     * 結果は visual edits 4 つ（effectiveStart/End × Date/Time）。allday から
     * timed への切替は edits.effectiveEndTime ありなので materializeRawDates 側で
     * `willHaveEndTime=true` の inclusive semantic に切り替わる。
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
        const totalMinutes = startHourMinutes + minutesFromStart;
        const totalEndMinutes = totalMinutes + DateUtils.DEFAULT_TIMED_DURATION_MINUTES;

        const startDayOffset = Math.floor(totalMinutes / 1440);
        const endDayOffset = Math.floor(totalEndMinutes / 1440);

        const edits: DisplayDateEdits = {
            effectiveStartDate: DateUtils.addDays(targetDate, startDayOffset),
            effectiveStartTime: DateUtils.minutesToTime(totalMinutes),
            effectiveEndDate: DateUtils.addDays(targetDate, endDayOffset),
            effectiveEndTime: DateUtils.minutesToTime(totalEndMinutes),
        };
        return { edits, baseTask: this.baseTask };
    }

    /**
     * Calendar/AllDay 共通の Move 用 DragPlan ビルダ。
     *
     * Move は visual 範囲を `dayDelta` だけ平行移動するだけなので、edits は
     * 単純な start/end shift。`baseTask.endDate || baseTask.endTime` がある
     * ときだけ effectiveEndDate も入れる。これは旧 buildAllDayMoveUpdates の
     * 8 分岐を「endDate 系の値があれば一緒に動かす、なければ start のみ」と
     * いう本質ルールに圧縮したもの。
     *
     * - dayDelta=0: null（変更なし、commitPlan が早期 return）
     * - baseTask 未設定: null（drag 初期化が失敗していた等の防御）
     */
    private buildMoveDayShiftPlan(dayDelta: number): DragPlan | null {
        if (dayDelta === 0) return null;
        if (!this.baseTask) return null;
        const movedStart = DateUtils.addDays(this.initialCalendarVisualStart, dayDelta);
        const movedEnd = DateUtils.addDays(this.initialCalendarVisualEnd, dayDelta);
        const edits: DisplayDateEdits = { effectiveStartDate: movedStart };
        if (this.baseTask.endDate || this.baseTask.endTime) {
            edits.effectiveEndDate = movedEnd;
        }
        return { edits, baseTask: this.baseTask };
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

    private updateDropZoneHighlight(e: PointerEvent, context: DragContext) {
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

    private checkAutoScroll(mouseY: number): void {
        if (!this.scrollContainer) return;
        const rect = this.scrollContainer.getBoundingClientRect();
        const scrollThreshold = 50;
        const scrollSpeed = 20;

        // Use allday bottom as effective top so auto-scroll zone doesn't overlap sticky allday
        const allday = this.scrollContainer.querySelector('.allday-section') as HTMLElement | null;
        const effectiveTop = allday ? allday.getBoundingClientRect().bottom : rect.top;

        const shouldScrollUp = mouseY < effectiveTop + scrollThreshold;
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
        this.clearPreviewGhosts();
        context.onTaskClick(taskId);
        this.cleanup();
    }

    protected cleanup(): void {
        // hiddenElements は drag 中に `is-drag-hidden` 等を付与した DOM 要素群。
        // super.cleanup() は dragEl のみ class 除去するため、関連 segments は
        // 各 finish で個別 remove していた。cleanup() に集約することで漏れを防ぐ。
        for (const el of this.hiddenElements) {
            el.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
        }
        super.cleanup();
        this.hiddenElements = [];
        this.lastDragResult = null;
        this.currentDayDate = null;
        this.container = null;
        this.baseTask = null;
    }
}
