import type { DisplayTask, StatusDefinition } from '../../types';
import { isCompleteStatusChar } from '../../types';
import type { TaskReadService } from '../data/TaskReadService';
import { DateUtils } from '../../utils/DateUtils';

export type OverdueLevel = 'none' | 'past-end' | 'past-due';

export function isTaskCompleted(
    task: DisplayTask,
    defs: StatusDefinition[],
    readService: TaskReadService,
): boolean {
    const completed = isCompleteStatusChar(task.statusChar || ' ', defs);
    if (!completed || task.childEntries.length === 0) {
        return completed;
    }

    for (const entry of task.childEntries) {
        if (entry.kind === 'line') {
            const ch = entry.line.checkboxChar;
            if (ch !== null && !isCompleteStatusChar(ch, defs)) return false;
        } else {
            const childId = entry.kind === 'task' ? entry.taskId : null;
            const child = childId ? readService.getTask(childId) : undefined;
            if (!child) continue;
            if (!isCompleteStatusChar(child.statusChar || ' ', defs)) return false;
        }
    }

    return true;
}

export function getOverdueLevel(
    task: DisplayTask,
    startHour: number,
    defs: StatusDefinition[],
    readService: TaskReadService,
): OverdueLevel {
    // overdue は「現在時刻 × タスク本来の日付」の絶対判定。split セグメントは
    // ビュー境界で切られた effective 日付を持つため、元タスクに解決して判定する。
    if (task.isSplit && task.originalTaskId !== task.id) {
        const original = readService.getDisplayTask(task.originalTaskId);
        if (original) task = original;
    }

    if (isTaskCompleted(task, defs, readService)) return 'none';

    if (task.effectiveDue && DateUtils.isPastDue(task.effectiveDue, startHour)) {
        return 'past-due';
    }

    if (task.effectiveEndDate) {
        const endTime = task.effectiveEndTime;
        const cleanEndTime = endTime?.includes('T') ? endTime.split('T')[1] : endTime;
        if (DateUtils.isPastDate(task.effectiveEndDate, cleanEndTime, startHour)) {
            return 'past-end';
        }
    }

    return 'none';
}
