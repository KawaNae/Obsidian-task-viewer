import type { DragContext, DragStrategy } from './DragStrategy';
import type { DragSession } from './DragSession';
import { heldBy } from '../../views/taskcard/CardHold';
import { TimelineMoveGesture } from './strategies/timeline/TimelineMoveGesture';
import { TimelineResizeGesture } from './strategies/timeline/TimelineResizeGesture';
import { GridMoveGesture } from './strategies/grid/GridMoveGesture';
import { GridResizeGesture } from './strategies/grid/GridResizeGesture';

/**
 * pointerdown を受けて、その対象 (handle / card / 背景) を解析し、適切な
 * Strategy を生成して DragSession を起動する責務。
 *
 * Strategy 生成の判断（move か resize か）と、taskEl / taskId の解決、
 * handle 以外の card click の selection 動作までをここに集約する。
 * listener bind や lifecycle 管理は持たない（それらは DragHandler /
 * DragSession の責務）。
 */
export class DragRouter {
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
        const isFromHandle = handle !== null;

        // The task is the one the card was last drawn from, read now from its
        // hold: a card (with the handles in it) is kept across readings that
        // rename the task (`CardHold`).
        const taskEl = target.closest('.task-card') as HTMLElement | null;
        const taskId = taskEl ? (heldBy(taskEl)?.name ?? null) : null;

        if (!taskEl || !taskId) return;

        const task = this.context.readService.getTask(taskId);
        if (!task) return;
        if (task.isReadOnly && isFromHandle) return;

        // Non-handle click: select the card. Detail modal is opened via
        // double-click (TaskCardRenderer), never single click.
        if (!isFromHandle) {
            this.context.onTaskClick(taskId);
            return;
        }

        const gesture = this.pickGesture(target, taskEl);
        this.session.start(gesture, e, task, taskEl);
        e.preventDefault();
    }

    /**
     * `(mode, surface)` の二軸で 4 種類の Gesture から選択。
     *   - mode    : target に resize handle modifier があるかどうか (move / resize)
     *   - surface : taskEl が timeline 列に属するかどうか (timeline / grid)
     *
     * Calendar と AllDay は同じ Grid surface 上で動くので 1 つの Gesture に集約
     * (Surface 注入で方言を吸収)。Timeline は時間軸という根本的に別の座標系を
     * 持つので Gesture 自体を分けている。
     */
    private pickGesture(target: HTMLElement, taskEl: HTMLElement): DragStrategy {
        const isResize =
            target.closest('.task-card__handle--resize-top') ||
            target.closest('.task-card__handle--resize-bottom') ||
            target.closest('.task-card__handle--resize-left') ||
            target.closest('.task-card__handle--resize-right');
        const isTimeline = !!taskEl.closest('.timeline-scroll-area__day-column');

        if (isResize) {
            return isTimeline ? new TimelineResizeGesture() : new GridResizeGesture();
        }
        return isTimeline ? new TimelineMoveGesture() : new GridMoveGesture();
    }
}
