/**
 * The lanes of dated cards, in the running Dev vault: Calendar's week rows
 * and Timeline's all-day row. A task of several days is drawn as a bar in
 * the columns of its days, cut at each edge of a row (a week, the window)
 * with the cut marked on the side it continues; a bar is moved by its move
 * handle and stretched by its resize handle, which writes the new days to
 * the note.
 *
 * A card is read from its DOM (`dataset.colStart`, `dataset.span`, its
 * classes), not by the scope of its key. A drag is made of pointer events
 * as the user's would be: a press on the card selects it and shows its
 * handles, then a press on a handle, moves over the day aimed at, and a
 * release there. The view is the active tab, so the days have a place on
 * screen to aim at.
 *
 * The tasks are in March 2027, in a note of the test's own; the days each
 * view should draw are counted here from the vault's week start and past
 * days.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/lanes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning } from '../helpers/cli-helper';
import { deleteTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import {
    PRELUDE, addDays, closeViews, ev, gridDays, monthGridStart, openView, readSettings,
} from '../helpers/view-helper';

const FILE = 'test-int-lanes.md';

/** The tasks, by a name their text starts with: the first and the last day they are drawn on. */
const TASKS: Record<string, [string, string]> = {
    'lane-alpha': ['2027-03-09', '2027-03-10'],
    'lane-bravo': ['2027-03-12', '2027-03-15'],
    'lane-charlie': ['2027-03-06', '2027-03-08'],
    // Calendar's drags.
    'lane-delta': ['2027-03-23', '2027-03-24'],
    'lane-echo': ['2027-03-23', '2027-03-24'],
    // Timeline's drags.
    'lane-foxtrot': ['2027-03-10', '2027-03-11'],
    'lane-golf': ['2027-03-10', '2027-03-11'],
};

/**
 * The days written for a task drawn from `first` to `last`. An all-day
 * task's end is written as the day after its last (`@first>end`, the end
 * not counted: DisplayTaskConverter).
 */
function written(first: string, last: string): { start: string; end: string } {
    return { start: first, end: addDays(last, 1) };
}

const NOTE = Object.entries(TASKS).map(([name, [s, e]]) => {
    const w = written(s, e);
    return `- [ ] ${name} @${w.start}>${w.end}`;
}).join('\n') + '\n';

interface Bar {
    /** The week row's first day (Calendar); null in Timeline. */
    week: string | null;
    colStart: number;
    span: number;
    multi: boolean;
    before: boolean;
    after: boolean;
}

/** The days between two days, `b` after `a` counting positive. */
function diff(a: string, b: string): number {
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** The bars a task drawn on days [s, e] makes in rows starting on `rowStarts`, each `len` days; a row counts its columns from 1. */
function expectedBars(s: string, e: string, rowStarts: string[], len: number, week: boolean): Bar[] {
    const bars: Bar[] = [];
    for (const rs of rowStarts) {
        const re = addDays(rs, len - 1);
        if (e < rs || s > re) continue;
        const from = s < rs ? rs : s;
        const to = e > re ? re : e;
        bars.push({
            week: week ? rs : null,
            colStart: diff(rs, from) + 1,
            span: diff(from, to) + 1,
            multi: true,
            before: s < rs,
            after: e > re,
        });
    }
    return bars;
}

/** The bars of the task `name` in the view `view`, row by row. */
function bars(view: string, name: string): Bar[] {
    return ev<Bar[]>(`(async () => {
        ${PRELUDE}
        const el = V(${JSON.stringify(view)}).contentEl;
        const cards = [...el.querySelectorAll('.cal-week-row .task-card, .allday-section .task-card')]
            .filter(c => !c.closest('.tv-sidebar__pinned-lists'))
            .filter(c => (c.querySelector('.task-card__content')?.textContent ?? c.textContent).includes(${JSON.stringify(name)}));
        return JSON.stringify(cards.map(c => ({
            week: c.closest('.cal-week-row')?.dataset.weekStart ?? null,
            colStart: Number(c.dataset.colStart),
            span: Number(c.dataset.span),
            multi: c.classList.contains('task-card--multi-day'),
            before: c.classList.contains('task-card--split-continues-before'),
            after: c.classList.contains('task-card--split-continues-after'),
        })).sort((a, b) => (a.week ?? '').localeCompare(b.week ?? '')));
    })()`);
}

/** The days the index holds for the task `name`. */
function days(name: string): { start: string | null; end: string | null } {
    return ev(`(() => {
        const t = app.plugins.plugins['obsidian-task-viewer'].getIndex().getTasks()
            .find(t => t.file === ${JSON.stringify(FILE)} && t.content.startsWith(${JSON.stringify(name)}));
        return JSON.stringify({ start: t?.startDate ?? null, end: t?.endDate ?? null });
    })()`);
}

/**
 * Drag a handle of the bar of `name` in `view` to the day `to`: select the
 * card, press the handle (`handle`: its class modifier), move over the
 * point `aim` finds for the day, and release there. Returns what was found,
 * for the failure message.
 */
function drag(view: string, name: string, handle: string, to: string, aim: string): string {
    return ev<string>(`(async () => {
        ${PRELUDE}
        const el = V(${JSON.stringify(view)}).contentEl;
        const card = [...el.querySelectorAll('.cal-week-row .task-card, .allday-section .task-card')]
            .find(c => (c.querySelector('.task-card__content')?.textContent ?? c.textContent).includes(${JSON.stringify(name)}));
        if (!card) throw new Error('no card ' + ${JSON.stringify(name)});
        card.scrollIntoView({ block: 'center' });
        await wait(200);
        const center = (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
        const fire = (type, target, p) => target.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y,
            pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
        }));
        // Select: a press on the card's body shows its handles.
        const body = card.querySelector('.task-card__content') ?? card;
        const c = center(body);
        fire('pointerdown', body, c);
        fire('pointerup', document, c);
        await wait(300);
        const btn = card.querySelector('.task-card__handle--${handle} .task-card__handle-btn');
        if (!btn) throw new Error('no handle ${handle} on ' + card.className + ': ' + [...card.querySelectorAll('.task-card__handle')].map(h => h.className).join('|'));
        const from = center(btn);
        const day = ${JSON.stringify(to)};
        const target = (${aim})(el, day, from);
        if (!target) throw new Error('no place for ' + day);
        // What is under the points, for the failure message.
        const hit = (p) => document.elementFromPoint(p.x, p.y)?.className ?? null;
        const seen = { handle: hit(from), drop: hit(target) };
        fire('pointerdown', btn, from);
        seen.dragging = card.classList.contains('is-dragging');
        const steps = 6;
        for (let i = 1; i <= steps; i++) {
            fire('pointermove', document, { x: from.x + (target.x - from.x) * i / steps, y: from.y + (target.y - from.y) * i / steps });
            await wait(30);
        }
        fire('pointerup', document, target);
        await wait(1200);
        return JSON.stringify(JSON.stringify({ from, target, seen }));
    })()`);
}

/** Calendar: the middle of the day's cell (the i-th cell of the week row it is in). */
const CALENDAR_AIM = `(el, day, from) => {
    const ms = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
    for (const row of el.querySelectorAll('.cal-week-row')) {
        const i = Math.round((ms(day) - ms(row.dataset.weekStart)) / 86400000);
        if (i < 0 || i > 6) continue;
        const r = row.querySelectorAll('.cal-day-cell')[i].getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
}`;

/** Timeline: the left of the day's column, at the height the handle was pressed (the all-day row). */
const columnLeft = `(el, d) => el.querySelector('.timeline-scroll-area__day-column[data-date="' + d + '"]')?.getBoundingClientRect().left`;

/** Timeline: the middle of the day's column. */
const ALLDAY_AIM = `(el, day, from) => {
    const col = el.querySelector('.timeline-scroll-area__day-column[data-date="' + day + '"]');
    if (!col) return null;
    const r = col.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: from.y };
}`;

/**
 * Timeline's move counts the columns the pointer went across, not the day it
 * is over: the point as far from the handle as `to`'s column is from `from`'s.
 */
function alldayShift(fromDay: string, toDay: string): string {
    return `(el, day, from) => {
        const left = ${columnLeft};
        const a = left(el, ${JSON.stringify(fromDay)}), b = left(el, ${JSON.stringify(toDay)});
        return a === undefined || b === undefined ? null : { x: from.x + (b - a), y: from.y };
    }`;
}

let weekStartDay: number;
let past: number;

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    const live = ev<boolean>(`(() => typeof app.plugins.plugins['obsidian-task-viewer'].viewEvents?.rollIfChanged === 'function')()`);
    if (!live) throw new Error('The Dev vault runs an older build: run `npm run build` and reload the plugin.');
    const s = readSettings(['weekStartDay', 'pastDaysToShow']);
    weekStartDay = s.weekStartDay as number;
    past = s.pastDaysToShow as number;
    expect(await writeIndexedTestFile(FILE, NOTE)).toBe(true);
});

afterAll(async () => {
    await closeViews();
    deleteTestFile(FILE);
    await waitForFileDeindexed(FILE);
});

describe("Calendar's week rows", () => {
    const DAY = '2027-03-10';
    let weeks: string[];

    beforeAll(() => {
        const r = openView('lane-cal', 'calendar-view', { date: DAY, showSidebar: false });
        const start = monthGridStart(DAY, weekStartDay);
        expect(r.gridStart).toBe(start);
        weeks = gridDays(start).filter((_, i) => i % 7 === 0);
    });

    it('draws a task of several days as a bar in the columns of its days', () => {
        const [s, e] = TASKS['lane-alpha'];
        expect(bars('lane-cal', 'lane-alpha')).toEqual(expectedBars(s, e, weeks, 7, true));
    });

    it('cuts a bar at the end of a week, marking each part on the side it continues', () => {
        const [s, e] = TASKS['lane-bravo'];
        const drawn = bars('lane-cal', 'lane-bravo');
        expect(drawn).toHaveLength(2);
        expect(drawn[0].after).toBe(true);
        expect(drawn[1].before).toBe(true);
        expect(drawn).toEqual(expectedBars(s, e, weeks, 7, true));
    });

    it('moves a bar by its move handle to the day it is dropped on, and writes its days', () => {
        const info = drag('lane-cal', 'lane-delta', 'move-bottom-left', '2027-03-25', CALENDAR_AIM);
        expect(days('lane-delta'), info).toEqual(written('2027-03-25', '2027-03-26'));
        expect(bars('lane-cal', 'lane-delta')).toEqual(expectedBars('2027-03-25', '2027-03-26', weeks, 7, true));
    });

    it('stretches a bar by its right resize handle to the day it is let go on, and writes its end', () => {
        const info = drag('lane-cal', 'lane-echo', 'resize-right', '2027-03-26', CALENDAR_AIM);
        expect(days('lane-echo'), info).toEqual(written('2027-03-23', '2027-03-26'));
        expect(bars('lane-cal', 'lane-echo')).toEqual(expectedBars('2027-03-23', '2027-03-26', weeks, 7, true));
    });
});

describe("Timeline's all-day row", () => {
    let dates: string[];

    beforeAll(() => {
        // The window ends on 2027-03-14, in the middle of lane-bravo.
        const r = openView('lane-tl', 'timeline-view', { date: addDays('2027-03-08', past), daysToShow: 7, showSidebar: false });
        dates = r.dates ?? [];
        expect(dates[0]).toBe('2027-03-08');
        expect(dates).toHaveLength(7);
    });

    it('draws a task of several days as a bar in the columns of its days', () => {
        const [s, e] = TASKS['lane-alpha'];
        expect(bars('lane-tl', 'lane-alpha')).toEqual(expectedBars(s, e, [dates[0]], 7, false));
    });

    it('cuts a bar at the edges of the window, marking the side it continues', () => {
        const bravo = bars('lane-tl', 'lane-bravo');
        expect(bravo).toEqual(expectedBars(...TASKS['lane-bravo'], [dates[0]], 7, false));
        expect(bravo[0].after).toBe(true);
        const charlie = bars('lane-tl', 'lane-charlie');
        expect(charlie).toEqual(expectedBars(...TASKS['lane-charlie'], [dates[0]], 7, false));
        expect(charlie[0].before).toBe(true);
    });

    it('moves a bar by its move handle by the days it is dragged, and writes its days', () => {
        const info = drag('lane-tl', 'lane-foxtrot', 'move-bottom-left', '2027-03-12', alldayShift('2027-03-10', '2027-03-12'));
        expect(days('lane-foxtrot'), info).toEqual(written('2027-03-12', '2027-03-13'));
        expect(bars('lane-tl', 'lane-foxtrot')).toEqual(expectedBars('2027-03-12', '2027-03-13', [dates[0]], 7, false));
    });

    it('stretches a bar by its right resize handle to the day it is let go on, and writes its end', () => {
        const info = drag('lane-tl', 'lane-golf', 'resize-right', '2027-03-13', ALLDAY_AIM);
        expect(days('lane-golf'), info).toEqual(written('2027-03-10', '2027-03-13'));
        expect(bars('lane-tl', 'lane-golf')).toEqual(expectedBars('2027-03-10', '2027-03-13', [dates[0]], 7, false));
    });
});
