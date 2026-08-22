/**
 * The two things an empty-space click on a dated surface can do: create a task
 * in that day's daily note, or start a timer against the day itself.
 *
 * Timeline's timed lane and the all-day lane both offer this menu, and both
 * used to carry their own copy — `openDailyNoteTimer` was byte-identical in
 * the two files, and the create-task path differed only in whether it seeded a
 * time alongside the date.
 */

import type { Menu } from 'obsidian';
import { t } from '../../i18n';
import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import { CreateTaskModal, formatTaskLine } from '../../modals/CreateTaskModal';

export type DailyNoteTimerType = 'pomodoro' | 'countup';

/**
 * Start a timer whose subject is the day itself rather than a task. The id is
 * synthetic (`daily-<date>`), which is what routes the recorded segments into
 * that day's daily note.
 */
export function openDailyNoteTimer(
    plugin: PluginContext & TimerHost,
    date: string,
    timerType: DailyNoteTimerType,
): void {
    plugin.getTimerWidget().startTimer({
        taskId: `daily-${date}`,
        taskName: date,
        recordMode: 'child',
        timerType,
        autoStart: false,
    });
}

/**
 * Open the create-task modal seeded for `date`, and append the resulting line
 * to that day's daily note.
 *
 * `startTime` is what separates the two callers: clicking the timed lane knows
 * the hour under the cursor, clicking the all-day lane does not.
 */
export function openCreateTaskForDailyNote(
    plugin: PluginContext & TimerHost,
    date: string,
    seed: { startDate: string; startTime?: string },
): void {
    new CreateTaskModal(
        plugin.app,
        async (result) => {
            const taskLine = formatTaskLine(result);
            // `date` is the file's day (the visual column), which is not always
            // the task's own start date — a click past midnight seeds the next
            // day while still belonging to this column's note.
            const [y, m, d] = date.split('-').map(Number);
            const dateObj = new Date();
            dateObj.setFullYear(y, m - 1, d);
            dateObj.setHours(0, 0, 0, 0);

            const { DailyNoteUtils } = await import('../../utils/DailyNoteUtils');
            await DailyNoteUtils.appendLineToDailyNote(
                plugin.app,
                dateObj,
                taskLine,
                plugin.settings.dailyNoteHeader,
                plugin.settings.dailyNoteHeaderLevel,
            );
        },
        seed,
        { warnOnEmptyTask: true, dailyNoteDate: date, startHour: plugin.settings.startHour },
    ).open();
}

/**
 * Fill in the empty-space context menu. Both lanes show the same items in the
 * same order; they differ only in what "create" seeds.
 */
export function appendEmptySpaceMenuItems(
    menu: Menu,
    handlers: { onCreate: () => void; onTimer: (timerType: DailyNoteTimerType) => void },
): void {
    menu.addItem((item) => {
        item.setTitle(t('menu.createTaskForDailyNote'))
            .setIcon('plus')
            .onClick(() => handlers.onCreate());
    });

    menu.addSeparator();

    menu.addItem((item) => {
        item.setTitle(t('menu.openCountupForDailyNote'))
            .setIcon('clock')
            .onClick(() => handlers.onTimer('countup'));
    });

    menu.addItem((item) => {
        item.setTitle(t('menu.openPomodoroForDailyNote'))
            .setIcon('timer')
            .onClick(() => handlers.onTimer('pomodoro'));
    });
}
