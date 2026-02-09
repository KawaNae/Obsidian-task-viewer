import { Task } from '../../types';

/**
 * @notation の構築・フォーマットユーティリティ。
 * 純粋関数のみ。状態・DOM 依存なし。
 */
export class NotationUtils {
    /**
     * タスクの日時フィールドから @notation ラベルを構築する。
     * 例: @2026-02-10T14:00>15:00
     */
    static buildNotationLabel(task: Task): string | null {
        if (!task.startDate && !task.startTime) return null;
        const parts: string[] = [];
        if (task.startDate) parts.push(task.startDate);
        if (task.startTime) parts.push(task.startTime);
        let notation = '@' + parts.join('T');
        if (task.endDate || task.endTime) {
            notation += '>';
            const endParts: string[] = [];
            if (task.endDate) endParts.push(task.endDate);
            if (task.endTime) endParts.push(task.endTime);
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
