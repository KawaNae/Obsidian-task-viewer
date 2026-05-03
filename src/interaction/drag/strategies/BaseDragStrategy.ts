import { DragStrategy, DragContext } from '../DragStrategy';
import { Task } from '../../../types';
import { DateUtils } from '../../../utils/DateUtils';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../services/display/DisplayTaskConverter';
import { getTaskDateRange } from '../../../services/display/VisualDateRange';

export interface CalendarPointerTarget {
    weekRow: HTMLElement;
    weekStart: string;
    col: number;
    colWidth: number;
    targetDate: string;
}

/**
 * Drag-preview ghost 1 個分の配置プラン。view 別の plan*Segments() が計算し、
 * viewType 非依存の updateSplitPreview() が DOM に反映する 2-stage 設計。
 */
export interface GhostPlan {
    /** parent grid 要素 (.cal-week-row | .allday-section など) */
    parent: HTMLElement;
    /** "{col} / span {n}" 形式に解決済み */
    gridColumn: string;
    /** "{row}" 形式に解決済み */
    gridRow: string;
    /** "task-card--split-continues-{before,after}" の組合せ */
    splitClasses: string[];
}

/**
 * ドラッグストラテジーの基底クラス。
 * MoveStrategyとResizeStrategyで共通のプロパティとメソッドを提供。
 */
export abstract class BaseDragStrategy implements DragStrategy {
    abstract name: string;

    // 共通プロパティ
    protected dragTask: Task | null = null;
    protected dragEl: HTMLElement | null = null;
    protected lastHighlighted: HTMLElement | null = null;
    protected hasMoved: boolean = false;
    protected currentContext: DragContext | null = null;
    /** Drag 中の split-aware preview ghosts。calendar / allday 共通。 */
    protected previewGhosts: HTMLElement[] = [];

    // ビュータイプ（Timeline or AllDay）
    protected viewType: 'timeline' | 'allday' | 'calendar' = 'timeline';

    // Calendar resize 中のドラッグ方向。null は resize していない (Move/click 等は影響を受けない)。
    // セル境界判定 (resolveCalendarPointerTarget) のヒステリシスを resize 中だけ
    // 適用するためのスイッチ。
    protected activeResizeDirection: 'left' | 'right' | null = null;

    // 初期位置
    protected initialX: number = 0;
    protected initialY: number = 0;

    // 抽象メソッド
    abstract onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext): void;
    abstract onMove(e: PointerEvent, context: DragContext): void;
    abstract onUp(e: PointerEvent, context: DragContext): Promise<void>;

    /**
     * ハイライトをクリアする
     */
    protected clearHighlight(): void {
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('drag-over');
            this.lastHighlighted = null;
        }
    }

    /**
     * 選択状態を復元する
     */
    protected restoreSelection(context: DragContext, taskId: string): void {
        context.onTaskClick(taskId);
    }

    /**
     * ドラッグ状態をクリーンアップする
     */
    protected cleanup(): void {
        this.clearHighlight();
        document.body.style.cursor = '';

        if (this.dragEl) {
            this.dragEl.removeClass('is-dragging');
            this.dragEl.style.zIndex = '';
            this.dragEl.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
            this.dragEl.style.transform = '';
        }

        this.dragTask = null;
        this.dragEl = null;
        this.currentContext = null;
        this.hasMoved = false;
        this.activeResizeDirection = null;
        this.clearPreviewGhosts();
    }

    /**
     * ビュータイプを判定する（要素の親コンテナから）
     */
    protected determineViewType(el: HTMLElement): 'timeline' | 'allday' | 'calendar' {
        if (el.closest('.cal-week-row')) {
            return 'calendar';
        }
        if (el.closest('.timeline-scroll-area__day-column')) {
            return 'timeline';
        }
        if (el.closest('.allday-section')) {
            return 'allday';
        }
        return 'timeline'; // デフォルト
    }

    /**
     * 移動閾値チェック
     */
    protected checkMoveThreshold(deltaX: number, deltaY: number, threshold: number = 5): boolean {
        if (this.hasMoved) return true;
        if (Math.abs(deltaX) >= threshold || Math.abs(deltaY) >= threshold) {
            this.hasMoved = true;
            return true;
        }
        return false;
    }

    /**
     * Stage-1 (calendar): visible 範囲全体を week-row 単位に切り、各 segment に
     * 必要な split クラス・grid 座標を解決した GhostPlan[] を返す。
     */
    protected planCalendarSegments(context: DragContext, rangeStart: string, rangeEnd: string): GhostPlan[] {
        if (!this.dragEl) return [];
        const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
        const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
        const trackIndex = Number.parseInt(this.dragEl.dataset.trackIndex || '0', 10);
        const weekRows = this.getCalendarWeekRows(context);
        if (weekRows.length === 0) return [];

        const plans: GhostPlan[] = [];
        for (const weekRow of weekRows) {
            const weekStart = weekRow.dataset.weekStart;
            if (!weekStart) continue;
            const weekEnd = DateUtils.addDays(weekStart, 6);
            if (start > weekEnd || end < weekStart) continue;

            const segStart = start < weekStart ? weekStart : start;
            const segEnd = end > weekEnd ? weekEnd : end;
            const colStart = DateUtils.getDiffDays(weekStart, segStart) + 1;
            const span = DateUtils.getDiffDays(segStart, segEnd) + 1;
            if (colStart < 1 || span < 1) continue;

            const colOffset = this.getCalendarColumnOffset(weekRow);
            const splitClasses: string[] = [];
            if (start < weekStart) splitClasses.push('task-card--split-continues-before');
            if (end > weekEnd) splitClasses.push('task-card--split-continues-after');

            plans.push({
                parent: weekRow,
                gridColumn: `${colStart + colOffset} / span ${span}`,
                gridRow: `${trackIndex + 2}`,
                splitClasses,
            });
        }
        return plans;
    }

    /**
     * Stage-1 (allday): timeline view の `.allday-section` に対し、view 端で clip
     * した 1 segment の GhostPlan を返す。view 完全外なら []。
     *
     * grid 座標は dates[0] からの 0-based offset に axis col(+1) と grid 1-based
     * 補正(+1)を加えた 2-based。`AllDaySectionRenderer.renderTaskCard` が
     * `gridColumn = colStart + 1 / span N` で配置するのと同じ計算 (gridColOffset=1)。
     */
    protected planAllDaySegments(context: DragContext, rangeStart: string, rangeEnd: string): GhostPlan[] {
        if (!this.dragEl) return [];
        const alldaySection = context.container.querySelector('.allday-section') as HTMLElement | null;
        if (!alldaySection) return [];

        const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
        const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
        const viewStart = context.getViewStartDate();
        const viewEnd = context.getViewEndDate();
        if (!viewStart || !viewEnd) return [];
        if (end < viewStart || start > viewEnd) return [];

        const clippedStart = start < viewStart ? viewStart : start;
        const clippedEnd = end > viewEnd ? viewEnd : end;
        const colStartIdx = DateUtils.getDiffDays(viewStart, clippedStart);
        const span = DateUtils.getDiffDays(clippedStart, clippedEnd) + 1;
        if (span < 1) return [];

        const trackIndex = Number.parseInt(this.dragEl.dataset.trackIndex || '0', 10);
        const splitClasses: string[] = [];
        if (start < viewStart) splitClasses.push('task-card--split-continues-before');
        if (end > viewEnd) splitClasses.push('task-card--split-continues-after');

        return [{
            parent: alldaySection,
            // axis col(+1) + grid 1-based(+1) = +2
            gridColumn: `${colStartIdx + 2} / span ${span}`,
            // row 1 が padding なので +2
            gridRow: `${trackIndex + 2}`,
            splitClasses,
        }];
    }

    /**
     * Stage-2 (viewType 非依存): GhostPlan[] を DOM に反映。既存 ghost を再利用
     * する diff-update で remove→append による reflow を最小化する。
     */
    protected updateSplitPreview(plans: GhostPlan[]): void {
        if (!this.dragEl) return;
        const oldCount = this.previewGhosts.length;
        const newCount = plans.length;

        for (let i = 0; i < Math.min(oldCount, newCount); i++) {
            const ghost = this.previewGhosts[i];
            const plan = plans[i];
            if (ghost.parentElement !== plan.parent) {
                plan.parent.appendChild(ghost);
            }
            ghost.style.gridColumn = plan.gridColumn;
            ghost.style.gridRow = plan.gridRow;
            ghost.removeClass('task-card--split-continues-before', 'task-card--split-continues-after');
            for (const cls of plan.splitClasses) ghost.addClass(cls);
        }

        for (let i = newCount; i < oldCount; i++) {
            this.previewGhosts[i].remove();
        }

        for (let i = oldCount; i < newCount; i++) {
            const plan = plans[i];
            const preview = this.createPreviewGhost(plan);
            plan.parent.appendChild(preview);
            this.previewGhosts.push(preview);
        }

        this.previewGhosts.length = newCount;
    }

    /**
     * dragEl から preview ghost を派生させる。grid 座標と split クラスは plan に
     * 従う。host 直下の handle は除去 (ghost は pointer 不可なので)。
     */
    private createPreviewGhost(plan: GhostPlan): HTMLElement {
        const preview = this.dragEl!.cloneNode(true) as HTMLElement;
        preview.querySelectorAll('.task-card__handle').forEach(h => h.remove());
        preview.removeClass('is-selected', 'is-dragging');
        preview.removeClass('task-card--split-continues-before', 'task-card--split-continues-after');
        preview.addClass('task-card--drag-preview');
        preview.style.gridColumn = plan.gridColumn;
        preview.style.gridRow = plan.gridRow;
        preview.style.transform = '';
        preview.classList.remove('is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint');
        preview.style.zIndex = '1001';
        preview.style.pointerEvents = 'none';
        for (const cls of plan.splitClasses) preview.addClass(cls);
        return preview;
    }

    /**
     * Compute inclusive visual date range for a task, matching the renderer's logic.
     */
    protected getVisualDateRange(task: Task, startHour: number): { start: string; end: string } {
        // Date range only depends on the task's own dates; childEntries are irrelevant.
        const dt = toDisplayTask(task, startHour, NO_TASK_LOOKUP);
        const range = getTaskDateRange(dt, startHour);
        const start = range.effectiveStart || task.startDate || '';
        const end = range.effectiveEnd || start;
        return { start, end };
    }

    protected clearPreviewGhosts(): void {
        for (const ghost of this.previewGhosts) {
            ghost.remove();
        }
        this.previewGhosts = [];
    }

    protected getCalendarWeekRows(context: DragContext): HTMLElement[] {
        return Array.from(context.container.querySelectorAll('.cal-week-row'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement);
    }

    protected getCalendarColumnOffset(weekRow: HTMLElement): number {
        return weekRow.classList.contains('has-week-numbers') ? 1 : 0;
    }

    protected toCalendarDayColumn(displayColumn: number, weekRow: HTMLElement): number {
        const dayColumn = displayColumn - this.getCalendarColumnOffset(weekRow);
        return Math.min(7, Math.max(1, dayColumn));
    }

    protected toCalendarDisplayColumn(dayColumn: number, weekRow: HTMLElement): number {
        return dayColumn + this.getCalendarColumnOffset(weekRow);
    }

    protected getCalendarDayHeaders(weekRow: HTMLElement): HTMLElement[] {
        return Array.from(weekRow.querySelectorAll('.cal-day-cell'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement);
    }

    protected getCalendarDayColumnWidth(weekRow: HTMLElement): number {
        const dayHeaders = this.getCalendarDayHeaders(weekRow);
        for (const dayHeader of dayHeaders) {
            const rect = dayHeader.getBoundingClientRect();
            if (rect.width > 0) {
                return rect.width;
            }
        }

        const weekRect = weekRow.getBoundingClientRect();
        if (weekRect.width > 0) {
            let dayAreaWidth = weekRect.width;
            if (this.getCalendarColumnOffset(weekRow) > 0) {
                const weekNumberEl = weekRow.querySelector('.cal-week-number');
                if (weekNumberEl instanceof HTMLElement) {
                    const weekNumberRect = weekNumberEl.getBoundingClientRect();
                    dayAreaWidth = Math.max(0, weekRect.right - weekNumberRect.right);
                }
            }
            if (dayAreaWidth > 0) {
                return dayAreaWidth / 7;
            }
        }

        return this.getCalendarFallbackColWidth();
    }

    protected findNearestCalendarWeekRow(clientY: number, context: DragContext): HTMLElement | null {
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

    protected resolveCalendarPointerTarget(clientX: number, clientY: number, context: DragContext): CalendarPointerTarget | null {
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

        let weekRow = elBelow?.closest('.cal-week-row') as HTMLElement | null;
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
        const dayHeaders = this.getCalendarDayHeaders(weekRow);
        let colWidth = this.getCalendarDayColumnWidth(weekRow);
        let col = 1;

        if (dayHeaders.length === 7) {
            const dayRects = dayHeaders.map((header) => header.getBoundingClientRect());
            const firstRect = dayRects[0];
            const lastRect = dayRects[dayRects.length - 1];

            // 右ハンドルは CSS で card.right から +12px 外側に置かれる (-12px right offset)。
            // ハンドル中心は次セルの左端付近にあるため、ハンドルを掴んだだけで
            // findIndex が次セルを返してしまい +1 day ドリフトを生む。
            // resize 中だけヒステリシスを入れ、セル端の HYSTERESIS_PX 内は前セル扱いにする。
            const HANDLE_HYSTERESIS_PX = 8;
            let containsIndex = -1;
            if (this.activeResizeDirection === 'right') {
                containsIndex = dayRects.findIndex((rect) =>
                    clientX >= rect.left && clientX <= rect.right - HANDLE_HYSTERESIS_PX);
                if (containsIndex < 0) {
                    containsIndex = dayRects.findIndex((rect) =>
                        clientX >= rect.left && clientX <= rect.right);
                }
            } else if (this.activeResizeDirection === 'left') {
                containsIndex = dayRects.findIndex((rect) =>
                    clientX >= rect.left + HANDLE_HYSTERESIS_PX && clientX <= rect.right);
                if (containsIndex < 0) {
                    containsIndex = dayRects.findIndex((rect) =>
                        clientX >= rect.left && clientX <= rect.right);
                }
            } else {
                containsIndex = dayRects.findIndex((rect) =>
                    clientX >= rect.left && clientX <= rect.right);
            }
            if (containsIndex >= 0) {
                col = containsIndex + 1;
            } else if (clientX < firstRect.left) {
                col = 1;
            } else if (clientX > lastRect.right) {
                col = 7;
            } else {
                let nearestIndex = 0;
                let nearestDistance = Number.POSITIVE_INFINITY;
                dayRects.forEach((rect, index) => {
                    const center = (rect.left + rect.right) / 2;
                    const distance = Math.abs(clientX - center);
                    if (distance < nearestDistance) {
                        nearestDistance = distance;
                        nearestIndex = index;
                    }
                });
                col = nearestIndex + 1;
            }

            if (dayRects[0].width > 0) {
                colWidth = dayRects[0].width;
            }
        } else {
            const weekRect = weekRow.getBoundingClientRect();
            let dayAreaLeft = weekRect.left;
            let dayAreaWidth = weekRect.width;

            if (this.getCalendarColumnOffset(weekRow) > 0) {
                const weekNumberEl = weekRow.querySelector('.cal-week-number');
                if (weekNumberEl instanceof HTMLElement) {
                    const weekNumberRect = weekNumberEl.getBoundingClientRect();
                    dayAreaLeft = weekNumberRect.right;
                    dayAreaWidth = Math.max(0, weekRect.right - weekNumberRect.right);
                }
            }

            colWidth = dayAreaWidth > 0 ? dayAreaWidth / 7 : this.getCalendarFallbackColWidth();
            const rawCol = Math.floor((clientX - dayAreaLeft) / colWidth) + 1;
            col = Math.min(7, Math.max(1, rawCol));
        }

        const targetDate = DateUtils.addDays(weekStart, col - 1);

        return {
            weekRow,
            weekStart,
            col,
            colWidth,
            targetDate,
        };
    }

    protected getCalendarFallbackColWidth(): number {
        const maybeColWidth = (this as { colWidth?: unknown }).colWidth;
        if (typeof maybeColWidth === 'number' && Number.isFinite(maybeColWidth) && maybeColWidth > 0) {
            return maybeColWidth;
        }
        return 100;
    }
}
