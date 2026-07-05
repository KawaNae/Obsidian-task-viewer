import type { Task } from '../../../types';
import { HandleRenderer } from './HandleRenderer';
import type { HandleStrategy } from './HandleStrategy';

/**
 * Grid 系（Calendar / AllDay）共通の handle 戦略。
 *
 * Calendar (cal-week-row) と AllDay (.task-card--allday) は handle セット
 * （resize-{L,R} + move-bottom-{L,R}）が完全に一致するため、
 * 同じ strategy で扱える。違いは split 跨ぎの「sawtooth 端を持つ側」だけで、
 * それは task card の split-continues-* class を見て判定する。
 *
 * - 中央 segment（前後とも続く）: handle なし
 * - !continuesBefore（左端 segment）: resize-left + move-bottom-left
 * - !continuesAfter（右端 segment）: resize-right + move-bottom-right
 *
 * 配置は CSS が箱内 (inset) で行うが、カード高さが 2×handle-size 未満だと
 * 同じ x 列の resize/move が縦に収まらないため、`task-card--handles-out` を
 * 付けて timed と同じ「縦=完全外側」幾何にフォールバックする（calendar の
 * multi-day min-height:20px 床などが該当）。カード幾何の純関数であり、
 * スクロール位置には依存しない。class の除去は HandleManager.removeHandles。
 */
export class GridHandleStrategy implements HandleStrategy {
    /** 箱内 2 帯 (resize / move) が成立する最小カード高。= 2 × --handle-size */
    private static readonly HANDLES_OUT_THRESHOLD = 48;

    render(taskEl: HTMLElement, taskId: string, _task: Task, _startHour: number): void {
        taskEl.classList.toggle(
            'task-card--handles-out',
            taskEl.offsetHeight < GridHandleStrategy.HANDLES_OUT_THRESHOLD,
        );

        const continuesBefore = taskEl.classList.contains('task-card--split-continues-before');
        const continuesAfter = taskEl.classList.contains('task-card--split-continues-after');

        // middle segment: 両端 sawtooth なので handle 不要
        if (continuesBefore && continuesAfter) return;

        // 左端 segment: resize-left / move-bottom-left
        if (!continuesBefore) {
            HandleRenderer.createResize(taskEl, taskId, 'left', '↔');
            HandleRenderer.createMove(taskEl, taskId, 'bottom-left');
        }

        // 右端 segment: resize-right / move-bottom-right
        if (!continuesAfter) {
            HandleRenderer.createResize(taskEl, taskId, 'right', '↔');
            HandleRenderer.createMove(taskEl, taskId, 'bottom-right');
        }
    }
}
