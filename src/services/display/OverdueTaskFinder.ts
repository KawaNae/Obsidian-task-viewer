import type { DisplayTask, StatusDefinition } from '../../types';
import type { TaskReadService } from '../data/TaskReadService';
import { getOverdueLevel } from './TaskStatusQuery';
import { visualDaysOf } from '../../utils/DayWindow';

export function findOldestOverdueDate(
    displayTasks: DisplayTask[],
    startHour: number,
    statusDefinitions: StatusDefinition[],
    readService: TaskReadService,
): string | null {
    let oldest: string | null = null;
    for (const dt of displayTasks) {
        // Visual start date, so the returned date matches the column the
        // task is actually rendered on (an early-morning task belongs to
        // the previous visual day).
        if (!dt.span) continue;
        const first = visualDaysOf(dt.span, startHour).first;
        if (getOverdueLevel(dt, startHour, statusDefinitions, readService) === 'none') continue;
        if (!oldest || first < oldest) {
            oldest = first;
        }
    }
    return oldest;
}
