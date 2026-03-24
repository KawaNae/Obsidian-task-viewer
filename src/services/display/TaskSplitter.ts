import type { DisplayTask } from '../../types';
import { shouldSplitDisplayTask, splitDisplayTaskAtBoundary } from './DisplayTaskConverter';

export type SplitBoundary = { type: 'visual-date'; startHour: number };

/**
 * Splits DisplayTask[] at the given boundary.
 * Tasks that span the boundary are replaced by [head, tail] segments.
 * allDay/dueOnly tasks pass through unchanged.
 */
export function splitTasks(tasks: DisplayTask[], boundary: SplitBoundary): DisplayTask[] {
    const result: DisplayTask[] = [];
    for (const dt of tasks) {
        if (shouldSplitDisplayTask(dt, boundary.startHour)) {
            const [head, tail] = splitDisplayTaskAtBoundary(dt, boundary.startHour);
            result.push(head, tail);
        } else {
            result.push(dt);
        }
    }
    return result;
}
