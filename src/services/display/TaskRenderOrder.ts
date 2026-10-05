import type { DisplayTask } from '../../types';
import { minutesOfSpan } from '../../utils/DayWindow';

/**
 * The canonical order of each section's bucket (`TaskDateCategorizer`), in
 * which every view draws it. A tie is broken by where the task is written
 * ({@link compareWritten}).
 */

// The same minutes TaskLayout stacks by, so timedTasks index order matches level order (shadow stacking integrity).
function minutesOf(task: DisplayTask, startHour: number): { start: number; end: number } {
    return task.drawn ? minutesOfSpan(task.drawn, startHour) : { start: 0, end: 0 };
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
    const am = minutesOf(a, startHour);
    const bm = minutesOf(b, startHour);
    if (am.start !== bm.start) return am.start - bm.start;
    const aDur = am.end - am.start;
    const bDur = bm.end - bm.start;
    if (aDur !== bDur) return bDur - aDur;
    return compareWritten(a, b);
}

/** allDay バケツ: 描く範囲の開始の瞬間の昇順、同時は書かれた場所の順 */
export function compareAllDayForRender(a: DisplayTask, b: DisplayTask): number {
    const ad = a.drawn?.startMs ?? -Infinity;
    const bd = b.drawn?.startMs ?? -Infinity;
    if (ad !== bd) return ad < bd ? -1 : 1;
    return compareWritten(a, b);
}
