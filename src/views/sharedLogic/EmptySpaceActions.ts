/**
 * What a press on the empty space of a dated lane can do: create a task in
 * that day's daily note, create one in a note the user chooses, or start a
 * timer against the day itself.
 *
 * Timeline's timed lane and the all-day lane offer both; they differ only
 * in whether the press knows a time, which the task to create starts at.
 * The element that opens the menu is bound in `DaySpace`.
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
 * (`CreatePlaces.dailyNote`), starting as {@link seedAt} says.
 */
export function openDraftHubForDailyNote(plugin: PluginContext, date: string, minutes?: number): void {
    plugin.openDraftHub(plugin.getCreatePlaces().dailyNote(date), seedAt(date, minutes));
}

/**
 * Open the hub on a task not written yet in no place, for the user to
 * choose the note in its note field, starting as {@link seedAt} says. The
 * note stays the one chosen whatever start date the task is given.
 */
export function openDraftHubInNote(plugin: PluginContext, date: string, minutes?: number): void {
    plugin.openDraftHub(null, seedAt(date, minutes));
}

/**
 * What a task created by a press on a lane starts as. `date` is the file's
 * day (the visual column). A press on the timed lane knows the time under
 * it, `minutes` after that day's midnight (the start hour's offset in): the
 * task starts then, to the nearest 5 minutes, on the next day once it is
 * past midnight. A press on the all-day lane knows no time: the task starts
 * on the day alone.
 */
function seedAt(date: string, minutes?: number): DraftSeed {
    if (minutes === undefined) return { startDate: date };

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
 * Add the two ways to create a task from a press on the column of `date`, at
 * `minutes` after its midnight where the press knows a time (see
 * {@link seedAt}): in that day's daily note, then in a note the user
 * chooses in the hub.
 */
export function appendCreateItems(
    menu: Menu,
    plugin: PluginContext,
    date: string,
    minutes?: number,
): void {
    menu.addItem((item) => {
        item.setTitle(t('menu.createTaskForDailyNote'))
            .setIcon('plus')
            .onClick(() => openDraftHubForDailyNote(plugin, date, minutes));
    });

    menu.addItem((item) => {
        item.setTitle(t('menu.createTaskInNote'))
            .setIcon('file-plus')
            .onClick(() => openDraftHubInNote(plugin, date, minutes));
    });
}

/** Add the two timers on the day of `date` (see {@link startDailyNoteTimer}): a count-up, then a pomodoro. */
export function appendDayTimerItems(
    menu: Menu,
    plugin: PluginContext & TimerHost,
    date: string,
): void {
    menu.addItem((item) => {
        item.setTitle(t('menu.startCountupForDailyNote'))
            .setIcon('clock')
            .onClick(() => startDailyNoteTimer(plugin, date, 'countup'));
    });

    menu.addItem((item) => {
        item.setTitle(t('menu.startPomodoroForDailyNote'))
            .setIcon('timer')
            .onClick(() => startDailyNoteTimer(plugin, date, 'pomodoro'));
    });
}
