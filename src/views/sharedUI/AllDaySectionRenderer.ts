import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import type { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import type { DisplayTask } from '../../types';
import { bindDaySpace } from './DaySpace';
import { drawDateGridLane } from './DateGridLane';
import type { CardReconciler } from './CardReconciler';

/** Timeline's all-day row: its lane of cards, and the menu of its empty space. */
export class AllDaySectionRenderer {
    constructor(
        private plugin: PluginContext & TimerHost,
        private taskRenderer: TaskCardRenderer,
    ) { }

    /**
     * Lay the all-day tasks on the row, after the time axis's column and the
     * row's padding: the lane Calendar's week rows draw too. The row is one
     * run of days, so a task is cut only at the window's ends.
     *
     * @returns the number of tracks drawn
     */
    public render(
        container: HTMLElement,
        dates: string[],
        displayTasks: DisplayTask[],
        reconciler: CardReconciler,
    ): number {
        return drawDateGridLane(container, displayTasks, {
            dates,
            colOffset: 1,
            firstRow: 2,
            scope: 'allday',
            cardClass: 'task-card--allday',
            timeOnSingleDay: false,
        }, { taskRenderer: this.taskRenderer, settings: this.plugin.settings, reconciler });
    }

    /**
     * Make a day's cell, which spans the row under its cards, the day's
     * empty space: a press knows the day alone, and the menu offers the
     * timers on the day too.
     */
    public addEmptySpaceContextMenu(cell: HTMLElement, date: string) {
        bindDaySpace(cell, this.plugin, { date, timers: true });
    }
}
