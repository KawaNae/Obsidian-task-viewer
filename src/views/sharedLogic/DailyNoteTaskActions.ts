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
import type { DraftSeed } from '../../services/data/TaskDraft';
import { DateUtils } from '../../utils/DateUtils';

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
 * Open the hub on a task not written yet in the daily note of `date`: the
 * line it makes goes under the task section of that day's note
 * (`CreatePlaces.dailyNote`).
 *
 * `date` is the file's day (the visual column). A click on the timed lane
 * knows the time under the cursor, `minutes` after that day's midnight (the
 * start hour's offset in): the task starts then, to the nearest 5 minutes,
 * on the next day once it is past midnight, while still going in this
 * column's note. A click on the all-day lane knows no time: the task starts
 * on the day alone.
 */
export function openDraftHubForDailyNote(plugin: PluginContext, date: string, minutes?: number): void {
    plugin.openDraftHub(plugin.getCreatePlaces().dailyNote(date), minutes === undefined ? { startDate: date } : timedSeed(date, minutes));
}

function timedSeed(date: string, minutes: number): DraftSeed {
    let totalMinutes = minutes;
    if (totalMinutes >= 24 * 60) totalMinutes -= 24 * 60;

    const hours = Math.floor(totalMinutes / 60);
    let roundedMinutes = Math.round(Math.floor(totalMinutes % 60) / 5) * 5;
    let finalHours = hours;
    if (roundedMinutes === 60) {
        roundedMinutes = 0;
        finalHours += 1;
    }
    if (finalHours >= 24) finalHours -= 24;

    return {
        startDate: minutes >= 24 * 60 ? DateUtils.addDays(date, 1) : date,
        startTime: DateUtils.formatHHMM(finalHours, roundedMinutes),
    };
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
