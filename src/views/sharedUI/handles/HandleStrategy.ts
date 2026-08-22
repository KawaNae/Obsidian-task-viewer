import type { Task } from '../../../types';

/**
 * Surface 別の handle 描画戦略。`HandleManager` は taskEl の所属 view を見て
 * 適切な strategy を選び、`render()` を委譲するだけ。
 *
 * Strategy が決めるのは「どの edge にどの種類の handle を出すか」。実際の
 * DOM 生成は `HandleRenderer` の static helper を共通利用する。
 */
export interface HandleStrategy {
    render(taskEl: HTMLElement, taskId: string, task: Task, startHour: number): void;
}
