import type { DisplayTask } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

/**
 * The canonical order of each section's bucket (`TaskDateCategorizer`), in
 * which every view draws it. A tie is broken by where the task is written
 * ({@link compareWritten}).
 */

// The same span TaskLayout stacks by, so timedTasks index order matches level order (shadow stacking integrity).
function durationMinutes(task: DisplayTask, startHour: number): number {
    const { start, end } = DateUtils.timedSpanMinutes(task.effectiveStartTime ?? '', task.effectiveEndTime, startHour);
    return end - start;
}

/**
 * Where the task is written: its file, then its line, as a number. The ID
 * comes last, for the segments of one row. The ID itself does not order
 * tasks: it is a name for one reading of the note
 * (`parserId:path:n:<reading>:<line>`), and compared as text it put line 10
 * before line 9 and one file's tasks after another's by their notation.
 */
function compareWritten(a: DisplayTask, b: DisplayTask): number {
    const file = a.file.localeCompare(b.file);
    if (file !== 0) return file;
    if (a.line !== b.line) return a.line - b.line;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** timed バケツ: visual position（startHour 起点の分数）昇順、同位置は duration 降順（長い→DOM早い→背面）、最後に書かれた場所の順 */
export function compareTimedForRender(a: DisplayTask, b: DisplayTask, startHour: number): number {
    const at = a.effectiveStartTime ?? '';
    const bt = b.effectiveStartTime ?? '';
    if (at !== bt) {
        const am = DateUtils.visualDayMinutes(at, startHour);
        const bm = DateUtils.visualDayMinutes(bt, startHour);
        if (am !== bm) return am - bm;
    }
    const aDur = durationMinutes(a, startHour);
    const bDur = durationMinutes(b, startHour);
    if (aDur !== bDur) return bDur - aDur;
    return compareWritten(a, b);
}

/** allDay バケツ: 開始日 (YYYY-MM-DD) 昇順、同日は書かれた場所の順 */
export function compareAllDayForRender(a: DisplayTask, b: DisplayTask): number {
    const ad = a.effectiveStartDate ?? '';
    const bd = b.effectiveStartDate ?? '';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return compareWritten(a, b);
}

/** dueOnly バケツ: due フル ISO 昇順、同時刻は書かれた場所の順 */
export function compareDueOnlyForRender(a: DisplayTask, b: DisplayTask): number {
    const ad = a.due ?? '';
    const bd = b.due ?? '';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return compareWritten(a, b);
}
