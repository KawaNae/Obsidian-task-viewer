import type { ChildEntry, Task } from './TaskModel';

/**
 * 表示用タスク型。暗黙値解決 + split 情報 + 子要素 partition を統合。
 * Task（生データ）→ toDisplayTask() → DisplayTask の 2 層構造。
 * 編集パスは raw フィールド (startDate 等) のみを参照する。
 */
export interface DisplayTask extends Task {
    /**
     * 暗黙値解決済みの effective フィールド (inclusive visual coordinates).
     *
     * `effectiveEndDate` は **常に inclusive な visual 終端日**として扱う。
     * raw `Task.endDate` の `endTime` 有無による inclusive/exclusive の二重規格
     * (Task.endDate 参照) は `toDisplayTask` が implicit endTime 注入 +
     * `toVisualDate` シフトで吸収するため、display/render/drag layer は
     * 統一的に inclusive として読み書きできる。
     */
    effectiveStartDate: string;
    effectiveStartTime?: string;
    effectiveEndDate?: string;
    effectiveEndTime?: string;
    effectiveDue?: string;
    /** 各フィールドが暗黙値かどうか */
    startDateImplicit: boolean;
    startTimeImplicit: boolean;
    endDateImplicit: boolean;
    endTimeImplicit: boolean;
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
