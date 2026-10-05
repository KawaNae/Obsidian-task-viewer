import type { ChildEntry, Task } from './TaskModel';

/**
 * A time of day, `HH:mm`: what the stated times hold. A date-time does
 * not fit the type. `DateUtils.formatHHMM` and `minutesToTime` make one, and
 * `DateUtils.timeOfDay` takes a time a row holds for one (`statedDates`).
 */
export type TimeOfDay = `${number}:${number}`;

/**
 * The dates a task's note states for it, in the form they are written: the
 * line's values, and its section's and frontmatter's where the line has none
 * (`statedDates`). Nothing is filled in by the rules.
 */
export interface StatedDates {
    startDate?: string;
    startTime?: TimeOfDay;
    endDate?: string;
    endTime?: TimeOfDay;
    /** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`, as written. */
    due?: string;
}

/**
 * A span of time, `[startMs, endMs)`, in local epoch milliseconds. A span
 * with `endMs === startMs` is a point. What a task occupies
 * (`DisplayTask.span`, made by `resolveSpan` in `utils/TaskDates.ts`) and
 * what a segment of it is drawn over (`DisplayTask.drawn`).
 */
export interface TaskSpan {
    startMs: number;
    endMs: number;
}

/**
 * 表示用タスク型。書かれた日付 (stated)、期間 (span, dueMs, drawn)、split 情報、
 * 子要素 partition を統合。
 * Task（生データ）→ toDisplayTask() → DisplayTask の 2 層構造。
 * 編集パスは raw フィールド (startDate 等) のみを参照する。
 */
export interface DisplayTask extends Task {
    /**
     * The dates the note states for the task (`statedDates`), made before
     * the task is split: a segment states the dates of the whole line. What
     * a card's top right shows.
     */
    stated: StatedDates;
    /**
     * The time the whole task occupies (`resolveSpan`): a segment of a split
     * task holds its line's span. A task with only a due has the span read
     * from its due (`spanDates`); null only for a task with no date and no
     * due.
     */
    span: TaskSpan | null;
    /** The moment of the due (`resolveSpan`): a bare date's is the end of its visual day. */
    dueMs: number | null;
    /**
     * What this card is drawn over: the span, or for a segment of a split
     * task the part of it between the boundaries it was cut at.
     */
    drawn: TaskSpan | null;
    /** Split 情報（境界分割） */
    originalTaskId: string;
    isSplit: boolean;
    splitContinuesBefore?: boolean;
    splitContinuesAfter?: boolean;
    /**
     * Materialized child entries (body 順、1 行 1 オーナー)。
     * Task.childIds / childLines から
     * `buildChildEntries` で derive。render / write の唯一の入口。
     */
    childEntries: ChildEntry[];
}
