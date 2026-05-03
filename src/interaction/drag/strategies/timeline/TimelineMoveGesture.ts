import { BaseDragStrategy } from '../BaseDragStrategy';
import type { DragContext } from '../../DragStrategy';
import type { Task } from '../../../../types';
import { DateUtils } from '../../../../utils/DateUtils';
import { GhostRenderer } from '../../ghost/GhostRenderer';
import type { GhostPlan } from '../../ghost/GhostPlan';
import { toDisplayHeightPx, toDisplayTopPx } from '../../../../views/sharedLogic/TimelineCardPosition';
import { DisplayDateEdits, getOriginalTaskId } from '../../../../services/display/DisplayTaskConverter';
import type { DragPlan } from '../../DragPlan';

/**
 * Timeline (timed タスク, 縦軸) の Move Gesture。
 *
 * - 分単位の縦座標 (zoomLevel × minutes) で扱う
 * - 複数日跨ぎの cascade ghost を {@link GhostRenderer} 経由で同時表示
 * - 上下の autoScroll 機能あり
 * - Calendar/AllDay とは grid 座標系・preview 戦略が根本的に異なるため Gesture を分離
 */
export class TimelineMoveGesture extends BaseDragStrategy {
    name = 'TimelineMove';

    private ghostRenderer: GhostRenderer | null = null;
    private ghostContainer: HTMLElement | null = null;
    private dragTimeOffset: number = 0;
    private anchorType: 'start' | 'end' = 'start';
    private currentDayDate: string | null = null;
    private lastDragResult: { startDate: string; startTime: string; endDate: string; endTime: string } | null = null;
    private hiddenElements: HTMLElement[] = [];
    private initialTop: number = 0;
    private initialHeight: number = 0;
    /** Original (pre-split) raw task. commitPlan の materializeRawDates が
     *  endDate dual-semantic (inclusive vs exclusive) を判定するのに使う。 */
    private baseTask: Task | null = null;

    private autoScrollTimer: number | null = null;
    private scrollContainer: HTMLElement | null = null;
    private lastClientX: number = 0;
    private lastClientY: number = 0;

    onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext): void {
        this.dragTask = task;
        this.dragEl = el;
        this.currentContext = context;
        this.hasMoved = false;
        this.initialX = e.clientX;
        this.initialY = e.clientY;

        this.scrollContainer = context.container.querySelector('.timeline-grid') as HTMLElement;
        this.ghostContainer = this.scrollContainer?.querySelector('.timeline-scroll-area__grid') as HTMLElement
            || this.scrollContainer || context.container;
        const doc = context.container.ownerDocument || document;
        this.ghostRenderer = new GhostRenderer(el, doc);

        const zoomLevel = context.getZoomLevel();
        const startMinutes = Number.parseFloat(el.style.getPropertyValue('--start-minutes') || '0');
        const durationMinutes = Number.parseFloat(el.style.getPropertyValue('--duration-minutes') || '0');
        this.initialTop = Number.isFinite(startMinutes) ? startMinutes * zoomLevel : 0;
        this.initialHeight = Number.isFinite(durationMinutes) ? durationMinutes * zoomLevel : 0;

        const dayCol = el.closest('.timeline-scroll-area__day-column') as HTMLElement;
        this.currentDayDate = dayCol ? dayCol.dataset.date || null : (task.startDate || null);

        const startHour = context.plugin.settings.startHour;
        const startHourMinutes = startHour * 60;

        // anchorType 判定: bottom-right move handle なら end ベース、そうでなければ start ベース
        const target = e.target as HTMLElement;
        this.anchorType = target.closest('.task-card__handle--move-bottom-right') ? 'end' : 'start';

        // 分割タスク: 元 task の絶対分時刻を取得して anchor 計算と initialHeight に使う
        const originalId = getOriginalTaskId(task);
        const originalTask = context.readService.getTask(originalId);
        this.baseTask = originalTask ?? task;

        let originalTaskStartMinutes: number | null = null;
        let originalTaskEndMinutes: number | null = null;

        const effectiveEndDate = originalTask?.endDate || originalTask?.startDate;
        if (originalTask?.startDate && originalTask.startTime && effectiveEndDate && originalTask.endTime) {
            const start = new Date(`${originalTask.startDate}T${originalTask.startTime}`);
            const end = new Date(`${effectiveEndDate}T${originalTask.endTime}`);
            if (end < start) end.setDate(end.getDate() + 1);

            const dur = (end.getTime() - start.getTime()) / 60000;
            this.initialHeight = dur * zoomLevel;

            if (this.currentDayDate) {
                const currentDayStart = new Date(`${this.currentDayDate}T00:00:00`);
                originalTaskStartMinutes = (start.getTime() - currentDayStart.getTime()) / 60000;
                originalTaskEndMinutes = (end.getTime() - currentDayStart.getTime()) / 60000;
            }
        }

        let mouseMinutes = 0;
        if (dayCol) {
            const dayRect = dayCol.getBoundingClientRect();
            mouseMinutes = startHourMinutes + ((e.clientY - dayRect.top) / zoomLevel);
        }

        const visualStartMinutes = originalTaskStartMinutes !== null
            ? originalTaskStartMinutes
            : startHourMinutes + (this.initialTop / zoomLevel);
        const visualEndMinutes = originalTaskEndMinutes !== null
            ? originalTaskEndMinutes
            : visualStartMinutes + (this.initialHeight / zoomLevel);

        this.dragTimeOffset = this.anchorType === 'end'
            ? visualEndMinutes - mouseMinutes
            : mouseMinutes - visualStartMinutes;

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
        this.lastClientX = e.clientX;
        this.lastClientY = e.clientY;

        const deltaX = e.clientX - this.initialX;
        const deltaY = e.clientY - this.initialY;
        if (!this.checkMoveThreshold(deltaX, deltaY)) return;

        // 最初の move で source segments を非表示化
        if (this.hiddenElements.length > 0) {
            this.hiddenElements.forEach(el => el.classList.add('is-drag-hidden'));
        }
        this.processMove(e.clientX, e.clientY);
        this.checkAutoScroll(e.clientY);
    }

    async onUp(e: PointerEvent, context: DragContext): Promise<void> {
        if (!this.dragTask || !this.dragEl) return;

        this.clearHighlight();
        this.stopAutoScroll();

        if (!this.hasMoved) {
            this.cleanupAndSelect(context, this.dragTask.id);
            return;
        }

        await this.finishMove(context);
    }

    private processMove(clientX: number, clientY: number): void {
        if (!this.dragTask || !this.dragEl || !this.currentContext || !this.ghostRenderer || !this.ghostContainer) return;
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
            if (dayCol.dataset.date) this.currentDayDate = dayCol.dataset.date;

            const mouseMinutes = startHourMinutes + (yInContainer / zoomLevel);
            if (this.anchorType === 'end') {
                const snapped = Math.round((mouseMinutes + this.dragTimeOffset) / 15) * 15;
                totalEndMinutes = snapped;
                totalStartMinutes = totalEndMinutes - durationMinutes;
            } else {
                const snapped = Math.round((mouseMinutes - this.dragTimeOffset) / 15) * 15;
                totalStartMinutes = snapped;
                totalEndMinutes = totalStartMinutes + durationMinutes;
            }
        } else {
            const deltaY = clientY - this.initialY;
            const snapPixels = 15 * zoomLevel;
            const snappedTop = Math.round((this.initialTop + deltaY) / snapPixels) * snapPixels;
            totalStartMinutes = startHourMinutes + (snappedTop / zoomLevel);
            totalEndMinutes = totalStartMinutes + durationMinutes;
        }

        const roundedStart = Math.round(totalStartMinutes);
        const roundedEnd = Math.round(totalEndMinutes);
        const startDayOffset = Math.floor(roundedStart / 1440);
        const endDayOffset = Math.floor(roundedEnd / 1440);
        const normStart = ((roundedStart % 1440) + 1440) % 1440;
        const normEnd = ((roundedEnd % 1440) + 1440) % 1440;

        this.lastDragResult = {
            startDate: DateUtils.addDays(this.currentDayDate!, startDayOffset),
            startTime: DateUtils.minutesToTime(normStart),
            endDate: DateUtils.addDays(this.currentDayDate!, endDayOffset),
            endTime: DateUtils.minutesToTime(normEnd),
        };

        // 2-stage:
        //   stage 1 (pure)  : computeOverlappingDays が -1/0/+1 day window と
        //                      task の overlap から { date, top, height } を計算
        //   stage 2 (DOM I/O): planTimelineSegments が day-column を querySelector
        //                      して absolute coords を解決し GhostPlan[] にする
        //   stage 3 (副作用) : ghostRenderer.render が DOM に反映
        const candidates = TimelineMoveGesture.computeOverlappingDays(
            totalStartMinutes,
            totalEndMinutes,
            startHourMinutes,
            zoomLevel,
            this.currentDayDate!,
        );
        const plans = TimelineMoveGesture.planTimelineSegments(
            candidates,
            this.scrollContainer!,
            this.ghostContainer,
            this.dragEl,
        );
        this.ghostRenderer.render(plans);
    }

    /**
     * pure helper: -1/0/+1 day window と task の overlap を計算し、各重なり区間を
     * { date, top(logical px), height(logical px) } として返す。Day boundary を
     * 跨がない短い task は単一 candidate、跨ぐ task は 2-3 candidates。
     *
     * 完全に pure (DateUtils.addDays / minutesToTime / 算術のみ)、unit test 可能。
     */
    static computeOverlappingDays(
        totalStartMinutes: number,
        totalEndMinutes: number,
        startHourMinutes: number,
        zoomLevel: number,
        currentDayDate: string,
    ): { date: string; top: number; height: number }[] {
        const candidates: { date: string; top: number; height: number }[] = [];
        for (const offsetDays of [-1, 0, 1]) {
            const windowStart = startHourMinutes + (offsetDays * 1440);
            const windowEnd = windowStart + 1440;
            const overlapStart = Math.max(totalStartMinutes, windowStart);
            const overlapEnd = Math.min(totalEndMinutes, windowEnd);
            if (overlapStart < overlapEnd) {
                candidates.push({
                    date: DateUtils.addDays(currentDayDate, offsetDays),
                    top: (overlapStart - windowStart) * zoomLevel,
                    height: (overlapEnd - overlapStart) * zoomLevel,
                });
            }
        }
        return candidates;
    }

    /**
     * stage 2: candidates → AbsoluteGhostPlan[]。
     * scrollContainer から date 一致の day-column を querySelector し、
     * `dayCol.offsetLeft/Top + sourceEl.offsetLeft/Width` で cascade 位置に揃える。
     * 複数 candidates がある場合は隣接ペアに sawtooth split class を付与。
     *
     * DOM I/O はあるが state-free (引数のみ)、Surface 経由で testable。
     */
    static planTimelineSegments(
        candidates: { date: string; top: number; height: number }[],
        scrollContainer: HTMLElement,
        ghostContainer: HTMLElement,
        sourceEl: HTMLElement,
    ): GhostPlan[] {
        const plans: GhostPlan[] = [];
        candidates.forEach((seg, index) => {
            const dayCol = scrollContainer.querySelector(
                `.timeline-scroll-area__day-column[data-date="${seg.date}"]`,
            ) as HTMLElement | null;
            if (!dayCol) return;
            // dayCol の border-top を考慮 (TimelineSection の row 1 padding と同期)
            const cs = window.getComputedStyle(dayCol);
            const borderTop = parseFloat(cs.borderTopWidth || '0');
            const splitClasses: string[] = [];
            if (candidates.length > 1) {
                if (index > 0) splitClasses.push('task-card--split-continues-before');
                if (index < candidates.length - 1) splitClasses.push('task-card--split-continues-after');
            }
            // left/width はソースカードの cascade レイアウト位置に合わせる
            // (sourceEl.offsetLeft/Width は is-drag-hidden 中でも layout 値を返す)
            plans.push({
                layout: 'absolute',
                parent: ghostContainer,
                left: dayCol.offsetLeft + sourceEl.offsetLeft,
                top: dayCol.offsetTop + borderTop + toDisplayTopPx(seg.top),
                width: sourceEl.offsetWidth,
                height: toDisplayHeightPx(seg.height),
                splitClasses,
            });
        });
        return plans;
    }

    private async finishMove(context: DragContext): Promise<void> {
        if (!this.lastDragResult || !this.dragTask || !this.baseTask) {
            this.ghostRenderer?.clear();
            this.cleanup();
            return;
        }

        // lastDragResult は **raw 表記** (clock day + clock time) で計算されている。
        // 例: visual day "2026-04-21" の 02:00 (startHour=5) ドロップ
        //   → totalStartMinutes=1560 → startDayOffset=1, normStart=120
        //   → lastDragResult = { startDate: "2026-04-22", startTime: "02:00" }
        // これをそのまま `effective*` edits として commitPlan に渡すと、
        // materializeRawDates 内部の unshiftVisual が再度 +1 day shift し、
        // raw startDate が 1 日先送りされる (00:00 跨ぎで 1 日ズレるバグ)。
        // toVisualDate で raw → visual に正規化することで round-trip を成立させる。
        const startHour = context.plugin.settings.startHour;
        const { startDate, startTime, endDate, endTime } = this.lastDragResult;
        const edits: DisplayDateEdits = {
            effectiveStartDate: DateUtils.toVisualDate(startDate, startTime, startHour),
            effectiveStartTime: startTime,
            effectiveEndDate: DateUtils.toVisualDate(endDate, endTime, startHour),
            effectiveEndTime: endTime,
        };
        const plan: DragPlan = { edits, baseTask: this.baseTask };
        await this.commitPlan(context, plan, this.dragTask.id);
        this.ghostRenderer?.clear();
        this.cleanup();
    }

    private checkAutoScroll(mouseY: number): void {
        if (!this.scrollContainer) return;
        const rect = this.scrollContainer.getBoundingClientRect();
        const scrollThreshold = 50;
        const scrollSpeed = 20;

        // sticky な allday-section に被らないよう、上限は allday の bottom にする
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
            this.processMove(this.lastClientX, this.lastClientY);

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

    private cleanupAndSelect(context: DragContext, taskId: string): void {
        this.ghostRenderer?.clear();
        context.onTaskClick(taskId);
        this.cleanup();
    }

    protected cleanup(): void {
        for (const el of this.hiddenElements) {
            el.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
        }
        this.ghostRenderer?.clear();
        this.ghostRenderer = null;
        this.ghostContainer = null;
        super.cleanup();
        this.hiddenElements = [];
        this.lastDragResult = null;
        this.currentDayDate = null;
        this.baseTask = null;
    }
}
