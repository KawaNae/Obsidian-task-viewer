import type { DisplayTask, StatusDefinition } from '../../types';
import type { TaskReadService } from '../data/TaskReadService';
import { getOverdueLevel, type OverdueLevel } from './TaskStatusQuery';

/**
 * Remembers each task's overdue level so the passage of time can be turned
 * into a change notification.
 *
 * Overdue is judged against the clock, so a card can cross its end or due
 * with no task field moving and no vault event firing. Nothing would tell
 * the views to look again.
 *
 * The watcher asks {@link getOverdueLevel} itself rather than working out
 * when each task is due to flip. Predicting the instant would mean restating
 * what counts as overdue — due before end, the visual day for a bare date,
 * the minute for a timed one — in a second place, free to drift from the
 * first. Re-asking is a handful of date comparisons per task.
 *
 * Sweeping also makes a missed tick harmless. A sweep compares against what
 * was last seen, not against the last tick's clock, so a machine that slept
 * through an hour of flips reports them all on the next sweep, late but
 * whole.
 */
/** How far into overdue a level sits. Time can only ever raise this. */
const DEPTH: Record<OverdueLevel, number> = { none: 0, 'past-end': 1, 'past-due': 2 };

export class OverdueWatcher {
    private levels = new Map<string, OverdueLevel>();

    /**
     * Re-judge every task and report whether time has made any of them more
     * overdue.
     *
     * Only a deepening counts. Time moves one way: a task can pass its end
     * and later its due, but it never stops being overdue on its own — that
     * takes an edit, which has already told the views through the index. A
     * sweep that reported it too would redraw every view a second time for a
     * change they have all seen.
     *
     * A task seen for the first time is recorded without counting either,
     * for the same reason, and because the first sweep after load would
     * otherwise redraw everything for nothing. Tasks that have gone are
     * dropped with the old map.
     */
    sweep(
        tasks: DisplayTask[],
        startHour: number,
        defs: StatusDefinition[],
        readService: TaskReadService,
    ): boolean {
        const next = new Map<string, OverdueLevel>();
        let changed = false;

        for (const task of tasks) {
            const level = getOverdueLevel(task, startHour, defs, readService);
            next.set(task.id, level);

            const previous = this.levels.get(task.id);
            if (previous !== undefined && DEPTH[level] > DEPTH[previous]) changed = true;
        }

        this.levels = next;
        return changed;
    }

    /** Forget everything, so the next sweep re-seeds. Tests and teardown. */
    reset(): void {
        this.levels.clear();
    }
}
