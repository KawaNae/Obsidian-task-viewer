import type { Task } from '../../types';
import { materializeRawDates, type DisplayDateEdits } from '../../services/display/DisplayTaskConverter';
import { dueSpanWritten } from '../../utils/TaskDates';

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

/**
 * The task a drag starts from: the line's task, with the span a task with
 * only a due is read with written out as its dates (`dueSpanWritten`), so
 * the gesture moves and stretches what is drawn. Every gesture takes its
 * base from here.
 */
export function dragBase(raw: Task, startHour: number): Task {
    return { ...raw, ...dueSpanWritten(raw, startHour) };
}

/**
 * What a drag writes to the line: the edits materialized on the base, over
 * the dates a due-only task's span is written out with, less what the line
 * already holds. Compared with the line's own task (`raw`), not the base, so
 * the written-out dates are not dropped as unchanged.
 */
export function planUpdates(plan: DragPlan, raw: Task, startHour: number): Partial<Task> {
    const updates: Partial<Task> = {
        ...dueSpanWritten(raw, startHour),
        ...materializeRawDates(plan.edits, plan.baseTask, startHour),
    };
    const result: Partial<Task> = {};
    const u = updates as unknown as Record<string, unknown>;
    const r = raw as unknown as Record<string, unknown>;
    for (const key of Object.keys(u)) {
        if (u[key] !== r[key]) {
            (result as unknown as Record<string, unknown>)[key] = u[key];
        }
    }
    return result;
}
