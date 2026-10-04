import type { Task } from '../../../types';
import { minutesInDay, visualDayOf } from '../../../utils/DayWindow';
import { heldBy } from '../../taskcard/CardHold';
import { HandleRenderer } from './HandleRenderer';
import type { HandleStrategy } from './HandleStrategy';

/**
 * Timeline (timed task) 用の handle 戦略。
 *
 * 縦軸タスクなので resize は top/bottom、move は corner（top-right /
 * bottom-right）。 detail は top-left。
 *
 * ハンドルは縦方向に完全外側 (handle-size 分) へ出るため、grid の日境界
 * (startHour:00) に接する edge ではハンドル全体が隣接領域（allday 欄 /
 * grid 外）にはみ出してしまう。boundary に接している edge には出さない:
 * - touching top: split-continues-before、またはカードの描く範囲 (`drawn`) が日の境目から始まる
 * - touching bottom: split-continues-after、または描く範囲が日の境目で終わる
 */
export class TimelineHandleStrategy implements HandleStrategy {
    render(taskEl: HTMLElement, _task: Task, startHour: number): void {
        const isSplitTail = taskEl.classList.contains('task-card--split-continues-before');
        const isSplitHead = taskEl.classList.contains('task-card--split-continues-after');

        // What this card is drawn over (a segment's part of a split task).
        const drawn = heldBy(taskEl)?.task.drawn;
        const onBoundary = (ms: number) => minutesInDay(ms, visualDayOf(ms, startHour), startHour) === 0;
        const isTouchingTop = isSplitTail || (!!drawn && onBoundary(drawn.startMs));
        const isTouchingBottom = isSplitHead || (!!drawn && onBoundary(drawn.endMs));

        // 上端 boundary 以外: resize-top + move-top-right
        if (!isTouchingTop) {
            HandleRenderer.createResize(taskEl, 'top', '↕');
            HandleRenderer.createMove(taskEl, 'top-right');
        }

        // 下端 boundary 以外: resize-bottom + move-bottom-right
        if (!isTouchingBottom) {
            HandleRenderer.createResize(taskEl, 'bottom', '↕');
            HandleRenderer.createMove(taskEl, 'bottom-right');
        }
    }
}
