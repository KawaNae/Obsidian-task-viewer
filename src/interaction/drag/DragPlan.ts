import type { Task } from '../../types';
import type { DisplayDateEdits } from '../../services/display/DisplayTaskConverter';

/**
 * 1 回の drag 完了で発生する write-back の意味的単位。
 *
 * `edits` は **inclusive visual** 座標で表現された差分（DisplayTask の
 * `effective*` と同じ世界）。`baseTask` は元タスク（split segment ではなく
 * 集約後の original task）で、`materializeRawDates` が visual → raw 変換時の
 * endDate dual semantic を判定するのに使う。
 *
 * `null` を返す finish は「変更なし、書き戻し不要」を意味する。
 *
 * BaseDragStrategy.commitPlan が `materializeRawDates → diffUpdates →
 * writeService.updateTask + restoreSelection` を 1 箇所で行うため、各 finish
 * は raw `Partial<Task>` を組み立てない。これにより `endDate +1day` 系の
 * dual-semantic ミスを構造的に防ぐ。
 */
export interface DragPlan {
    edits: DisplayDateEdits;
    baseTask: Task;
}
