/**
 * What a card's top right says, in the running Dev vault: the dates the note
 * states, as written (the line's, and what its section gives it), never a
 * value the rules fill in. A pinned list and a Kanban cell show the fields
 * of their display label; Timeline, Calendar's cards of a day and Schedule
 * show the stated times (`10:00>11:00`).
 *
 * The tasks are in April 2027, in a note of the test's own; the views are
 * opened on that day. A card is found by the name its text starts with, and
 * its top right read from `.task-card__time` (null when it has none).
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/top-right.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning } from '../helpers/cli-helper';
import { deleteTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import { PRELUDE, SETTLE_MS, addDays, closeViews, ev, openView } from '../helpers/view-helper';

const FILE = 'test-int-top-right.md';
const DAY = '2027-04-14';
const NEXT = addDays(DAY, 1);
const AFTER_NEXT = addDays(DAY, 2);
const TAG = 'tvtopright';

const NOTE = [
    '## Plain',
    `- [ ] tr-allday #${TAG} @${DAY}`,
    `- [ ] tr-at10 #${TAG} @${DAY}T10:00`,
    `- [ ] tr-range #${TAG} @${DAY}>${AFTER_NEXT}`,
    `- [ ] tr-1011 #${TAG} @${DAY}T10:00>11:00`,
    `- [ ] tr-split #${TAG} @${DAY}T22:00>${NEXT}T08:00`,
    '## Morning',
    '- tv-start:: 06:00',
    `- [ ] tr-inherit #${TAG} @${DAY}`,
    '',
].join('\n');

/** The tops right of the cards of each task in `view`, by name; `pinned` reads the pinned lists' cards, else the view's own. */
function tops(view: string, pinned = false): Record<string, Array<string | null>> {
    return ev(`(async () => {
        ${PRELUDE}
        await wait(${SETTLE_MS});
        const el = V(${JSON.stringify(view)}).contentEl;
        const out = {};
        for (const card of el.querySelectorAll('.task-card')) {
            if (!!card.closest('.tv-sidebar__pinned-lists, .pinned-list') !== ${pinned}) continue;
            const text = card.querySelector('.task-card__content')?.textContent ?? '';
            const name = text.match(/tr-[a-z0-9]+/)?.[0];
            if (!name) continue;
            (out[name] ??= []).push(card.querySelector(':scope > .task-card__time')?.textContent ?? null);
        }
        return JSON.stringify(out);
    })()`);
}

/** A list of the test's tasks, showing `fields` at its top right. */
function list(id: string, fields: string[]) {
    return {
        id,
        name: id,
        filterState: { logic: 'and', filters: [{ property: 'tag', operator: 'includes', value: [TAG] }] },
        applyViewFilter: false,
        topRight: { fields, separator: '' },
    };
}

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    expect(await writeIndexedTestFile(FILE, NOTE)).toBe(true);
});

afterAll(async () => {
    await closeViews();
    deleteTestFile(FILE);
    await waitForFileDeindexed(FILE);
});

describe('a pinned list and a Kanban cell show the stated dates', () => {
    it('shows no end the rules fill in, and the end a line writes', () => {
        openView('tr-pl', 'timeline-view', { date: DAY, showSidebar: true, pinnedLists: [list('tr-end', ['end'])] });
        const r = tops('tr-pl', true);
        expect(r['tr-allday']).toEqual([null]);
        expect(r['tr-at10']).toEqual([null]);
        expect(r['tr-range']).toEqual([AFTER_NEXT]);
        expect(r['tr-1011']).toEqual(['11:00']);
        expect(r['tr-split']).toEqual([`${NEXT} 08:00`]);
        expect(r['tr-inherit']).toEqual([null]);
    });

    it('shows no start time for a bare date, and the start time a section gives', () => {
        openView('tr-pl', 'timeline-view', { date: DAY, showSidebar: true, pinnedLists: [list('tr-st', ['startTime'])] });
        const r = tops('tr-pl', true);
        expect(r['tr-allday']).toEqual([null]);
        expect(r['tr-range']).toEqual([null]);
        expect(r['tr-at10']).toEqual(['10:00']);
        expect(r['tr-inherit']).toEqual(['06:00']);
    });

    it('shows the same in a Kanban cell', () => {
        openView('tr-kb', 'kanban-view', { grid: [[list('tr-kb-end', ['end']), list('tr-kb-st', ['startTime'])]] });
        const cells = ev<Array<Record<string, string | null>>>(`(async () => {
            ${PRELUDE}
            await wait(${SETTLE_MS});
            const el = V('tr-kb').contentEl;
            return JSON.stringify([...el.querySelectorAll('.kanban-view__cell')].map(cell => {
                const out = {};
                for (const card of cell.querySelectorAll('.task-card')) {
                    const name = (card.querySelector('.task-card__content')?.textContent ?? '').match(/tr-[a-z0-9]+/)?.[0];
                    if (name) out[name] = card.querySelector(':scope > .task-card__time')?.textContent ?? null;
                }
                return out;
            }));
        })()`);
        expect(cells).toHaveLength(2);
        expect(cells[0]).toMatchObject({ 'tr-allday': null, 'tr-at10': null, 'tr-range': AFTER_NEXT, 'tr-1011': '11:00' });
        expect(cells[1]).toMatchObject({ 'tr-allday': null, 'tr-at10': '10:00', 'tr-inherit': '06:00' });
    });
});

describe('the dated views show the stated times', () => {
    it('Timeline shows the start time a section gives, and the times of both segments of a split task', () => {
        openView('tr-tl', 'timeline-view', { date: DAY, daysToShow: 4, showSidebar: false });
        const r = tops('tr-tl');
        expect(r['tr-inherit']).toEqual(['06:00']);
        expect(r['tr-1011']).toEqual(['10:00>11:00']);
        expect(r['tr-at10']).toEqual(['10:00']);
        expect(r['tr-allday']).toEqual([null]);
        expect(r['tr-split']).toEqual(['22:00>08:00', '22:00>08:00']);
    });

    it("Calendar shows the start time on a day's card and nothing on an all-day one", () => {
        openView('tr-cal', 'calendar-view', { date: DAY, showSidebar: false });
        const r = tops('tr-cal');
        expect(r['tr-at10']).toEqual(['10:00']);
        expect(r['tr-allday']).toEqual([null]);
        expect(r['tr-inherit']).toEqual(['06:00']);
    });

    it('Schedule shows the start time a section gives', () => {
        openView('tr-sc', 'schedule-view', { date: DAY });
        const r = tops('tr-sc');
        expect(r['tr-inherit']).toEqual(['06:00']);
        expect(r['tr-1011']).toEqual(['10:00>11:00']);
    });
});
