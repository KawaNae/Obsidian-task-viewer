import type { ChildEntry, Task } from './TaskModel';

/**
 * A time of day, `HH:mm`: what the effective times hold. A date-time does
 * not fit the type. `DateUtils.formatHHMM` and `minutesToTime` make one, and
 * `DateUtils.timeOfDay` takes a time a row holds for one (`resolveEffectiveDates`).
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
 * The dates a task covers once its implicit values are resolved
 * (`resolveEffectiveDates`).
 */
export interface EffectiveDates {
    /**
     * 暗黙値解決済みの effective フィールド (inclusive visual coordinates).
     *
     * `effectiveEndDate` は **常に inclusive な visual 終端日**として扱う。
     * raw `Task.endDate` の `endTime` 有無による inclusive/exclusive の二重規格
     * (Task.endDate 参照) は implicit endTime 注入 + `toVisualDate` シフトで
     * 吸収するため、display/render/drag layer は統一的に inclusive として
     * 読み書きできる。
     */
    effectiveStartDate: string;
    effectiveStartTime?: TimeOfDay;
    effectiveEndDate?: string;
    effectiveEndTime?: TimeOfDay;
    effectiveDue?: string;
    /** 各フィールドが暗黙値かどうか */
    startDateImplicit: boolean;
    startTimeImplicit: boolean;
    endDateImplicit: boolean;
    endTimeImplicit: boolean;
}

/**
 * 表示用タスク型。暗黙値解決 + split 情報 + 子要素 partition を統合。
 * Task（生データ）→ toDisplayTask() → DisplayTask の 2 層構造。
 * 編集パスは raw フィールド (startDate 等) のみを参照する。
 */
export interface DisplayTask extends Task, EffectiveDates {
    /**
     * The dates the note states for the task (`statedDates`), made before
     * the task is split: a segment states the dates of the whole line. What
     * a card's top right shows.
     */
    stated: StatedDates;
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
