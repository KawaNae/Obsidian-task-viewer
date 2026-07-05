import type { Task } from '../../../types';
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
 * - touching top: split-continues-before、または開始時刻が startHour:00 ちょうど
 * - touching bottom: split-continues-after、または終了時刻が startHour:00 ちょうど
 */
export class TimelineHandleStrategy implements HandleStrategy {
    render(taskEl: HTMLElement, taskId: string, task: Task, startHour: number): void {
        const isSplitTail = taskEl.classList.contains('task-card--split-continues-before');
        const isSplitHead = taskEl.classList.contains('task-card--split-continues-after');

        // Raw times are correct here: timeline handles render only for timed
        // tasks, whose start/end times are explicit (no implicit inheritance)
        // — raw and effective coincide by construction.
        const [startH, startM] = (task.startTime || '00:00').split(':').map(Number);
        const isTouchingTop = isSplitTail || (startH === startHour && startM === 0);

        let isTouchingBottom = isSplitHead;
        if (!isTouchingBottom && task.endTime) {
            const [endH, endM] = task.endTime.split(':').map(Number);
            if (endH === startHour && endM === 0) isTouchingBottom = true;
        }

        // 上端 boundary 以外: detail + resize-top + move-top-right
        if (!isTouchingTop) {
            HandleRenderer.createDetail(taskEl, taskId);
            HandleRenderer.createResize(taskEl, taskId, 'top', '↕');
            HandleRenderer.createMove(taskEl, taskId, 'top-right');
        }

        // 下端 boundary 以外: resize-bottom + move-bottom-right
        if (!isTouchingBottom) {
            HandleRenderer.createResize(taskEl, taskId, 'bottom', '↕');
            HandleRenderer.createMove(taskEl, taskId, 'bottom-right');
        }
    }
}
