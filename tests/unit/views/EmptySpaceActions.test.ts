import { describe, it, expect } from 'vitest';

import {
    openDraftHubForDailyNote,
    openDraftHubInNote,
    startDailyNoteTimer,
} from '../../../src/views/sharedLogic/EmptySpaceActions';
import { appendDaySpaceMenuItems } from '../../../src/views/sharedUI/DaySpace';
import { t } from '../../../src/i18n';
import type { PluginContext } from '../../../src/PluginContext';
import type { TimerHost } from '../../../src/timer/TimerWidget';
import type { App, Menu } from 'obsidian';
import { CreatePlaces } from '../../../src/services/data/CreatePlaces';
import type { Operations } from '../../../src/services/operations/Operations';
import { DEFAULT_SETTINGS } from '../../../src/types';

/** The settings' section of the day's daily note. */
const DAILY = { kind: 'note', note: { kind: 'daily', date: '2026-08-22' }, spot: { heading: 'Tasks', level: 2, side: 'head' } };

/** A plugin whose hub and timers record what they were asked. */
function makePlugin() {
    const opened: unknown[][] = [];
    const started: unknown[][] = [];
    const app = {} as App;
    const plugin = {
        app,
        settings: { ...DEFAULT_SETTINGS, taskHeading: 'Inbox' },
        openDraftHub: (...args: unknown[]) => { opened.push(args); },
        getCreatePlaces: () => new CreatePlaces(app, {} as Operations, () => DEFAULT_SETTINGS, () => undefined),
        getTimerWidget: () => ({ startTimer: (...args: unknown[]) => { started.push(args); } }),
    } as unknown as PluginContext & TimerHost;
    return { plugin, app, opened, started };
}

describe('startDailyNoteTimer', () => {
    it('starts a timer on the day itself, recorded as children under that day\'s heading', () => {
        // The subject is the day, not a task: its records go under the heading
        // of that day's daily note. The start command runs it from the press.
        const { plugin, started } = makePlugin();
        startDailyNoteTimer(plugin, '2026-08-22', 'countup');
        expect(started).toEqual([[{ daily: '2026-08-22' }, 'child', { kind: 'countup' }]]);
    });

    it('passes the requested kind through', () => {
        const { plugin, started } = makePlugin();
        startDailyNoteTimer(plugin, '2026-08-22', 'pomodoro');
        expect(started[0][2]).toEqual({ kind: 'pomodoro' });
    });
});

describe('openDraftHubForDailyNote', () => {
    function opened(date: string, minutes?: number) {
        const r = makePlugin();
        openDraftHubForDailyNote(r.plugin, date, minutes);
        return r.opened;
    }

    it('opens the hub on a task not written yet in the day\'s daily note, starting at the time clicked to the nearest 5 minutes', () => {
        expect(opened('2026-08-22', 10 * 60 + 13)).toEqual([[DAILY, { startDate: '2026-08-22', startTime: '10:15' }]]);
    });

    it('starts the task on the next day past midnight, still in the column\'s note', () => {
        expect(opened('2026-08-22', 24 * 60 + 2 * 60 + 30)).toEqual([[DAILY, { startDate: '2026-08-23', startTime: '02:30' }]]);
    });

    it.each([
        ['23:57', 23 * 60 + 57, { startDate: '2026-08-22', startTime: '23:55' }],
        ['23:58', 23 * 60 + 58, { startDate: '2026-08-23', startTime: '00:00' }],
        ['23:59:30', 23 * 60 + 59.5, { startDate: '2026-08-23', startTime: '00:00' }],
        ['24:00', 24 * 60, { startDate: '2026-08-23', startTime: '00:00' }],
        ['28:58, a start hour of 5', 28 * 60 + 58, { startDate: '2026-08-23', startTime: '05:00' }],
    ])('starts a press at %s on the day the time rounded to 5 minutes falls on', (_at, minutes, seed) => {
        // The day follows the time once rounded: a press that rounds up to
        // midnight starts the task at the next day's 00:00, not this day's.
        expect(opened('2026-08-22', minutes)).toEqual([[DAILY, seed]]);
    });

    it('starts the task on the day alone from the all-day lane, which knows no time', () => {
        expect(opened('2026-08-22')).toEqual([[DAILY, { startDate: '2026-08-22' }]]);
    });
});

describe('openDraftHubInNote', () => {
    it('opens the hub on a task not written yet in no place, for the user to choose in it, starting at the time pressed', () => {
        const r = makePlugin();
        openDraftHubInNote(r.plugin, '2026-08-22', 10 * 60 + 13);
        expect(r.opened).toEqual([[null, { startDate: '2026-08-22', startTime: '10:15' }]]);
    });

    it('carries the next day past midnight, and the day alone from the all-day lane', () => {
        const r = makePlugin();
        openDraftHubInNote(r.plugin, '2026-08-22', 24 * 60 + 2 * 60 + 30);
        openDraftHubInNote(r.plugin, '2026-08-22');
        expect(r.opened).toEqual([
            [null, { startDate: '2026-08-23', startTime: '02:30' }],
            [null, { startDate: '2026-08-22' }],
        ]);
    });
});

/** Records what was appended to a menu; the shared obsidian mock is a no-op. */
class RecordedMenu {
    items: { title: string; icon?: string; click?: () => void }[] = [];
    separatorAfter: number[] = [];

    addItem(cb: (item: RecordedItem) => void): this {
        const rec: { title: string; icon?: string; click?: () => void } = { title: '' };
        this.items.push(rec);
        cb({
            setTitle(t: string) { rec.title = t; return this; },
            setIcon(i: string) { rec.icon = i; return this; },
            onClick(fn: () => void) { rec.click = fn; return this; },
        });
        return this;
    }
    addSeparator(): this {
        this.separatorAfter.push(this.items.length);
        return this;
    }
    asMenu(): Menu { return this as unknown as Menu; }
}

interface RecordedItem {
    setTitle(t: string): RecordedItem;
    setIcon(i: string): RecordedItem;
    onClick(fn: () => void): RecordedItem;
}

describe('appendDaySpaceMenuItems on Timeline', () => {
    /** The menu of a press on the timed lane (a time known) or the all-day lane (none). */
    function build(minutes?: number) {
        const r = makePlugin();
        const menu = new RecordedMenu();
        appendDaySpaceMenuItems(menu.asMenu(), r.plugin, { date: '2026-08-22', timers: true }, minutes);
        return { ...r, menu };
    }

    it.each([['the timed lane', 10 * 60], ['the all-day lane', undefined]])('offers on %s the two creates, then the two timers, in that order', (_lane, minutes) => {
        const { menu } = build(minutes);
        expect(menu.items.map(i => i.title)).toEqual([
            t('menu.createTaskForDailyNote'),
            t('menu.createTaskInNote'),
            t('menu.startCountupForDailyNote'),
            t('menu.startPomodoroForDailyNote'),
        ]);
        expect(menu.items.map(i => i.icon)).toEqual(['plus', 'file-plus', 'clock', 'timer']);
    });

    it.each([['the timed lane', 10 * 60], ['the all-day lane', undefined]])('separates the creates from the timers on %s', (_lane, minutes) => {
        const { menu } = build(minutes);
        expect(menu.separatorAfter).toEqual([2]);
    });

    it('creates in the day\'s daily note at the time pressed', () => {
        const { menu, opened } = build(10 * 60 + 13);
        menu.items[0].click?.();
        expect(opened).toEqual([[DAILY, { startDate: '2026-08-22', startTime: '10:15' }]]);
    });

    it('creates in a note the user chooses in the hub, at the time pressed', () => {
        const { menu, opened } = build(10 * 60 + 13);
        menu.items[1].click?.();
        expect(opened).toEqual([[null, { startDate: '2026-08-22', startTime: '10:15' }]]);
    });

    it('starts each timer on the day', () => {
        const { menu, started } = build();
        menu.items[2].click?.();
        menu.items[3].click?.();
        expect(started).toEqual([
            [{ daily: '2026-08-22' }, 'child', { kind: 'countup' }],
            [{ daily: '2026-08-22' }, 'child', { kind: 'pomodoro' }],
        ]);
    });
});

describe('appendDaySpaceMenuItems on the Calendar', () => {
    /** The menu of a press on a Calendar's day: it knows the day alone and offers no timers. */
    function build() {
        const r = makePlugin();
        const menu = new RecordedMenu();
        appendDaySpaceMenuItems(menu.asMenu(), r.plugin, { date: '2026-08-22', timers: false });
        return { ...r, menu };
    }

    it('offers the two creates alone, with no separator and no timer', () => {
        const { menu } = build();
        expect(menu.items.map(i => i.title)).toEqual([
            t('menu.createTaskForDailyNote'),
            t('menu.createTaskInNote'),
        ]);
        expect(menu.items.map(i => i.icon)).toEqual(['plus', 'file-plus']);
        expect(menu.separatorAfter).toEqual([]);
    });

    it('creates on the day alone, in the day\'s daily note or in a note the user chooses', () => {
        const { menu, opened, started } = build();
        menu.items[0].click?.();
        menu.items[1].click?.();
        expect(opened).toEqual([
            [DAILY, { startDate: '2026-08-22' }],
            [null, { startDate: '2026-08-22' }],
        ]);
        expect(started).toEqual([]);
    });
});
