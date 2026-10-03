/**
 * The day a dated view looks at, in the running Dev vault (stage9b-design,
 * 設計 3). Timeline, Schedule, Calendar and MiniCalendar hold the transient
 * `date`: absent, the view follows today; present, it stays on that day.
 * Calendar and MiniCalendar also hold `weekOffset`, the weeks their grid was
 * moved from `date`'s month grid.
 *
 * Each view is opened in a leaf of the test's own and driven through its
 * toolbar's buttons; what it shows is read from its DOM and what it saves
 * from `getState`. Expected days are counted here from the vault's start
 * hour, apart from the plugin's code.
 *
 * "Start from the oldest overdue task" is turned off for the tests that do
 * not ask about it, so the vault's own overdue tasks do not move the window;
 * the overdue test turns it on with a filter on its own note. The settings
 * the tests change are put back in `afterAll`.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/viewed-date.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning } from '../helpers/cli-helper';
import { deleteTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import {
    PRELUDE, act, addDays, calendarLabel, closeViews, ev, goToDate, gridDays, monthGridStart, navigate,
    openUri, openView, readSettings, readView, restartView, saveSettings, setViewState, visualDay, type ViewReading,
} from '../helpers/view-helper';

const KEYS = ['startHour', 'pastDaysToShow', 'startFromOldestOverdue', 'weekStartDay'] as const;
type Settings = { startHour: number; pastDaysToShow: number; startFromOldestOverdue: boolean; weekStartDay: number };

let original: Settings;
let today: string;
let past: number;
let ws: number;

/** A day well away from today, so a fixed day cannot be mistaken for following. */
let FAR: string;

/** The day a grid reading starts on, as drawn. */
function drawnGridStart(r: ViewReading): string | undefined {
    return r.type === 'calendar-view' ? r.labels?.[0] : r.dates?.[0];
}

/** What a grid starting on `start` draws first. */
function expectedGridHead(type: string, start: string): string {
    return type === 'calendar-view' ? calendarLabel(start) : start;
}

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    const live = ev<boolean>(`(() => typeof app.plugins.plugins['obsidian-task-viewer'].viewEvents?.rollIfChanged === 'function')()`);
    if (!live) throw new Error('The Dev vault runs an older build: run `npm run build` and reload the plugin.');
    original = readSettings(KEYS) as unknown as Settings;
    saveSettings({ startFromOldestOverdue: false });
    today = visualDay(original.startHour);
    past = original.pastDaysToShow;
    ws = original.weekStartDay;
    FAR = addDays(today, 40);
});

afterAll(async () => {
    await closeViews();
    saveSettings({ ...original });
});

describe('Timeline', () => {
    it('opens following today, the past days before it', () => {
        const r = openView('tl', 'timeline-view');
        expect(r.state.date).toBeUndefined();
        expect(r.dates?.[0]).toBe(addDays(today, -past));
        expect(r.dates?.length).toBe(r.state.daysToShow);
    });

    it('moves a day with the arrows, fixing the day it looks at', () => {
        let r = navigate('tl', 'next');
        expect(r.state.date).toBe(addDays(today, 1));
        expect(r.dates?.[0]).toBe(addDays(today, 1 - past));
        r = navigate('tl', 'prev');
        r = navigate('tl', 'prev');
        expect(r.state.date).toBe(addDays(today, -1));
        expect(r.dates?.[0]).toBe(addDays(today, -1 - past));
    });

    it('follows today again on Now: the saved state has no date', () => {
        const r = navigate('tl', 'today');
        expect(r.state).not.toHaveProperty('date');
        expect(r.dates?.[0]).toBe(addDays(today, -past));
    });

    it('looks at the day picked in Go to date, the past days before it', () => {
        const r = goToDate('tl', FAR);
        expect(r.state.date).toBe(FAR);
        expect(r.dates?.[0]).toBe(addDays(FAR, -past));
    });
});

describe('Schedule', () => {
    it('opens following today', () => {
        const r = openView('sc', 'schedule-view');
        expect(r.state.date).toBeUndefined();
        expect(r.dates).toEqual([today]);
    });

    it('moves a day with the arrows and follows again on Now', () => {
        let r = navigate('sc', 'next');
        expect(r.state.date).toBe(addDays(today, 1));
        expect(r.dates).toEqual([addDays(today, 1)]);
        r = navigate('sc', 'prev');
        r = navigate('sc', 'prev');
        expect(r.state.date).toBe(addDays(today, -1));
        expect(r.dates).toEqual([addDays(today, -1)]);
        r = navigate('sc', 'today');
        expect(r.state).not.toHaveProperty('date');
        expect(r.dates).toEqual([today]);
    });

    it('looks at the day picked in Go to date', () => {
        const r = goToDate('sc', FAR);
        expect(r.state.date).toBe(FAR);
        expect(r.dates).toEqual([FAR]);
    });
});

describe.each([
    ['Calendar', 'calendar-view', 'ca'],
    ['MiniCalendar', 'mini-calendar-view', 'mc'],
])('%s', (_label, type, name) => {
    /** The grid drawn is the one starting on `start`. */
    function expectGrid(r: ViewReading, start: string): void {
        expect(r.gridStart).toBe(start);
        expect(drawnGridStart(r)).toBe(expectedGridHead(type, start));
        if (type === 'mini-calendar-view') expect(r.dates).toEqual(gridDays(start));
        else expect(r.labels).toEqual(gridDays(start).map(calendarLabel));
    }

    it("opens following today on today's month grid", () => {
        const r = openView(name, type);
        expect(r.state.date).toBeUndefined();
        expect(r.state.weekOffset).toBeUndefined();
        expectGrid(r, monthGridStart(today, ws));
        expect(r.today).toBe(true);
    });

    it('moves a week with the arrows: today is fixed in date, and only the offset moves', () => {
        const start = monthGridStart(today, ws);
        let r = navigate(name, 'next');
        expect(r.state).toMatchObject({ date: today, weekOffset: 1 });
        expectGrid(r, addDays(start, 7));
        r = navigate(name, 'prev');
        r = navigate(name, 'prev');
        expect(r.state).toMatchObject({ date: today, weekOffset: -1 });
        expectGrid(r, addDays(start, -7));
    });

    it('opens again where the weeks moved it, from the state it saved', () => {
        const before = readView(name);
        const r = restartView(name, `${name}-re`);
        expect(r.state).toEqual(before.state);
        expectGrid(r, addDays(monthGridStart(today, ws), -7));
    });

    it('follows today again on Today: the saved state has no date and no offset', () => {
        const r = navigate(name, 'today');
        expect(r.state).not.toHaveProperty('date');
        expect(r.state).not.toHaveProperty('weekOffset');
        expectGrid(r, monthGridStart(today, ws));
    });

    if (type === 'calendar-view') {
        it("looks at the picked day on Go to date: its month grid, no offset", () => {
            navigate(name, 'next');
            const r = goToDate(name, FAR);
            expect(r.state.date).toBe(FAR);
            expect(r.state).not.toHaveProperty('weekOffset');
            expectGrid(r, monthGridStart(FAR, ws));
        });
    }

    it('shows on a URI with date= the grid Go to date shows, and moves it by weekOffset=', () => {
        const r = openUri(`${name}-uri`, { view: type === 'calendar-view' ? 'calendar' : 'mini-calendar', date: FAR });
        expect(r.type).toBe(type);
        expect(r.state.date).toBe(FAR);
        expect(r.state).not.toHaveProperty('weekOffset');
        expectGrid(r, monthGridStart(FAR, ws));
        if (type === 'calendar-view') expect(r.state).toEqual(readView(name).state);

        const moved = openUri(`${name}-uri2`, { view: type === 'calendar-view' ? 'calendar' : 'mini-calendar', date: FAR, weekOffset: '-2' });
        expect(moved.state).toMatchObject({ date: FAR, weekOffset: -2 });
        expectGrid(moved, addDays(monthGridStart(FAR, ws), -14));
    });

    it('clears the offset when a state names only a date (a URI opened over the view)', () => {
        navigate(`${name}-uri2`, 'next');
        const r = setViewState(`${name}-uri2`, { date: FAR });
        expect(r.state.date).toBe(FAR);
        expect(r.state).not.toHaveProperty('weekOffset');
        expectGrid(r, monthGridStart(FAR, ws));
    });
});

describe('a restart', () => {
    /** Open a following and a fixed view of each type; the fixed one on `FAR` (Calendar: its month grid). */
    const VIEWS = [
        ['timeline-view', 'rs-tl'],
        ['schedule-view', 'rs-sc'],
        ['calendar-view', 'rs-ca'],
        ['mini-calendar-view', 'rs-mc'],
    ] as const;

    beforeAll(() => {
        for (const [type, name] of VIEWS) {
            openView(`${name}-follow`, type);
            openView(`${name}-fixed`, type, { date: FAR });
        }
    });

    it.each(VIEWS)('of %s keeps a fixed date and keeps following when it had none', (type, name) => {
        const fixedBefore = readView(`${name}-fixed`);
        const fixed = restartView(`${name}-fixed`, `${name}-fixed-2`);
        expect(fixedBefore.state.date).toBe(FAR);
        expect(fixed.state).toEqual(fixedBefore.state);
        if (type === 'timeline-view') expect(fixed.dates?.[0]).toBe(addDays(FAR, -past));
        if (type === 'schedule-view') expect(fixed.dates).toEqual([FAR]);
        if (type === 'calendar-view' || type === 'mini-calendar-view') {
            expect(fixed.gridStart).toBe(monthGridStart(FAR, ws));
            expect(drawnGridStart(fixed)).toBe(expectedGridHead(type, monthGridStart(FAR, ws)));
        }

        const follow = restartView(`${name}-follow`, `${name}-follow-2`);
        expect(follow.state).not.toHaveProperty('date');
        // Timeline's window may end before today (past days ≥ days shown); the others draw today.
        if (type === 'timeline-view') expect(follow.dates?.[0]).toBe(addDays(today, -past));
        else expect(follow.today).toBe(true);
    });
});

describe('a settings save', () => {
    it("moves Timeline's window at once by a new past days to show, and leaves a fixed day where it is", () => {
        openView('ss-follow', 'timeline-view');
        openView('ss-fixed', 'timeline-view', { date: FAR });
        try {
            saveSettings({ pastDaysToShow: past + 2 });
            const follow = readView('ss-follow');
            const fixed = readView('ss-fixed');
            expect(follow.state.date).toBeUndefined();
            expect(follow.dates?.[0]).toBe(addDays(today, -(past + 2)));
            expect(fixed.state.date).toBe(FAR);
            expect(fixed.dates?.[0]).toBe(addDays(FAR, -(past + 2)));
        } finally {
            saveSettings({ pastDaysToShow: past });
        }
        expect(readView('ss-follow').dates?.[0]).toBe(addDays(today, -past));
    });

    it("redraws a Calendar's month grid at once by a new week start, following or on a picked day", () => {
        openView('ss-ca', 'calendar-view');
        openView('ss-ca-fixed', 'calendar-view');
        goToDate('ss-ca-fixed', FAR);
        const other = ws === 0 ? 1 : 0;
        try {
            saveSettings({ weekStartDay: other });
            const r = readView('ss-ca');
            expect(r.gridStart).toBe(monthGridStart(today, other));
            expect(r.labels?.[0]).toBe(calendarLabel(monthGridStart(today, other)));
            // The picked day's month grid stays that month's grid: its top row holds the 1st.
            const fixed = readView('ss-ca-fixed');
            expect(fixed.state.date).toBe(FAR);
            expect(fixed.gridStart).toBe(monthGridStart(FAR, other));
            expect(fixed.labels?.slice(0, 7)).toContain(`${FAR.slice(0, 8)}01`);
        } finally {
            saveSettings({ weekStartDay: ws });
        }
        expect(readView('ss-ca-fixed').gridStart).toBe(monthGridStart(FAR, ws));
    });
});

describe('a day roll', () => {
    /**
     * The visual day is moved by the start hour: set in memory to an hour
     * still ahead (or to 0 before the start hour), today becomes another
     * day, and `ViewEvents.rollIfChanged` — what the minute clock calls —
     * tells the views. The start hour is put back in the same call.
     */
    const now = new Date();
    const h = now.getHours();

    it.skipIf(h >= 22 && now.getMinutes() >= 50)('moves the following views to the new today and leaves the fixed ones', () => {
        const startHour = original.startHour;
        const rolledHour = h < startHour ? 0 : Math.min(h + 2, 23);
        const rolledToday = visualDay(rolledHour, now);
        expect(rolledToday).not.toBe(today);

        const pairs = [
            ['timeline-view', 'dr-tl'],
            ['schedule-view', 'dr-sc'],
            ['calendar-view', 'dr-ca'],
            ['mini-calendar-view', 'dr-mc'],
        ] as const;
        for (const [type, name] of pairs) {
            openView(`${name}-follow`, type);
            openView(`${name}-fixed`, type, { date: FAR });
        }

        const names = pairs.flatMap(([, name]) => [`${name}-follow`, `${name}-fixed`]);
        const rolled = ev<Record<string, ViewReading>>(`(async () => {
            ${PRELUDE}
            const events = P.viewEvents;
            P.settings.startHour = ${rolledHour};
            try {
                if (!events.rollIfChanged()) throw new Error('the day did not roll');
                await wait(700);
                return JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map(n => [n, read(n)])));
            } finally {
                P.settings.startHour = ${startHour};
                events.rollIfChanged();
                await wait(700);
            }
        })()`);

        expect(rolled['dr-tl-follow'].state.date).toBeUndefined();
        expect(rolled['dr-tl-follow'].dates?.[0]).toBe(addDays(rolledToday, -past));
        expect(rolled['dr-sc-follow'].dates).toEqual([rolledToday]);
        expect(rolled['dr-ca-follow'].gridStart).toBe(monthGridStart(rolledToday, ws));
        expect(rolled['dr-mc-follow'].gridStart).toBe(monthGridStart(rolledToday, ws));

        expect(rolled['dr-tl-fixed'].state.date).toBe(FAR);
        expect(rolled['dr-tl-fixed'].dates?.[0]).toBe(addDays(FAR, -past));
        expect(rolled['dr-sc-fixed'].dates).toEqual([FAR]);
        expect(rolled['dr-ca-fixed'].gridStart).toBe(monthGridStart(FAR, ws));
        expect(rolled['dr-mc-fixed'].gridStart).toBe(monthGridStart(FAR, ws));

        // And back: the start hour restored, the following views are on today again.
        expect(readView('dr-sc-follow').dates).toEqual([today]);
        expect(readView('dr-tl-follow').dates?.[0]).toBe(addDays(today, -past));
    });
});

describe('the oldest overdue pull (S2)', () => {
    const FILE = 'test-int-viewed-date-overdue.md';
    let overdue: string;
    const filterState = () => ({ logic: 'and', filters: [{ property: 'file', operator: 'includes', value: [FILE] }] });

    beforeAll(async () => {
        overdue = addDays(today, -(past + 5));
        expect(await writeIndexedTestFile(FILE, `- [ ] 超過のタスク @${overdue}>>${overdue}\n`)).toBe(true);
    });

    afterAll(async () => {
        saveSettings({ startFromOldestOverdue: false });
        deleteTestFile(FILE);
        await waitForFileDeindexed(FILE);
    });

    it("starts a following Timeline's window at the oldest overdue day and leaves a fixed day alone", () => {
        for (const name of ['od-follow', 'od-fixed']) {
            openView(name, 'timeline-view', name === 'od-fixed' ? { date: today } : {});
            act(name, `V(${JSON.stringify(name)}).store.update({ filterState: ${JSON.stringify(filterState())} });`);
        }
        saveSettings({ startFromOldestOverdue: true });

        const follow = readView('od-follow');
        expect(follow.state.date).toBeUndefined();
        expect(follow.dates?.[0]).toBe(overdue);

        const fixed = readView('od-fixed');
        expect(fixed.state.date).toBe(today);
        expect(fixed.dates?.[0]).toBe(addDays(today, -past));

        // Today puts the fixed one back to following, pulled to the overdue day.
        const now = navigate('od-fixed', 'today');
        expect(now.state).not.toHaveProperty('date');
        expect(now.dates?.[0]).toBe(overdue);

        // An arrow from the pulled window moves it a day without a jump.
        const next = navigate('od-follow', 'next');
        expect(next.dates?.[0]).toBe(addDays(overdue, 1));
        expect(next.state.date).toBe(addDays(overdue, 1 + past));
    });
});
