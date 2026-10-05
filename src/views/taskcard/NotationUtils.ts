import type { Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

const LEADING_DATE_RE = new RegExp(`^(${DateUtils.DATE_PATTERN})`);

/**
 * What a notation label reads: the values written on the line. Child tasks
 * (raw `Task`s from the index) and display copies both pass. The label shows
 * what is WRITTEN on the line, not the resolved schedule; parent-side
 * callers pass the raw startDate for the same reason (one coordinate system
 * for parent and children).
 */
type NotationInput = Pick<Task, 'startDate' | 'startTime' | 'endDate' | 'endTime'>;

/**
 * @notation の構築・フォーマットユーティリティ。
 * 純粋関数のみ。状態・DOM 依存なし。
 */
export class NotationUtils {
    /**
     * タスクの行に書かれた日時フィールドから @notation ラベルを構築する。
     * 例: @2026-02-10T14:00>15:00
     */
    static buildNotationLabel(task: NotationInput): string | null {
        const { startDate, startTime, endDate, endTime } = task;
        if (!startDate && !startTime) return null;
        const parts: string[] = [];
        if (startDate) parts.push(startDate);
        if (startTime) parts.push(startTime);
        let notation = '@' + parts.join('T');
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
        const dateMatch = raw.match(LEADING_DATE_RE);
        if (!dateMatch) return notation;
        const datePart = dateMatch[1];
        // If notation is exactly @YYYY-MM-DD, show as-is; otherwise truncate
        return raw === datePart ? `@${datePart} ` : `@${datePart}…`;
    }
}
