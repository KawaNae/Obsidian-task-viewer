import type { DragContext, DragStrategy } from './DragStrategy';
import type { DragSession } from './DragSession';
import { MoveStrategy } from './strategies/MoveStrategy';
import { ResizeStrategy } from './strategies/ResizeStrategy';

/**
 * pointerdown を受けて、その対象 (handle / card / 背景) を解析し、適切な
 * Strategy を生成して DragSession を起動する責務。
 *
 * Strategy 生成の判断（move か resize か）と、taskEl / taskId の解決、detail
 * handle の特別扱い、handle 以外の card click の selection 動作までをここに
 * 集約する。listener bind や lifecycle 管理は持たない（それらは DragHandler /
 * DragSession の責務）。
 */
export class DragRouter {
    /** detail handle がタップされたとき呼ばれる。modal を開くなど。 */
    public onDetailClick: ((taskId: string) => void) | null = null;

    constructor(
        private readonly context: DragContext,
        private readonly session: DragSession,
        private readonly container: HTMLElement,
    ) {}

    /**
     * pointerdown のメインルーティング。
     *
     * 帰結は次のいずれか:
     *   - pinned-list 内 / 解決不能 → 何もしない (early return)
     *   - detail handle → onDetailClick(taskId) （drag に進まない）
     *   - card 本体 (handle 以外) → context.onTaskClick(taskId) で selection
     *   - resize/move handle → DragSession.start で Strategy 起動
     */
    handle(e: PointerEvent): void {
        const target = e.target as HTMLElement;

        // pinnedLists 内のカードクリックは selection/drag の対象外。
        // pinnedLists は selection 状態を持たない閲覧専用 UI であり、
        // ここで早期 return しないと main grid の同 id カードに .is-selected が漏れる。
        if (target.closest('.tv-sidebar__pinned-lists')) return;

        const handle = target.closest('.task-card__handle-btn') as HTMLElement | null;
        let taskEl: HTMLElement | null = null;
        let taskId: string | null = null;
        let isFromHandle = false;

        if (handle) {
            isFromHandle = true;
            taskId = handle.dataset.taskId || null;
            if (taskId) {
                taskEl = handle.closest('.task-card') as HTMLElement;
                if (!taskEl) {
                    taskEl = this.container.querySelector(`.task-card[data-id="${taskId}"]`) as HTMLElement;
                }
                if (taskEl && taskEl.dataset.splitOriginalId) {
                    taskId = taskEl.dataset.splitOriginalId;
                }
            }

            // detail-handle: open detail modal, no drag.
            if (taskId && target.closest('.task-card__handle--detail')) {
                e.preventDefault();
                e.stopPropagation();
                this.onDetailClick?.(taskId);
                return;
            }
        } else {
            taskEl = target.closest('.task-card') as HTMLElement;
            if (taskEl) {
                taskId = taskEl.dataset.splitOriginalId || taskEl.dataset.id || null;
            }
        }

        if (!taskEl || !taskId) return;

        const task = this.context.readService.getTask(taskId);
        if (!task) return;
        if (task.isReadOnly && isFromHandle) return;

        // Non-handle click: select the card. Detail modal is opened via
        // double-click (TaskCardRenderer) or detail-handle, never single click.
        if (!isFromHandle) {
            this.context.onTaskClick(taskId);
            return;
        }

        const strategy = this.pickStrategy(target);
        this.session.start(strategy, e, task, taskEl);
        e.preventDefault();
    }

    /**
     * クリックされた要素から resize / move を判別する。pickStrategy は target
     * のクラス情報のみを見るため、Surface（Calendar/AllDay/Timeline）に依存
     * しない。Surface 別の振る舞いは Strategy 内部で view を読んで分岐する。
     */
    private pickStrategy(target: HTMLElement): DragStrategy {
        const isResize =
            target.closest('.task-card__handle--resize-top') ||
            target.closest('.task-card__handle--resize-bottom') ||
            target.closest('.task-card__handle--resize-left') ||
            target.closest('.task-card__handle--resize-right');
        return isResize ? new ResizeStrategy() : new MoveStrategy();
    }
}
