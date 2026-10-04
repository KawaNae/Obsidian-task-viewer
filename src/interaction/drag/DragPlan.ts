import type { Task } from '../../types';
import type { DisplayDateEdits } from '../../services/display/DisplayTaskConverter';

/**
 * 1 回の drag 完了で発生する write-back の意味的単位。
 *
 * `edits` は視覚日で表した差分（`visualDaysOf` が返す最初と最後の日と、
 * その日の時刻）。`baseTask` は元タスク（split segment ではなく集約後の
 * original task）で、`materializeRawDates` が edit の無い側の時刻を引くのに
 * 使う。
 *
 * `null` を返す finish は「変更なし、書き戻し不要」を意味する。
 *
 * BaseDragStrategy.commitPlan が `materializeRawDates → diffUpdates →
 * operations.updateTask + restoreSelection` を 1 箇所で行うため、各 finish
 * は raw `Partial<Task>` を組み立てない。視覚日から行の日付への変換は
 * `materializeRawDates` の 1 か所だけが持つ。
 */
export interface DragPlan {
    edits: DisplayDateEdits;
    baseTask: Task;
}
