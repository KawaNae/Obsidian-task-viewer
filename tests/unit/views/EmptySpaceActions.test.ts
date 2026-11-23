import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NoteDestination } from '../../../src/services/data/NotePlaces';

const pick = vi.hoisted(() => vi.fn());
vi.mock('../../../src/modals/place/PlaceModal', () => ({ PlaceModal: { pick } }));

import {
    appendEmptySpaceMenuItems,
    openDraftHubForDailyNote,
    openDraftHubInNote,
    startDailyNoteTimer,
} from '../../../src/views/sharedLogic/EmptySpaceActions';
import { t } from '../../../src/i18n';
import type { PluginContext } from '../../../src/PluginContext';
import type { TimerHost } from '../../../src/timer/TimerWidget';
import type { App, Menu } from 'obsidian';
import { CreatePlaces } from '../../../src/services/data/CreatePlaces';
import type { Operations } from '../../../src/services/operations/Operations';
import { DEFAULT_SETTINGS } from '../../../src/types';

/** The settings' section of the day's daily note. */
const DAILY = { kind: 'note', note: { kind: 'daily', date: '2026-08-22' }, spot: { heading: 'Tasks', level: 2, side: 'head' } };

/** A plugin whose hub and timers record what they were asked; the place dialog is `pick`. */
function makePlugin() {
    const opened: unknown[][] = [];
    const started: unknown[][] = [];
    const notePlaces = { readFields: vi.fn() };
    const app = {} as App;
    const plugin = {
        app,
        settings: { ...DEFAULT_SETTINGS, taskHeading: 'Inbox' },
        openDraftHub: (...args: unknown[]) => { opened.push(args); },
        getCreatePlaces: () => new CreatePlaces(app, {} as Operations, () => DEFAULT_SETTINGS, () => undefined),
        getNotePlaces: () => notePlaces,
        getTimerWidget: () => ({ startTimer: (...args: unknown[]) => { started.push(args); } }),
    } as unknown as PluginContext & TimerHost;
    return { plugin, app, notePlaces, opened, started };
}

beforeEach(() => {
    pick.mockReset();
});

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

    it('starts the task on the day alone from the all-day lane, which knows no time', () => {
        expect(opened('2026-08-22')).toEqual([[DAILY, { startDate: '2026-08-22' }]]);
    });
});

describe('openDraftHubInNote', () => {
    const SECTION = { heading: 'Inbox', level: 2, side: 'head' } as const;

    it('asks where the task goes first, the note field empty and the heading field on the settings\' heading, a new note\'s folder reckoned from no note', async () => {
        const r = makePlugin();
        pick.mockResolvedValue(null);
        await openDraftHubInNote(r.plugin, '2026-08-22');
        expect(pick).toHaveBeenCalledTimes(1);
        const [app, places, opts] = pick.mock.calls[0];
        expect(app).toBe(r.app);
        expect(places).toBe(r.notePlaces);
        expect(opts).toEqual({
            purpose: 'create',
            initial: { note: { text: '', picked: null }, heading: 'Inbox' },
            folderFrom: '',
        });
    });

    it('opens nothing when the dialog is closed without a choice', async () => {
        const r = makePlugin();
        pick.mockResolvedValue(null);
        await openDraftHubInNote(r.plugin, '2026-08-22', 10 * 60);
        expect(r.opened).toEqual([]);
    });

    it('opens the hub on a task not written yet in the note and at the spot chosen, starting at the time pressed', async () => {
        const r = makePlugin();
        const to: NoteDestination = { note: { kind: 'existing', path: 'Projects/Plan.md' }, spot: SECTION };
        pick.mockResolvedValue(to);
        await openDraftHubInNote(r.plugin, '2026-08-22', 10 * 60 + 13);
        expect(r.opened).toEqual([[
            { kind: 'note', note: { kind: 'path', path: 'Projects/Plan.md' }, spot: SECTION },
            { startDate: '2026-08-22', startTime: '10:15' },
        ]]);
    });

    it('carries the next day past midnight, and the day alone from the all-day lane, the note staying the one chosen', async () => {
        const r = makePlugin();
        const to: NoteDestination = { note: { kind: 'new', path: 'Inbox.md' }, spot: 'end' };
        pick.mockResolvedValue(to);
        await openDraftHubInNote(r.plugin, '2026-08-22', 24 * 60 + 2 * 60 + 30);
        await openDraftHubInNote(r.plugin, '2026-08-22');
        const place = { kind: 'note', note: { kind: 'path', path: 'Inbox.md' }, spot: 'end' };
        expect(r.opened).toEqual([
            [place, { startDate: '2026-08-23', startTime: '02:30' }],
            [place, { startDate: '2026-08-22' }],
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

describe('appendEmptySpaceMenuItems', () => {
    /** The menu of a press on the timed lane (a time known) or the all-day lane (none). */
    function build(minutes?: number) {
        const r = makePlugin();
        const menu = new RecordedMenu();
        appendEmptySpaceMenuItems(menu.asMenu(), r.plugin, '2026-08-22', minutes);
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

    it('asks where to create first, and creates there at the time pressed', async () => {
        const { menu, opened } = build(10 * 60 + 13);
        const answered = Promise.resolve<NoteDestination>({ note: { kind: 'existing', path: 'Plan.md' }, spot: 'end' });
        pick.mockReturnValue(answered);
        menu.items[1].click?.();
        expect(pick).toHaveBeenCalledTimes(1);
        await answered;
        await Promise.resolve();
        expect(opened).toEqual([[
            { kind: 'note', note: { kind: 'path', path: 'Plan.md' }, spot: 'end' },
            { startDate: '2026-08-22', startTime: '10:15' },
        ]]);
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
