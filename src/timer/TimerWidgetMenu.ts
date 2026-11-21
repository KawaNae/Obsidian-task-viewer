/**
 * The menus of a started timer in the widget: the gear's menu, and the shift
 * menu the elapsed time opens. Both entries add the shift section with the
 * same function, so the two menus offer the same shifts.
 *
 * The gear's menu is, in order: the shift section (while the start can be
 * shifted), the Pomodoro section (for a Pomodoro), a separator, and the close
 * item. A section is a disabled heading and its choices indented under it, the
 * way `TimerSettingsMenu` lays out a length.
 *
 * What each choice writes is the lifecycle's (`TimerLifecycle.offsetStart`,
 * `TimerLifecycle.close`) or the board's (`retimed`); this file only lays the
 * items out and names their targets.
 */

import type { App, Menu } from 'obsidian';
import type { PluginContext } from '../PluginContext';
import type { IntervalGroup } from './IntervalMath';
import type { TimerBoard } from './TimerBoard';
import type { TimerLifecycle } from './TimerLifecycle';
import { TimerSettingsMenu } from './TimerSettingsMenu';
import { OFFSET_PRESET_MINUTES, canOffsetStart, rememberedStart, startLabel } from './TimerStartOffset';
import { holdsRun, type TimerState } from './TimerState';
import { TimerStartOffsetModal } from '../modals/TimerStartOffsetModal';
import { t } from '../i18n';

export interface TimerMenuDeps {
    app: App;
    plugin: Pick<PluginContext, 'settings' | 'saveSettings'>;
    board: TimerBoard;
    lifecycle: TimerLifecycle;
}

/** Two spaces put a section's choices under its heading, as `TimerSettingsMenu` does. */
const INDENT = '  ';

/** The gear's menu of a started timer. */
export function buildTimerMenu(menu: Menu, timer: TimerState, deps: TimerMenuDeps): void {
    let sections = 0;
    if (canOffsetStart(timer)) {
        addStartOffsetItems(menu, timer, deps);
        sections++;
    }
    if (timer.measure.type === 'interval') {
        addPomodoroItems(menu, timer, deps);
        sections++;
    }
    if (sections > 0) menu.addSeparator();
    addCloseItem(menu, timer, deps.lifecycle);
}

/**
 * The shift section: its heading, "From N min ago", the remembered start (if
 * any), and "Set the shift...". "N min ago" counts back from when it is
 * chosen. Adds nothing while the start cannot be shifted.
 */
export function addStartOffsetItems(menu: Menu, timer: TimerState, deps: TimerMenuDeps): void {
    if (!canOffsetStart(timer)) return;
    const { lifecycle, plugin } = deps;
    const offset = (startMs: number): void => void lifecycle.offsetStart(timer, startMs);
    const now = Date.now();
    const remembered = rememberedStart(timer, now, plugin.settings.startHour);

    menu.addItem((item) => {
        item.setTitle(t('timer.offsetStart')).setDisabled(true);
    });
    for (const minutes of OFFSET_PRESET_MINUTES) {
        menu.addItem((item) => {
            item.setTitle(`${INDENT}${t('timer.offsetMinutesAgo', { minutes })}`)
                .onClick(() => offset(Date.now() - minutes * 60_000));
        });
    }
    if (remembered !== null) {
        menu.addItem((item) => {
            item.setTitle(`${INDENT}${t('timer.offsetFromTime', { time: startLabel(remembered, now) })}`)
                .onClick(() => offset(remembered));
        });
    }
    menu.addItem((item) => {
        item.setTitle(`${INDENT}${t('timer.offsetCustom')}`)
            // The dialog waits for the write and says a refusal inside it.
            .onClick(() => new TimerStartOffsetModal(deps.app, (startMs) => lifecycle.offsetStart(timer, startMs, { tellRefusal: false })).open());
    });
}

/**
 * The Pomodoro section: the work and break lengths and auto repeat. A length
 * chosen is saved to the settings and also retimes the running timer's
 * segments (`retimed`); auto repeat changes only this timer. The segments are
 * a Pomodoro's one group of work and break (`pomodoroGroups`).
 */
export function addPomodoroItems(menu: Menu, timer: TimerState, deps: TimerMenuDeps): void {
    if (timer.measure.type !== 'interval') return;
    const { board, plugin } = deps;

    /** The segments with the first group replaced by `change`. */
    const retime = (change: (group: IntervalGroup) => IntervalGroup): void => {
        if (timer.measure.type !== 'interval') return;
        const groups = timer.measure.groups.map((group, i) => i === 0 ? change(group) : group);
        board.dispatch(timer, { type: 'retimed', groups });
    };
    const applyMinutes = async (
        key: 'pomodoroWorkMinutes' | 'pomodoroBreakMinutes',
        segmentIndex: number,
        minutes: number,
    ): Promise<void> => {
        plugin.settings[key] = minutes;
        retime(group => ({
            ...group,
            segments: group.segments.map((segment, i) =>
                i === segmentIndex ? { ...segment, durationSeconds: minutes * 60 } : segment),
        }));
        await plugin.saveSettings();
    };
    const firstGroup = (): IntervalGroup | undefined =>
        timer.measure.type === 'interval' ? timer.measure.groups[0] : undefined;

    TimerSettingsMenu.addPomodoroFields(menu, deps.app, {
        getWorkMinutes: () => plugin.settings.pomodoroWorkMinutes,
        setWorkMinutes: (minutes) => applyMinutes('pomodoroWorkMinutes', 0, minutes),
        getBreakMinutes: () => plugin.settings.pomodoroBreakMinutes,
        setBreakMinutes: (minutes) => applyMinutes('pomodoroBreakMinutes', 1, minutes),
        autoRepeat: {
            isOn: () => firstGroup()?.repeatCount === 0,
            toggle: () => retime(group => ({ ...group, repeatCount: group.repeatCount === 0 ? 1 : 0 })),
        },
    });
}

/**
 * The close item. Its words say what becomes of the record, read from the
 * session when the menu opens: a timer that holds a running line closes
 * without recording it, and is marked as a warning; a suspended one has
 * recorded everything. What a press does is decided again when it lands
 * (`TimerLifecycle.close`).
 *
 * The icon is `x` for both, not `trash`: closing without recording can leave
 * the line, since a self timer's first run is its subject's own line.
 */
export function addCloseItem(menu: Menu, timer: TimerState, lifecycle: TimerLifecycle): void {
    const discards = holdsRun(timer);
    menu.addItem((item) => {
        item.setTitle(discards ? t('timer.discard') : t('timer.close'))
            .setIcon('x')
            .onClick(() => void lifecycle.close(timer));
        if (discards) item.setWarning(true);
    });
}
