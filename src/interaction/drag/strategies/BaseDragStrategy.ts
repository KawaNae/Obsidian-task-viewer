import { DragStrategy, DragContext } from '../DragStrategy';
import { Task } from '../../../types';
import { materializeRawDates, NO_TASK_LOOKUP, toDisplayTask } from '../../../services/display/DisplayTaskConverter';
import { getTaskDateRange } from '../../../services/display/VisualDateRange';
import type { DragPlan } from '../DragPlan';

/**
 * Drag-preview ghost 1 個分の配置プラン。Surface 別の planSegments() が計算し、
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

    // ビュータイプ（Timeline or AllDay or Calendar）
    protected viewType: 'timeline' | 'allday' | 'calendar' = 'timeline';

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
     * 1 回の drag 完了で生じる write-back を 1 経路に集約。
     *
     * - `plan === null` → 変更なし、early return
     * - そうでなければ visual edits を `materializeRawDates` で raw に変換し、
     *   baseTask との diff だけを `updateTask` に渡す
     * - 書き戻しの後に selection を復元する（segment id が drag で再生成
     *   されるため、再 render 後にも同じ task が selected であるよう保証）
     *
     * 各 finish は visual edits の組み立てに専念し、raw `Partial<Task>` を
     * 直接作らない。これにより endDate inclusive/exclusive の dual semantic を
     * 1 箇所（materializeRawDates）に閉じ込める。
     */
    protected async commitPlan(context: DragContext, plan: DragPlan | null, taskId: string): Promise<void> {
        if (!plan) return;
        const { edits, baseTask } = plan;
        const startHour = context.plugin.settings.startHour;
        const updates = this.diffUpdates(materializeRawDates(edits, baseTask, startHour), baseTask);
        if (Object.keys(updates).length === 0) return;
        await context.writeService.updateTask(taskId, updates);
        this.restoreSelection(context, taskId);
    }

    /**
     * baseTask と既に同じ値のキーを除外する。drag 完了時に「掴んだだけで
     * 値は変わっていない」フィールドを送らないための薄いヘルパー。
     */
    private diffUpdates(updates: Partial<Task>, baseTask: Task): Partial<Task> {
        const result: Partial<Task> = {};
        const u = updates as unknown as Record<string, unknown>;
        const b = baseTask as unknown as Record<string, unknown>;
        for (const key of Object.keys(u)) {
            if (u[key] !== b[key]) {
                (result as unknown as Record<string, unknown>)[key] = u[key];
            }
        }
        return result;
    }

    /**
     * ドラッグ状態をクリーンアップする
     */
    protected cleanup(): void {
        this.clearHighlight();
        document.body.style.cursor = '';

        // hasMoved=true: synthetic click fires and SelectionController's
        // once-listener consumes itself — disarm is a no-op.
        // hasMoved=false: synthetic click was suppressed because
        // `onPointerDown` called `preventDefault()` (blocks compat mouse
        // events). Disarm so the listener doesn't trap the next real click.
        if (!this.hasMoved) {
            this.currentContext?.selectionController.disarm();
        }

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
     * Stage-2 (viewType 非依存): GhostPlan[] を DOM に反映。既存 ghost を再利用
     * する diff-update で remove→append による reflow を最小化する。
     * Stage-1 (plan) は GridSurface 実装側 (CalendarGridSurface / AllDayGridSurface) が担当。
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

}
