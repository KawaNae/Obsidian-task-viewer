import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import { TouchLongPressBinder } from '../../interaction/menu/TouchLongPressBinder';
import type { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import type { DisplayTask } from '../../types';
import {
    appendEmptySpaceMenuItems,
    openCreateTaskForDailyNote,
    startDailyNoteTimer,
} from '../sharedLogic/DailyNoteTaskActions';
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

    /** Add context menu listeners to AllDay section cell */
    public addEmptySpaceContextMenu(cell: HTMLElement, date: string) {
        TouchLongPressBinder.bind(cell, {
            getThreshold: () => this.plugin.settings.longPressThreshold,
            targetCheck: (t) => t === cell,
            onLongPress: (x, y) => this.showEmptySpaceMenu(x, y, date),
            onContextMenu: (e) => this.showEmptySpaceMenu(e.pageX, e.pageY, date),
        });
    }

    /** Show context menu for empty space click */
    private showEmptySpaceMenu(x: number, y: number, date: string) {
        this.plugin.menuPresenter.present((menu) => {
            appendEmptySpaceMenuItems(menu, {
                onCreate: () => openCreateTaskForDailyNote(this.plugin, date, { startDate: date }),
                onTimer: (kind) => startDailyNoteTimer(this.plugin, date, kind),
            });
        }, { kind: 'position', x, y });
    }
}
