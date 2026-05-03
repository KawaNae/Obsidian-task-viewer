import { DragStrategy, DragContext } from '../DragStrategy';
import { Task } from '../../../types';
import { materializeRawDates, NO_TASK_LOOKUP, toDisplayTask } from '../../../services/display/DisplayTaskConverter';
import { getTaskDateRange } from '../../../services/display/VisualDateRange';
import type { DragPlan } from '../DragPlan';

/**
 * ドラッグストラテジーの基底クラス。
 * 共通の lifecycle / commit / utility を提供する。Ghost 描画は各 Gesture が
 * 自前で {@link GhostRenderer} を保持して行う (旧 updateSplitPreview /
 * previewGhosts は廃止)。
 */
export abstract class BaseDragStrategy implements DragStrategy {
    abstract name: string;

    // 共通プロパティ
    protected dragTask: Task | null = null;
    protected dragEl: HTMLElement | null = null;
    protected lastHighlighted: HTMLElement | null = null;
    protected hasMoved: boolean = false;
    protected currentContext: DragContext | null = null;

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
}
