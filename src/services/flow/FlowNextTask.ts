import { differenceInCalendarDays } from 'date-fns';
import type { Task, TaskFlow } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { TIMER_ICON_PREFIX_RE } from '../../utils/TimerIcons';
import { parseDateStr } from '../lang/Value';
import { type FlowProgram } from './FlowAst';
import { flowRaws, joinSegments } from './FlowSegments';
import { serializeFlowLines } from './FlowSerializer';
import { type DateAnchor, type NextOccurrence } from './ScheduleEngine';

/** Primary date of the task: start > end > due. */
export function resolveAnchor(task: Task): DateAnchor | null {
    if (task.startDate) return { date: task.startDate, time: task.startTime };
    if (task.endDate) return { date: task.endDate, time: task.endTime };
    if (task.due) {
        const [date, time] = task.due.split('T');
        return { date, time };
    }
    return null;
}

/**
 * Build the next instance: shift the whole date block by the anchor delta
 * and reset per-instance identity (same override set as the legacy
 * generation path, so blockId/timer state never leaks into copies).
 */
export function buildNextTask(task: Task, anchor: DateAnchor | null, next: NextOccurrence): Task {
    const newTask: Task = {
        ...task,
        id: '',
        statusChar: ' ',
        originalText: '',
        childLines: [],
        blockId: undefined,
        timerTargetId: undefined,
        // タイマーのアイコンは記法に準ずる目印なので次インスタンスへ持ち越さない。
        // 一覧の単一情報源は TimerIcons — ここに直接書くと、付ける側に足した
        // アイコンが剥がす側から漏れる（`🔁` が実際に漏れていた）。
        content: task.content.replace(TIMER_ICON_PREFIX_RE, ''),
    };

    if (!anchor) {
        // Dateless task: place the computed occurrence directly on start.
        newTask.startDate = next.date;
        newTask.startTime = next.time;
        return newTask;
    }

    const shiftDays = differenceInCalendarDays(parseDateStr(next.date), parseDateStr(anchor.date));

    newTask.startDate = task.startDate ? DateUtils.shiftDateString(task.startDate, shiftDays) : undefined;
    newTask.endDate = task.endDate
        ? DateUtils.shiftDateString(task.endDate, shiftDays)
        : (task.endTime && task.startDate)
            ? DateUtils.shiftDateString(task.startDate, shiftDays)
            : undefined;
    newTask.due = task.due ? DateUtils.shiftDateString(task.due, shiftDays) : undefined;

    // Minute/hour grids move the anchor field's time as well.
    if (next.time !== undefined) {
        if (task.startDate) newTask.startTime = next.time;
        else if (task.endDate) newTask.endTime = next.time;
        else if (task.due) newTask.due = `${next.date}T${next.time}`;
    }

    return newTask;
}

/**
 * The command the next instance carries, or undefined when the chain ends
 * here.
 *
 * Returned rather than assigned, so that where it is called is decided by
 * what it needs rather than by where the line happens to sit. A generated
 * instance calls it after its block has run, which will matter as soon as
 * the clause has to print values the block decides.
 */
export function nextFlow(program: FlowProgram, originalFlow: TaskFlow): TaskFlow | undefined {
    let nextProgram = program;
    if (program.lifetime) {
        const remaining = program.lifetime.count - 1;
        if (remaining <= 0) {
            // x1 fired: the final instance carries no command at all
            // (the extreme case of "an emptied segment loses its line").
            return undefined;
        }
        nextProgram = { ...program, lifetime: { ...program.lifetime, count: remaining } };
    }

    // Line-level canonical inheritance: each node keeps the line the user
    // wrote it on (derived from its span via the original segment table —
    // the lifetime spread above preserves spans), while line contents are
    // regenerated in canonical order.
    const { table } = joinSegments(flowRaws(originalFlow));
    const lines = serializeFlowLines(nextProgram, table);
    return {
        raw: lines.taskLine,
        childSegments: lines.childLines.map(raw => ({ raw, bodyLine: -1 })),
        program: nextProgram,
        diagnostics: [],
    };
}
