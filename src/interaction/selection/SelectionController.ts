import type { TaskWriteService } from '../../services/data/TaskWriteService';
import type { HandleManager } from '../../views/timelineview/HandleManager';

/**
 * View 横断の selection lifecycle を集約する controller。
 *
 * 責務:
 *   1. background-click でタスク以外をクリックしたときの selection 解除
 *   2. UI 経由のタスク削除に追従した selection クリア
 *   3. drag pointerup 直後にブラウザが合成する click を 1 回だけ握り潰す
 *      (drag が card の release target を変えてしまうため、放置すると
 *      background-click handler が selection を null にしてしまう)
 *
 * selection state 自体は HandleManager が引き続き持つ — 本 controller は
 * その薄いファサード兼イベント窓口に徹する。HandleManager の責務分離は
 * 後続 PR で別途対応する。
 */
export class SelectionController {
    constructor(private readonly handleManager: HandleManager) {}

    /**
     * container 上の click を監視し、タスクカード外への click で selection を解除する。
     * `.task-card__handle-btn` 上の click は drag handler が処理するためスキップする。
     */
    attachBackgroundClick(container: HTMLElement): void {
        container.addEventListener('click', this.onContainerClick);
    }

    /**
     * 選択中タスクが UI 経由で削除されたら selection をクリアする。
     * 戻り値は購読解除 callback (`view.unload` 等で呼ぶ)。
     */
    attachDeleteListener(writeService: TaskWriteService): () => void {
        return writeService.onTaskDeleted((deletedId) => {
            if (this.handleManager.getSelectedTaskId() === deletedId) {
                this.handleManager.selectTask(null);
            }
        });
    }

    /**
     * `DragHandler.onPointerUp` から `await onUp()` の前に同期的に呼び出す。
     * 直後にブラウザが発火する合成 click を capture phase で 1 回だけ握り潰すことで、
     * background-click handler に selection 解除されてしまうのを防ぐ。
     *
     * 合成 click が発火しない場合（drag せず handle を tap した等で
     * pointerdown.preventDefault が click を抑制したケース）は、`disarm` を
     * 明示的に呼ぶことで listener が次の本物 click に持ち越されるのを避ける。
     */
    armSyntheticClickKill(): void {
        document.addEventListener('click', this.killNextClick, { once: true, capture: true });
    }

    disarm(): void {
        document.removeEventListener('click', this.killNextClick, { capture: true });
    }

    private readonly onContainerClick = (e: MouseEvent): void => {
        const target = e.target as HTMLElement;
        if (target.closest('.task-card__handle-btn')) return;
        if (!target.closest('.task-card')) {
            if (this.handleManager.getSelectedTaskId()) {
                this.handleManager.selectTask(null);
            }
        }
    };

    private readonly killNextClick = (e: Event): void => {
        e.stopPropagation();
        e.preventDefault();
    };
}
