import type { Task } from '../../types';
import type { TaskWriteService } from '../../services/data/TaskWriteService';
import type { DragContext, DragStrategy } from './DragStrategy';
import { logDebug } from '../../log/log';

/**
 * 1 回の drag (pointerdown → pointerup) の lifecycle を保持する。
 *
 * `DragRouter` が pointerdown を解析して `start()` で Strategy を起動、その後
 * `DragHandler` が pointermove / pointerup を `handleMove` / `handleUp` に
 * dispatch する。このクラス自体は listener を持たない（listener bind は
 * `DragHandler` の責務）。
 *
 * commit (writeService.updateTask) 自体は Strategy 内の `commitPlan` で完結
 * するため、Session の責務は「pointerup 直前の合成 click 抑制」「writeService
 * への drag-progress 通知（draggingFile / notifyImmediate）」「touchAction の
 * 一時 lock」だけ。
 */
export class DragSession {
    private currentStrategy: DragStrategy | null = null;
    private currentDragTaskId: string | null = null;
    /** True while handleUp is executing (async). Prevents lostpointercapture
     *  from cancelling a commit that is already in progress. */
    private committing = false;

    constructor(
        private readonly context: DragContext,
        private readonly container: HTMLElement,
        private readonly writeService: TaskWriteService,
    ) {}

    isActive(): boolean {
        return this.currentStrategy !== null;
    }

    /** pointerdown でルーティング後に呼ばれる。Strategy の `onDown` を起動。 */
    start(strategy: DragStrategy, e: PointerEvent, task: Task, taskEl: HTMLElement): void {
        logDebug(`[Drag:start] taskId=${task.id}`);
        this.currentStrategy = strategy;
        this.currentDragTaskId = task.id;
        this.writeService.setDraggingFile(task.file);
        strategy.onDown(e, task, taskEl, this.context);
        this.container.style.touchAction = 'none';
    }

    handleMove(e: PointerEvent): void {
        if (!this.currentStrategy) return;
        this.currentStrategy.onMove(e, this.context);
        this.context.onTaskMove(); // handle 位置の追従更新
    }

    /**
     * pointerup の lifecycle を完了させる。
     *
     * 1. Strategy の onUp を await（finish*Move/Resize 内部で commitPlan）
     * 2. notifyImmediate で onChange の coalesce/partial に乗せる
     * 3. draggingFile をその場で解除する（`end`。onUp が投げても通る）。解除すると、ドラッグ中に保留した
     *    ファイルの読み（確定の書き込みを含む）を入れて通知する
     *    （`TaskIndex.setDraggingFile`）。以前は 1 frame 遅らせて、確定の
     *    書き込みの遅れて来る `changed` を draggingFile で除いていた。今は
     *    `changed` がすでに読んだ内容かを内容で答える（`f8827b9a`）ので、
     *    フレームを待つ理由は無い。
     *
     * drag 完了時の合成 click による誤 deselect は SelectionController が
     * `pointerdown` で deselect するように設計されているため構造的に発生
     * しない（合成 click は pointerdown を発火しない）。旧 kill 機構は撤廃。
     */
    async handleUp(e: PointerEvent): Promise<void> {
        if (!this.currentStrategy) return;
        const taskId = this.currentDragTaskId;

        this.committing = true;
        try {
            await this.currentStrategy.onUp(e, this.context);
            logDebug(`[Drag:committed] taskId=${taskId}`);
            this.writeService.notifyImmediate(
                taskId ?? undefined,
                taskId ? ['startDate', 'startTime', 'endDate', 'endTime'] : undefined,
            );
        } finally {
            this.committing = false;
            this.end();
        }
    }

    /**
     * Abort the active gesture without committing the edit (pointercancel /
     * lost-capture, or the view closing: `DragHandler.destroy`). A commit
     * already in progress is left to end the session itself.
     */
    cancel(): void {
        logDebug(`[Drag:cancel] taskId=${this.currentDragTaskId}`);
        if (!this.currentStrategy) return;
        if (this.committing) return;
        try {
            this.currentStrategy.onCancel();
        } finally {
            this.end();
        }
    }

    /**
     * The one place a drag ends, however it ends (commit, abort, the view
     * closing, a throw): it lets go of the dragged file, so the readings held
     * while it was dragged go into the index. A file left held would keep every
     * reading of it out, and every write to it refused.
     */
    private end(): void {
        this.writeService.setDraggingFile(null);
        this.currentStrategy = null;
        this.currentDragTaskId = null;
        this.container.style.touchAction = '';
    }
}
