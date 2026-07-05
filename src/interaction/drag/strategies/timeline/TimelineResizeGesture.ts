import { BaseDragStrategy } from '../BaseDragStrategy';
import type { DragContext } from '../../DragStrategy';
import type { Task } from '../../../../types';
import { DateUtils } from '../../../../utils/DateUtils';
import { DisplayDateEdits, getOriginalTaskId, toDisplayTask } from '../../../../services/display/DisplayTaskConverter';
import type { DragPlan } from '../../DragPlan';

/**
 * Timeline (timed タスク) の Resize Gesture。resize 方向は top / bottom のみ。
 *
 * Ownership 契約: drag 中の visual feedback は `--start-minutes` /
 * `--duration-minutes` CSS 変数を上書きすることで行う。これは
 * {@link TimelineSectionRenderer.decorateLane} が毎 render 上書きする
 * **同じキー** であり、commit 後の re-render で必ず authoritative な値で
 * リセットされる（自己修復）。inline `top` / `height` (px) には書かない
 * — CSS calc が override されて stale 化する温床になる。
 */
export class TimelineResizeGesture extends BaseDragStrategy {
    name = 'TimelineResize';

    private resizeDirection: 'top' | 'bottom' = 'bottom';
    private currentDayDate: string | null = null;
    /** logical px (= minutes * zoomLevel) で保持。computeResizeDeltas が同単位で動く。 */
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

        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(clientX, clientY);
        const dayCol = elBelow?.closest('.timeline-scroll-area__day-column') as HTMLElement;
        if (!dayCol) return;

        const rect = dayCol.getBoundingClientRect();
        const yInContainer = clientY - rect.top;
        // 分単位で 15 分 snap。旧実装の px snap (Math.round(y/(15*zoom))*(15*zoom)) と
        // 数学的に等価だが、CSS 変数所有モデルに合わせて分基準で表現。
        const rawMinutes = yInContainer / zoomLevel;
        const snappedMinutes = Math.round(rawMinutes / 15) * 15;
        const snappedLogicalY = snappedMinutes * zoomLevel;

        const { logicalTop, logicalHeight } = TimelineResizeGesture.computeResizeDeltas(
            snappedLogicalY,
            this.initialTop,
            this.initialBottom,
            this.resizeDirection,
            zoomLevel,
        );

        // renderer が所有する CSS 変数に書く。CSS calc が px 換算するので、
        // inline top/height を書く必要はない (= stale 化の温床を作らない)。
        this.dragEl.style.setProperty('--start-minutes', String(logicalTop / zoomLevel));
        this.dragEl.style.setProperty('--duration-minutes', String(logicalHeight / zoomLevel));
    }

    /**
     * pure helper: snapped logical Y と initial state から resize 帰結値を計算。
     *  - direction='bottom': top 固定で height 伸縮
     *  - direction='top'   : bottom 固定で top と height 連動
     *  - 最小高 15 分 (= 15 * zoomLevel px)
     */
    static computeResizeDeltas(
        snappedLogicalY: number,
        initialTop: number,
        initialBottom: number,
        direction: 'top' | 'bottom',
        zoomLevel: number,
    ): { logicalTop: number; logicalHeight: number } {
        const minHeight = 15 * zoomLevel;
        if (direction === 'bottom') {
            const newHeight = Math.max(minHeight, snappedLogicalY - initialTop);
            return { logicalTop: initialTop, logicalHeight: newHeight };
        }
        const clampedHeight = Math.max(minHeight, initialBottom - snappedLogicalY);
        const newTop = initialBottom - clampedHeight;
        return { logicalTop: newTop, logicalHeight: clampedHeight };
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

        const startHour = context.plugin.settings.startHour;
        const displayTask = toDisplayTask(originalTask, startHour, (id) => context.readService.getTask(id));
        const startHourMinutes = startHour * 60;

        // 現状は CSS 変数が single source of truth。processResize が更新した
        // 最新値 (or 早期 return が連続した場合は onDown 時の初期値) を読む。
        const startMinutes = Number.parseFloat(this.dragEl.style.getPropertyValue('--start-minutes') || '0');
        const durationMinutes = Number.parseFloat(this.dragEl.style.getPropertyValue('--duration-minutes') || '0');

        const totalStartMin = startHourMinutes + startMinutes;
        const totalEndMin = totalStartMin + durationMinutes;
        const roundedStart = Math.round(totalStartMin);
        const roundedEnd = Math.round(totalEndMin);
        const startDayOffset = Math.floor(roundedStart / 1440);
        const endDayOffset = Math.floor(roundedEnd / 1440);
        const normStart = ((roundedStart % 1440) + 1440) % 1440;
        const normEnd = ((roundedEnd % 1440) + 1440) % 1440;

        // newStart/End は raw 表記 (currentDayDate + offset、normalize 0-1439)。
        // 注: displayTask.effective* も実は raw 表記 (toDisplayTask は implicit
        // 補完だけして visual 変換しない — visual range は getTaskDateRange が
        // toVisualDate で別計算する)。つまりこのメソッドは raw 値しか持たない。
        //
        // commitPlan は edits を visual と前提するため、materializeRawDates の
        // unshiftVisual が time<startHour で +1 day 適用する。raw を渡すと
        // 二重 shift になるので、すべて toVisualDate で visual に正規化してから
        // 渡し、round-trip で raw に戻す。
        const newStartDate = DateUtils.addDays(this.currentDayDate, startDayOffset);
        const newStartTime = DateUtils.minutesToTime(normStart);
        const newEndDate = DateUtils.addDays(this.currentDayDate, endDayOffset);
        const newEndTime = DateUtils.minutesToTime(normEnd);

        const rawToVisual = (date: string | undefined, time: string | undefined): string | undefined =>
            date ? DateUtils.toVisualDate(date, time, startHour) : undefined;

        const edits: DisplayDateEdits = this.resizeDirection === 'top'
            ? {
                effectiveStartDate: DateUtils.toVisualDate(newStartDate, newStartTime, startHour),
                effectiveStartTime: newStartTime,
                effectiveEndDate: rawToVisual(displayTask.effectiveEndDate, displayTask.effectiveEndTime),
                effectiveEndTime: displayTask.effectiveEndTime,
            }
            : {
                effectiveStartDate: rawToVisual(displayTask.effectiveStartDate, displayTask.effectiveStartTime),
                effectiveStartTime: displayTask.effectiveStartTime,
                effectiveEndDate: DateUtils.toVisualDate(newEndDate, newEndTime, startHour),
                effectiveEndTime: newEndTime,
            };

        const plan: DragPlan = { edits, baseTask: originalTask };
        await this.commitPlan(context, plan, this.dragTask.id);
        this.cleanup();
    }

    protected cleanup(): void {
        super.cleanup();
        this.currentDayDate = null;
    }
}
