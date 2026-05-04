import type { Task } from '../../../types';
import { HandleRenderer } from './HandleRenderer';
import type { HandleStrategy } from './HandleStrategy';

/**
 * Timeline (timed task) 用の handle 戦略。
 *
 * 縦軸タスクなので resize は top/bottom、move は corner（top-right /
 * bottom-right）。 detail は top-left。
 *
 * boundary に接している edge には handle を出さない（-12px outset が view
 * 境界を跨ぐと隣の領域とぶつかるため）:
 * - touching top: split-continues-before、または開始時刻が startHour:00 ちょうど
 * - touching bottom: split-continues-after、または終了時刻が startHour:00 ちょうど
 */
export class TimelineHandleStrategy implements HandleStrategy {
    render(taskEl: HTMLElement, taskId: string, task: Task, startHour: number): void {
        const isSplitTail = taskEl.classList.contains('task-card--split-continues-before');
        const isSplitHead = taskEl.classList.contains('task-card--split-continues-after');

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
