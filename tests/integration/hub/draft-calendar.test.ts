/**
 * The hub on a task not written yet opened from a Calendar's day, in the
 * running E2E vault, by the right click a person gives (through Electron, as
 * the OS sends the mouse): what is under the point pressed decides what the
 * press opens.
 *
 * - The day's empty space is its whole column but the day's date and its
 *   cards: beside a card in its track, low in a week with no cards down to
 *   the row's bottom, left of the date in the first track, and on a day
 *   outside the month; in the day's column under its date, with the week
 *   numbers shown or not. The moon
 *   phase takes the press itself, for its tooltip, and opens the same menu.
 *   Its menu offers the two creates alone; each opens the hub on the
 *   day pressed, with no time, Create Task for Daily Note in that day's
 *   daily note, which the create writes the line in.
 * - The date opens no menu of the day's; a card opens its own; the week
 *   number's column, its number and the row under it, opens none.
 *
 * The month is far off (2031-01) and its daily notes are not made but by the
 * create, whose note is deleted after.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open,
 *     its daily notes at the vault's root as YYYY-MM-DD, with no template
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/draft-calendar.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { overrideSettings, tr, type HeldSettings } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { MENUS } from '../helpers/menus';
import { DIALOG_ROWS } from '../helpers/dialog-rows';
import { DRAFT_HUB } from '../helpers/draft-hub';
import { REAL_INPUT } from '../helpers/real-input';

/** The day the Calendar is opened on; its week's Tuesday has a card. */
const DAY = '2031-01-22';
const CARD_DAY = '2031-01-14';
/** A day with no card in the card's week. */
const BESIDE_CARD = '2031-01-16';
/** A day of a week with no cards. */
const EMPTY_WEEK = '2031-01-28';
const TEST_FILE = 'test-int-draft-calendar.md';
const CARD = '暦のカード';
const NOTE = [`- [ ] ${CARD} @${CARD_DAY}`, ''].join('\n');

const FOR_DAILY = tr('menu.createTaskForDailyNote');
const IN_NOTE = tr('menu.createTaskInNote');

const PRELUDE = `
${UNTIL}
${DIALOG_ROWS}
${MENUS}
${DRAFT_HUB}
${REAL_INPUT}
const start = which => dateInput(${JSON.stringify(tr('modal.start'))}, which).value;
/** The Calendar on DAY, the moon phase shown, its leaf kept to be closed after. */
const calendar = async () => {
    const leaf = app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: 'calendar-view', state: { date: ${JSON.stringify(DAY)}, astronomyDisplay: { moonPhase: true } }, active: true });
    R.leaves.cal = leaf;
    const card = () => [...leaf.view.contentEl.querySelectorAll('.cal-week-row > .task-card')].find(c => c.textContent.includes(${JSON.stringify(CARD)}));
    await until(() => card() && leaf.view.contentEl.querySelector('.moon-phase-inline'));
    return leaf;
};
const space = (leaf, day) => leaf.view.contentEl.querySelector('.cal-day-space[data-date="' + day + '"]');
const headerOf = (leaf, day) => space(leaf, day).nextElementSibling;
/** \`press\`'s offsets for the middle of \`target\`, pressed on \`el\`. */
const toMiddleOf = (el, target) => {
    const a = el.getBoundingClientRect(), b = target.getBoundingClientRect();
    return { dx: (b.left + b.width / 2) - (a.left + a.width / 2), dy: (b.top + b.height / 2) - (a.top + a.height / 2) };
};
/**
 * A point 6 px above \`row\`'s bottom, in the column of \`header\` (a day's
 * header, drawn in its column whatever the space is): where it is, and
 * \`press\`'s offsets for it on \`row\`.
 */
const lowInColumnOf = (row, header) => {
    row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rr = row.getBoundingClientRect(), hr = header.getBoundingClientRect();
    const x = Math.round(hr.left + hr.width / 2), y = Math.round(rr.bottom - 6);
    return { x, y, offsets: { dx: x - (rr.left + rr.width / 2), dy: y - (rr.top + rr.height / 2) } };
};
/** Right-click as a person does, and wait for the browser's contextmenu to have been sent and heard. */
const rightClick = async (el, at = {}) => {
    plugin.menuPresenter.dismiss();
    let heard = 0;
    const hear = () => { heard++; };
    window.addEventListener('contextmenu', hear, true);
    try {
        await press(el, { ...at, button: 'right' });
        // Heard as it is sent, before the listeners under it run in the same dispatch.
        await until(() => heard > 0);
    } finally {
        window.removeEventListener('contextmenu', hear, true);
    }
    return menuTitles();
};
/** Wait for the hub opened on Create Task for Daily Note; what it holds. */
const openedForDaily = async () => {
    await until(() => nameInput() && document.activeElement === nameInput());
    await until(() => lineSays().length > 0);
    return { start: { date: start('date'), time: start('time') }, line: lineSays() };
};
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

interface Opened {
    start: { date: string; time: string };
    line: string[];
}

/** The hub Create Task for Daily Note opens on `day`: the day alone, the line going to its daily note. */
function forDaily(day: string): Opened {
    return {
        start: { date: day, time: '' },
        line: [`tv-form__info: ${tr('modal.newTask.toNew', { note: `${day}.md`, heading: 'Tasks' })}`],
    };
}

let held: HeldSettings<'calendarShowWeekNumbers'> | undefined;
let made: string | null = null;

beforeAll(async () => {
    // Focus moves and the input sent need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
    held = overrideSettings({ calendarShowWeekNumbers: true });
    await writeIndexedTestFile(TEST_FILE, NOTE);
});

afterEach(async () => {
    // A hub closing keeps its backdrop over the view until it has gone, and a press would land on it.
    run<boolean>(`await cleanUpHubs(); await until(() => !document.querySelector('.tv-overlay'), 5000); return "true";`);
    if (made) {
        deleteTestFile(made);
        await waitForFileDeindexed(made);
        made = null;
    }
});

afterAll(async () => {
    held?.restore();
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe("a Calendar's day, right-clicked where neither its date nor a card is", () => {
    it('offers the two creates alone, beside a card in its track: Create Task for Daily Note opens on the day', () => {
        const steps = run<{ titles: string[]; opened: Opened }>(`
            const leaf = await calendar();
            const theCard = [...leaf.view.contentEl.querySelectorAll('.cal-week-row > .task-card')].find(c => c.textContent.includes(${JSON.stringify(CARD)}));
            const el = space(leaf, ${JSON.stringify(BESIDE_CARD)});
            // Level with the card, in its track, on the next-but-one day.
            const titles = await rightClick(el, { dy: toMiddleOf(el, theCard).dy });
            await pick(${JSON.stringify(FOR_DAILY)});
            return JSON.stringify({ titles, opened: await openedForDaily() });
        `);
        expect(steps.titles).toEqual([FOR_DAILY, IN_NOTE]);
        expect(steps.opened).toEqual(forDaily(BESIDE_CARD));
    });

    it('opens on the day low in a week with no cards, where the row is under no track of cards', () => {
        const steps = run<{ onSpace: boolean; opened: Opened }>(`
            const leaf = await calendar();
            const el = space(leaf, ${JSON.stringify(EMPTY_WEEK)});
            const row = el.closest('.cal-week-row');
            if (row.querySelector('.task-card')) throw new Error('the week has a card');
            const at = lowInColumnOf(row, headerOf(leaf, ${JSON.stringify(EMPTY_WEEK)}));
            const onSpace = document.elementFromPoint(at.x, at.y) === el;
            await rightClick(row, at.offsets);
            await pick(${JSON.stringify(FOR_DAILY)});
            return JSON.stringify({ onSpace, opened: await openedForDaily() });
        `);
        expect(steps.onSpace).toBe(true);
        expect(steps.opened).toEqual(forDaily(EMPTY_WEEK));
    });

    it('opens on the day under its date with the week numbers not shown, the days in the row\'s first columns', () => {
        const hidden = overrideSettings({ calendarShowWeekNumbers: false });
        try {
            const steps = run<{ numbers: number; onSpace: boolean; opened: Opened }>(`
                const leaf = await calendar();
                const el = space(leaf, ${JSON.stringify(EMPTY_WEEK)});
                const row = el.closest('.cal-week-row');
                const at = lowInColumnOf(row, headerOf(leaf, ${JSON.stringify(EMPTY_WEEK)}));
                const onSpace = document.elementFromPoint(at.x, at.y) === el;
                await rightClick(row, at.offsets);
                await pick(${JSON.stringify(FOR_DAILY)});
                return JSON.stringify({ numbers: row.querySelectorAll('.cal-week-number').length, onSpace, opened: await openedForDaily() });
            `);
            expect(steps.numbers).toBe(0);
            expect(steps.onSpace).toBe(true);
            expect(steps.opened).toEqual(forDaily(EMPTY_WEEK));
        } finally {
            hidden.restore();
        }
    });

    it('opens on the day left of its date in the first track', () => {
        const steps = run<Opened>(`
            const leaf = await calendar();
            const el = space(leaf, ${JSON.stringify(DAY)});
            // Near the column's left edge, level with the date.
            const r = el.getBoundingClientRect();
            await rightClick(el, { dx: -r.width / 2 + 8, dy: toMiddleOf(el, headerOf(leaf, ${JSON.stringify(DAY)})).dy });
            await pick(${JSON.stringify(FOR_DAILY)});
            return JSON.stringify(await openedForDaily());
        `);
        expect(steps).toEqual(forDaily(DAY));
    });

    it('opens on the day on its moon phase, which takes the press itself and keeps its tooltip', () => {
        const steps = run<{ onMoon: boolean; tooltip: string | null; titles: string[]; opened: Opened }>(`
            const leaf = await calendar();
            const moon = headerOf(leaf, ${JSON.stringify(DAY)}).querySelector('.moon-phase-inline');
            const m = moon.getBoundingClientRect();
            const onMoon = moon.contains(document.elementFromPoint(m.left + m.width / 2, m.top + m.height / 2));
            const titles = await rightClick(moon);
            await pick(${JSON.stringify(FOR_DAILY)});
            return JSON.stringify({ onMoon, tooltip: moon.getAttribute('aria-label'), titles, opened: await openedForDaily() });
        `);
        expect(steps.onMoon).toBe(true);
        expect(steps.tooltip).toMatch(/\d+%$/);
        expect(steps.titles).toEqual([FOR_DAILY, IN_NOTE]);
        expect(steps.opened).toEqual(forDaily(DAY));
    });

    it('opens on a day outside the month as on one in it', () => {
        const steps = run<{ day: string; opened: Opened }>(`
            const leaf = await calendar();
            const el = leaf.view.contentEl.querySelector('.cal-week-row .cal-day-space');
            if (!el.nextElementSibling.classList.contains('is-outside-month')) throw new Error('the first day is in the month');
            await rightClick(el);
            await pick(${JSON.stringify(FOR_DAILY)});
            return JSON.stringify({ day: el.dataset.date, opened: await openedForDaily() });
        `);
        expect(steps.day.startsWith('2030-12-')).toBe(true);
        expect(steps.opened).toEqual(forDaily(steps.day));
    });

    it('Create Task in a Note opens on the day, no note named', () => {
        const steps = run<{ date: string; time: string; note: string }>(`
            const leaf = await calendar();
            await rightClick(space(leaf, ${JSON.stringify(BESIDE_CARD)}));
            await pick(${JSON.stringify(IN_NOTE)});
            await until(() => draft() && noteInput() && document.activeElement === noteInput());
            return JSON.stringify({ date: start('date'), time: start('time'), note: noteInput().value });
        `);
        expect(steps).toEqual({ date: BESIDE_CARD, time: '', note: '' });
    });

    it('Create Task for Daily Note writes the line in the daily note of the day pressed', () => {
        made = `${EMPTY_WEEK}.md`;
        run<boolean>(`
            const leaf = await calendar();
            await rightClick(space(leaf, ${JSON.stringify(EMPTY_WEEK)}));
            await pick(${JSON.stringify(FOR_DAILY)});
            await openedForDaily();
            typeIn(nameInput(), '暦から作る');
            create();
            await until(() => !draft() && app.vault.getAbstractFileByPath(${JSON.stringify(made)}), 5000, () => lineSays().join('|'));
            return 'true';
        `);
        const lines = readTestFile(made).split('\n').filter(l => l.includes('暦から作る'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(new RegExp(`^- \\[ \\] 暦から作る .*@${EMPTY_WEEK}`));
    });
});

describe("a Calendar's day, right-clicked on what is not its empty space", () => {
    it("opens no menu of the day's on its date, its card's own on a card, and none on the week number's column", () => {
        const steps = run<Record<string, string[]>>(`
            const leaf = await calendar();
            const out = {};
            out.date = await rightClick(headerOf(leaf, ${JSON.stringify(DAY)}).querySelector('.cal-day-cell__date-label'));
            const theCard = [...leaf.view.contentEl.querySelectorAll('.cal-week-row > .task-card')].find(c => c.textContent.includes(${JSON.stringify(CARD)}));
            out.card = await rightClick(theCard);
            const row = space(leaf, ${JSON.stringify(EMPTY_WEEK)}).closest('.cal-week-row');
            const number = row.querySelector('.cal-week-number');
            out.weekNumber = await rightClick(number);
            const rr = row.getBoundingClientRect(), nr = number.getBoundingClientRect();
            // Under the week number, in its column.
            out.underWeekNumber = await rightClick(row, { dx: (nr.left + nr.width / 2) - (rr.left + rr.width / 2), dy: rr.height / 2 - 10 });
            plugin.menuPresenter.dismiss();
            return JSON.stringify(out);
        `);
        expect(steps.date).not.toContain(FOR_DAILY);
        expect(steps.card).toContain(tr('menu.addChildTask'));
        expect(steps.card).not.toContain(FOR_DAILY);
        expect(steps.weekNumber).not.toContain(FOR_DAILY);
        expect(steps.underWeekNumber).toEqual([]);
    });
});
