/**
 * The two things an empty-space click on a dated surface can do: create a task
 * in that day's daily note, or start a timer against the day itself.
 *
 * Timeline's timed lane and the all-day lane both offer this menu; the
 * create-task path differs only in whether it seeds a time alongside the date.
 */

import type { Menu } from 'obsidian';
import { t } from '../../i18n';
import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import { CreateModal } from '../../modals/create/CreateModal';

export type DailyNoteTimerType = 'pomodoro' | 'countup';

/**
 * Start a timer whose subject is the day itself rather than a task (a daily
 * subject, `{ daily: date }`): it has no target row, and its records go under
 * the heading of that day's daily note. It runs from the moment it is asked.
 */
export function startDailyNoteTimer(
    plugin: PluginContext & TimerHost,
    date: string,
    kind: DailyNoteTimerType,
): void {
    plugin.getTimerWidget().startTimer({ daily: date }, 'child', { kind });
}

/**
 * Open the create dialog on the daily note of `date`: the line it makes goes
 * under the task section of that day's note (`CreatePlace` `dailyNote`).
 *
 * `date` is the file's day (the visual column), which is not always the
 * task's own start date — a click past midnight seeds the next day while
 * still belonging to this column's note. `startTime` is what separates the
 * two callers: clicking the timed lane knows the hour under the cursor,
 * clicking the all-day lane does not.
 */
export function openCreateTaskForDailyNote(
    plugin: PluginContext,
    date: string,
    seed: { startDate: string; startTime?: string },
): void {
    new CreateModal(
        plugin.app,
        plugin.getCreatePlaces(),
        () => plugin.settings.startHour,
        { kind: 'dailyNote', date },
        seed,
    ).open();
}

/**
 * Fill in the empty-space context menu. Both lanes show the same items in the
 * same order; they differ only in what "create" seeds.
 */
export function appendEmptySpaceMenuItems(
    menu: Menu,
    handlers: { onCreate: () => void; onTimer: (kind: DailyNoteTimerType) => void },
): void {
    menu.addItem((item) => {
        item.setTitle(t('menu.createTaskForDailyNote'))
            .setIcon('plus')
            .onClick(() => handlers.onCreate());
    });

    menu.addSeparator();

    menu.addItem((item) => {
        item.setTitle(t('menu.startCountupForDailyNote'))
            .setIcon('clock')
            .onClick(() => handlers.onTimer('countup'));
    });

    menu.addItem((item) => {
        item.setTitle(t('menu.startPomodoroForDailyNote'))
            .setIcon('timer')
            .onClick(() => handlers.onTimer('pomodoro'));
    });
}
