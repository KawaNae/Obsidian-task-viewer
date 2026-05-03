import type { Task } from '../../types';
import type { TaskWriteService } from '../../services/data/TaskWriteService';
import type { DragContext, DragStrategy } from './DragStrategy';

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
     * 1. 合成 click を armSyntheticClickKill で 1 回だけ握り潰すよう仕掛ける
     *    （browser の合成 click は `await onUp` の yield 中に発火するため、
     *    arm は await の **前** に同期的に行う必要がある）
     * 2. Strategy の onUp を await（finish*Move/Resize 内部で commitPlan）
     * 3. notifyImmediate で onChange の coalesce/partial に乗せる
     * 4. draggingFile を 1 frame 遅延で解除（metadataCache.changed の遅延
     *    イベントで自分自身の書き戻しを除外するため）
     */
    async handleUp(e: PointerEvent): Promise<void> {
        if (!this.currentStrategy) return;
        const taskId = this.currentDragTaskId;

        this.context.selectionController.armSyntheticClickKill();

        await this.currentStrategy.onUp(e, this.context);

        this.writeService.notifyImmediate(
            taskId ?? undefined,
            taskId ? ['startDate', 'startTime', 'endDate', 'endTime'] : undefined,
        );

        requestAnimationFrame(() => {
            this.writeService.setDraggingFile(null);
        });

        this.currentStrategy = null;
        this.currentDragTaskId = null;
        this.container.style.touchAction = '';
    }
}
