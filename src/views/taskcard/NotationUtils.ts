import { DisplayTask, Task } from '../../types';

/**
 * Polymorphic notation label input. Effective fields (DisplayTask) are
 * preferred when present; raw fields (Task) act as fallback.
 *
 * Defined structurally rather than as `Task | DisplayTask` so child Task
 * objects (resolved from TaskIndex without conversion) and DisplayTask
 * parents both pass without a cast.
 */
type NotationInput =
    Pick<Task, 'startDate' | 'startTime' | 'endDate' | 'endTime'>
    & Partial<Pick<DisplayTask, 'effectiveStartDate' | 'effectiveStartTime' | 'effectiveEndDate' | 'effectiveEndTime'>>;

/**
 * @notation の構築・フォーマットユーティリティ。
 * 純粋関数のみ。状態・DOM 依存なし。
 */
export class NotationUtils {
    /**
     * タスクの日時フィールドから @notation ラベルを構築する。
     * effective フィールドが利用可能なら優先（E/ED 型でも表示可能）、
     * 未設定なら raw フィールドにフォールバック。
     * 例: @2026-02-10T14:00>15:00
     */
    static buildNotationLabel(task: NotationInput): string | null {
        const startDate = task.effectiveStartDate || task.startDate;
        const startTime = task.effectiveStartTime ?? task.startTime;
        if (!startDate && !startTime) return null;
        const parts: string[] = [];
        if (startDate) parts.push(startDate);
        if (startTime) parts.push(startTime);
        let notation = '@' + parts.join('T');
        const endDate = task.effectiveEndDate ?? task.endDate;
        const endTime = task.effectiveEndTime ?? task.endTime;
        if (endDate || endTime) {
            notation += '>';
            const endParts: string[] = [];
            if (endDate) endParts.push(endDate);
            if (endTime) endParts.push(endTime);
            notation += endParts.join('T');
        }
        return notation;
    }

    /**
     * @notation を子タスク表示用にフォーマットする。
     * startDate のみ表示し、追加情報がある場合は … を付与。
     * 時刻のみ（@Txx:xx）の場合は親の startDate を代用。
     */
    static formatChildNotation(notation: string, parentStartDate: string | undefined): string {
        const raw = notation.slice(1); // remove leading @
        if (raw.startsWith('T')) {
            // Inherited time-only: @T10:00 → use parent startDate
            return parentStartDate ? `@${parentStartDate}…` : notation;
        }
        const dateMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) return notation;
        const datePart = dateMatch[1];
        // If notation is exactly @YYYY-MM-DD, show as-is; otherwise truncate
        return raw === datePart ? `@${datePart} ` : `@${datePart}…`;
    }
}
