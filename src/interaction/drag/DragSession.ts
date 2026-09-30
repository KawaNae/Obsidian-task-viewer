import type { Task } from '../../types';
import type { Operations } from '../../services/operations/Operations';
import type { IndexReads } from '../../services/core/TaskIndex';
import type { DragContext, DragStrategy } from './DragStrategy';
import { logDebug, logError } from '../../log/log';

/**
 * 1 回の drag (pointerdown → pointerup) の lifecycle を保持する。
 *
 * `DragRouter` が pointerdown を解析して `start()` で Strategy を起動、その後
 * `DragHandler` が pointermove / pointerup を `handleMove` / `handleUp` に
 * dispatch する。このクラス自体は listener を持たない（listener bind は
 * `DragHandler` の責務）。
 *
 * commit (operations.updateTask) 自体は Strategy 内の `commitPlan` で完結
 * するため、Session の責務は「掴んだ行がディスクのとおりかを問う
 * （operations.confirmTask）」「索引へのドラッグの保留と、終わりの描画
 * （index.setDraggingFile / notifyImmediate。書き込みでないので操作を通さない）」
 * 「touchAction の一時 lock」だけ。
 */
export class DragSession {
    private currentStrategy: DragStrategy | null = null;
    private currentDragTaskId: string | null = null;
    /** True while handleUp is executing (async). Prevents lostpointercapture
     *  from cancelling a commit that is already in progress. The window opens
     *  when the pointer is let go, before the check has answered (`confirmed`):
     *  a cancel in that moment — the view closing included — is left to
     *  handleUp, which ends the drag as cancelled on a no, or commits on a yes. */
    private committing = false;
    /**
     * Whether the dragged task is the row on the disk (`confirmTask`), asked
     * as the drag starts: the drag commits only on a yes. Never rejects: a
     * check that threw answers no.
     */
    private confirmed: Promise<boolean> | null = null;

    constructor(
        private readonly context: DragContext,
        private readonly container: HTMLElement,
        private readonly operations: Pick<Operations, 'confirmTask'>,
        private readonly index: Pick<IndexReads, 'setDraggingFile' | 'notifyImmediate'>,
    ) {}

    isActive(): boolean {
        return this.currentStrategy !== null;
    }

    /**
     * pointerdown でルーティング後に呼ばれる。Strategy の `onDown` を起動。
     *
     * ドラッグする行がディスクの内容のとおりかを、ここで1回問う
     * （`confirmTask`）。pointerdown は同期で既定の動作を止めるので、答えを
     * 待たずに始める。答えがドラッグ中に否で来たら、ドラッグを取り消す
     * （索引はノートを読み直し、利用者には通知が1回出ている）。確定を始めた
     * 後に来た答えは `handleUp` が受ける。
     */
    start(strategy: DragStrategy, e: PointerEvent, task: Task, taskEl: HTMLElement): void {
        logDebug(`[Drag:start] taskId=${task.id}`);
        this.currentStrategy = strategy;
        this.currentDragTaskId = task.id;
        void this.index.setDraggingFile(task.file);
        const confirmed = this.operations.confirmTask(task.id).catch((error: unknown) => {
            logError(`[Drag:confirm] taskId=${task.id} failed: ${(error as Error)?.message ?? error}`);
            return false;
        });
        this.confirmed = confirmed;
        void confirmed.then(fresh => {
            // This drag's answer, not a later one's: `end` lets go of it.
            if (!fresh && this.confirmed === confirmed) this.cancel();
        });
        strategy.onDown(e, task, taskEl, this.context);
        this.container.style.touchAction = 'none';
    }

    handleMove(e: PointerEvent): void {
        if (!this.currentStrategy) return;
        this.currentStrategy.onMove(e, this.context);
    }

    /**
     * pointerup の lifecycle を完了させる。
     *
     * 1. Strategy の onUp を await（finish*Move/Resize 内部で commitPlan）
     * 2. draggingFile を解除する（`end`。onUp が投げても通る）。解除すると、
     *    ドラッグ中に保留したファイルの読み（確定の書き込みを含む）が索引に
     *    入る（`TaskIndex.setDraggingFile`）
     * 3. 確定したなら、その読みが入るのを待って全体を即時に描く。書き込みは
     *    索引の写しを書き換えないので、読みが入る前に描くと元の位置へ一瞬
     *    戻る。区間でなく全体を描くのは、確定のあとの行の名前が新しい読みの
     *    名前で、ドラッグを始めたときの名前ではもう引けないから
     *
     * drag 完了時の合成 click による誤 deselect は SelectionController が
     * `pointerdown` で deselect するように設計されているため構造的に発生
     * しない（合成 click は pointerdown を発火しない）。旧 kill 機構は撤廃。
     */
    async handleUp(e: PointerEvent): Promise<void> {
        const strategy = this.currentStrategy;
        if (!strategy) return;
        const taskId = this.currentDragTaskId;

        this.committing = true;
        let released: Promise<void>;
        try {
            // A short drag can let go before the check has answered: the
            // commit waits for it, and a drag of a stale row ends as if
            // cancelled.
            if (!(await this.confirmed)) {
                strategy.onCancel();
                return;
            }
            await strategy.onUp(e, this.context);
            logDebug(`[Drag:committed] taskId=${taskId}`);
        } finally {
            this.committing = false;
            released = this.end();
        }
        await released;
        this.index.notifyImmediate();
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
            void this.end();
        }
    }

    /**
     * The one place a drag ends, however it ends (commit, abort, the view
     * closing, a throw): it lets go of the dragged file, so the readings held
     * while it was dragged go into the index. A file left held would keep every
     * reading of it out, and every write to it refused.
     */
    private end(): Promise<void> {
        const released = this.index.setDraggingFile(null);
        this.currentStrategy = null;
        this.currentDragTaskId = null;
        this.confirmed = null;
        this.container.style.touchAction = '';
        return released;
    }
}
