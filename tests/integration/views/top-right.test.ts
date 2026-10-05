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
 * How much of it shows is read by narrowing the view's own content to a width
 * (its leaf is the test's, so no pane of the vault is resized): each unit
 * of the top right (`task-card__time-unit`; the end, `>11:00`, is one) shows
 * whole or not at all, and the end shows exactly when it fits.
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
import { PRELUDE, SETTLE_MS, addDays, closeViews, ev, openView, setViewState } from '../helpers/view-helper';

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

/** How the top right of one card shows: its box, and each unit's width and how much of it is in the box. */
interface Fit {
    name: string;
    box: number;
    units: Array<{ text: string; width: number; seen: 'whole' | 'none' | 'part' }>;
}

/**
 * The top rights of the test's cards in `view`, with its content (or each of
 * its cards, where the view keeps a least width) narrowed to `width` (null
 * puts it back). A unit is seen whole when its box is inside
 * the top right's, none when it is outside it (the second line), else part.
 */
function fits(view: string, width: number | null, narrow: 'content' | 'cards' = 'content'): Fit[] {
    const w = width === null ? "''" : `'${width}px'`;
    return ev<Fit[]>(`(async () => {
        ${PRELUDE}
        const el = V(${JSON.stringify(view)}).contentEl;
        if (${JSON.stringify(narrow)} === 'content') el.style.width = ${w};
        else for (const card of el.querySelectorAll('.task-card')) card.style.width = ${w};
        await wait(${SETTLE_MS});
        const out = [];
        for (const box of el.querySelectorAll('.task-card > .task-card__time')) {
            const name = (box.parentElement.querySelector('.task-card__content')?.textContent ?? '').match(/tr-[a-z0-9]+/)?.[0];
            if (!name) continue;
            const b = box.getBoundingClientRect();
            const units = [...box.querySelectorAll(':scope > .task-card__time-unit')].map(u => {
                const r = u.getBoundingClientRect();
                const inside = r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5;
                const outside = r.top >= b.bottom - 0.5 || r.right <= b.left || r.left >= b.right;
                return { text: u.textContent, width: r.width, seen: inside ? 'whole' : outside ? 'none' : 'part' };
            });
            out.push({ name, box: b.width, units });
        }
        return JSON.stringify(out);
    })()`);
}

/**
 * Each unit shows whole or not at all, the first always (cut when it alone
 * is wider than the box); one after the first
 * shows exactly when it and those before it fit in the box, and once one does
 * not, none after it shows. Returns whether the end of `name` showed, per card.
 */
function expectFits(r: Fit[], name: string): boolean[] {
    const ends: boolean[] = [];
    for (const card of r) {
        // The first stays on the line, cut only when it alone is wider than the box.
        expect(card.units[0].seen, JSON.stringify(card)).toBe(card.units[0].width <= card.box + 0.5 ? 'whole' : 'part');
        let used = card.units[0].width;
        let dropped = false;
        for (const unit of card.units.slice(1)) {
            used += unit.width;
            const shows = !dropped && used <= card.box + 0.5;
            expect(unit.seen, JSON.stringify(card)).toBe(shows ? 'whole' : 'none');
            if (!shows) dropped = true;
        }
        if (card.name === name) ends.push(card.units[1]?.seen === 'whole');
    }
    return ends;
}

describe('the end shows whenever it fits, and never cut', () => {
    it('in Timeline, from two days wide to seven days narrow', () => {
        openView('tr-fit-tl', 'timeline-view', { date: DAY, daysToShow: 2, showSidebar: false });
        expect(expectFits(fits('tr-fit-tl', 400), 'tr-1011')).toEqual([true]);
        setViewState('tr-fit-tl', { date: DAY, daysToShow: 7, showSidebar: false });
        const seen = [1400, 900, 600, 400].map(w => expectFits(fits('tr-fit-tl', w), 'tr-1011')[0]);
        // 10:00>11:00 needs about 70 px: a seventh of 900 px has it, of 400 px not.
        expect(seen[1]).toBe(true);
        expect(seen[3]).toBe(false);
        fits('tr-fit-tl', null);
    });

    it("in Calendar's cards of a day, at a pane's width and a phone's", () => {
        openView('tr-fit-cal', 'calendar-view', { date: DAY, showSidebar: false });
        const seen = [900, 560, 412, 300].map(w => expectFits(fits('tr-fit-cal', w), 'tr-1011')[0]);
        expect(seen[0]).toBe(true);
        expect(seen[3]).toBe(false);
        fits('tr-fit-cal', null);
    });

    it('in Schedule, beside another card and not', () => {
        openView('tr-fit-sc', 'schedule-view', { date: DAY });
        // At 300 px tr-1011 shares its hour with tr-at10, in half of it.
        const seen = [null, 300].map(w => expectFits(fits('tr-fit-sc', w), 'tr-1011')[0]);
        expect(seen).toEqual([true, false]);
    });

    it("in a Kanban cell, whose fields after the times go whole with the end", () => {
        openView('tr-fit-kb', 'kanban-view', { grid: [[list('tr-fit-kb', ['times', 'tags'])]] });
        const wide = fits('tr-fit-kb', 600).filter(c => c.name === 'tr-1011');
        expect(wide.map(c => c.units.map(u => u.text))).toEqual([['10:00', '>11:00', `#${TAG}`]]);
        expectFits(wide, 'tr-1011');
        // A cell keeps a least width, so its cards are narrowed.
        // At 110 px the times fit (67 px of 98) and the tag after them does not;
        // at 70 px the end does not either.
        const shown = [600, 110, 70].map(w => {
            const r = fits('tr-fit-kb', w, 'cards');
            expectFits(r, 'tr-1011');
            return r.find(c => c.name === 'tr-1011')?.units.map(u => u.seen);
        });
        expect(shown).toEqual([['whole', 'whole', 'whole'], ['whole', 'whole', 'none'], ['whole', 'none', 'none']]);
        fits('tr-fit-kb', null, 'cards');
    });
});
