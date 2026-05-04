import type { TaskWriteService } from '../../services/data/TaskWriteService';
import type { HandleManager } from '../../views/timelineview/HandleManager';

/**
 * View 横断の selection lifecycle を集約する controller。
 *
 * 責務:
 *   1. background-tap でタスク以外をタッチしたときの selection 解除
 *   2. UI 経由のタスク削除に追従した selection クリア
 *
 * selection state 自体は HandleManager が引き続き持つ — 本 controller は
 * その薄いファサード兼イベント窓口に徹する。HandleManager の責務分離は
 * 後続 PR で別途対応する。
 */
export class SelectionController {
    constructor(private readonly handleManager: HandleManager) {}

    /**
     * container 上の `pointerdown` を監視し、タスクカード外への入力で selection
     * を解除する。`.task-card__handle-btn` 上の入力は drag handler が処理する
     * のでスキップ。
     *
     * `click` event ではなく `pointerdown` を聞く理由:
     *   1. drag 完了時にブラウザが発火する合成 click は **発火する保証が無い**。
     *      drag 開始時の pointerdown.preventDefault によって iOS WebKit など
     *      では合成 click が抑制される。click ベースだと合成 click 抑制を
     *      検知できず、別途 kill 機構（旧 armSyntheticClickKill）が必要に
     *      なるが leak リスクを抱える。
     *   2. iOS Safari は cursor:pointer を持たない要素への 1 回目の tap で
     *      click を発火させない仕様がある（hover/focus simulation として
     *      消費される）。pointerdown は touch から直接発火するのでこの
     *      影響を受けない。
     *   3. drag 後の合成 click は **pointerdown を発火しない**（合成
     *      mouseevent のみ）。よって drag 完了の release target が背景でも
     *      synthetic click による誤 deselect は構造的に発生しない。
     */
    attachBackgroundClick(container: HTMLElement): void {
        container.addEventListener('pointerdown', this.onContainerClick);
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

    private readonly onContainerClick = (e: PointerEvent): void => {
        const target = e.target as HTMLElement;
        if (target.closest('.task-card__handle-btn')) return;
        if (!target.closest('.task-card')) {
            if (this.handleManager.getSelectedTaskId()) {
                this.handleManager.selectTask(null);
            }
        }
    };
}
