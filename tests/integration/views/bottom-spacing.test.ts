/**
 * The room at the bottom of a view, in the running Dev vault: each scroll
 * area that runs to a view's bottom scrolls its last content up by
 * Obsidian's `--view-bottom-spacing`, the height a phone's floating
 * navigation bar takes over the view, and by nothing where Obsidian sets no
 * length. The image export leaves that room out.
 *
 * The desktop declares no `--view-bottom-spacing`, so the test sets it on the
 * body as Obsidian does on a phone: a length, the unitless 0 of a phone
 * without the floating bar, and a negative length (the keyboard taller than
 * the bar). Each area is made 1px tall, so its content overflows it whatever
 * the vault holds, and scrolled to its end; the gap between the bottom of
 * what it shows and the bottom of its last child is read.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/bottom-spacing.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning } from '../helpers/cli-helper';
import { deleteNotesUnder } from '../helpers/markdown-frames';
import { PRELUDE, SETTLE_MS, closeViews, ev, openView } from '../helpers/view-helper';

/** Every file of the test is under this: nothing else is written to or deleted. */
const PREFIX = 'SyncIgnore/test-int-bottom-spacing';
const FOLDER = `${PREFIX}-images`;

/** The room a phone with the floating navigation bar asks for. */
const SPACING = 76;

/** The values of `--view-bottom-spacing` read, by name; `null` leaves it undeclared. */
const VALUES: Record<string, string | null> = {
    none: null,
    length: `${SPACING}px`,
    unitlessZero: '0',
    negative: `calc(24px - 300px + 52px)`,
};

/** The scroll areas, each in the view the test opens it in. */
const AREAS = [
    { name: 'sidebar', view: 'bs-timeline', selector: '.tv-sidebar__panel-body' },
    { name: 'timeline', view: 'bs-timeline', selector: '.timeline-grid' },
    { name: 'schedule', view: 'bs-schedule', selector: '.schedule-view__body-scroll' },
    { name: 'calendar', view: 'bs-calendar', selector: '.cal-grid__body' },
    { name: 'kanban', view: 'bs-kanban', selector: '.kanban-view__grid-host' },
    { name: 'log', view: 'bs-log', selector: '.tv-log-list' },
] as const;

interface AreaReading {
    /** From the bottom of the last child to the bottom of what the area shows, scrolled to its end. */
    gap: number;
    /** The area's own padding at its bottom. */
    padding: number;
    /** The last child's margin at its bottom. */
    margin: number;
}

/** For each value's name, each area's reading. */
let readings: Record<string, Record<string, AreaReading>>;
/** The exported image's height, with no value and with the length. */
let exported: { none: number; length: number };

/**
 * A scroll offset is whole pixels while the rows of a list (the log's) may
 * stand at fractions of one, so a position read at a scroll's end may be off
 * by up to a pixel.
 */
function expectNear(actual: number, expected: number): void {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
}

/** Statements that set `--view-bottom-spacing` on the body to `value`, or remove it. */
function setSpacing(value: string | null): string {
    return value === null
        ? `document.body.style.removeProperty('--view-bottom-spacing');`
        : `document.body.style.setProperty('--view-bottom-spacing', ${JSON.stringify(value)});`;
}

/** Read each area with `--view-bottom-spacing` at `value`. */
function readAreas(value: string | null): Record<string, AreaReading> {
    return ev(`(async () => {
        ${PRELUDE}
        ${setSpacing(value)}
        const out = {};
        for (const a of ${JSON.stringify(AREAS)}) {
            const view = V(a.view);
            app.workspace.setActiveLeaf(R[a.view], { focus: false });
            await wait(${SETTLE_MS});
            const area = view.contentEl.querySelector(a.selector);
            if (!area) throw new Error('no ' + a.selector + ' in ' + a.view);
            const last = area.lastElementChild;
            if (!last) throw new Error(a.selector + ' is empty');
            const before = { height: area.style.height, flex: area.style.flex };
            area.style.height = '1px';
            area.style.flex = '0 0 1px';
            area.scrollTop = area.scrollHeight;
            await new Promise(r => requestAnimationFrame(r));
            const shownBottom = area.getBoundingClientRect().top + area.clientTop + area.clientHeight;
            out[a.name] = {
                gap: shownBottom - last.getBoundingClientRect().bottom,
                padding: parseFloat(getComputedStyle(area).paddingBottom),
                margin: parseFloat(getComputedStyle(last).marginBottom),
            };
            area.style.height = before.height;
            area.style.flex = before.flex;
        }
        return JSON.stringify(out);
    })()`);
}

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    deleteNotesUnder(PREFIX);
    openView('bs-timeline', 'timeline-view', { showSidebar: true, sidebar: [] });
    openView('bs-schedule', 'schedule-view');
    openView('bs-calendar', 'calendar-view');
    openView('bs-kanban', 'kanban-view');
    openView('bs-log', 'task-viewer-log-view');
    try {
        readings = {};
        for (const [name, value] of Object.entries(VALUES)) readings[name] = readAreas(value);

        // The export takes the first Timeline shown: it must be the test's.
        exported = ev(`(async () => {
            ${PRELUDE}
            app.workspace.setActiveLeaf(R['bs-timeline'], { focus: false });
            await wait(${SETTLE_MS});
            const shown = app.workspace.getLeavesOfType('timeline-view').filter(l => l.view.contentEl?.offsetWidth > 0);
            if (shown.length !== 1 || shown[0] !== R['bs-timeline']) throw new Error('another Timeline is shown beside the test\\'s');
            const heights = {};
            for (const [name, value] of [['none', null], ['length', ${JSON.stringify(VALUES.length)}]]) {
                if (value === null) document.body.style.removeProperty('--view-bottom-spacing');
                else document.body.style.setProperty('--view-bottom-spacing', value);
                await wait(100);
                heights[name] = (await P.exportService.exportOpenView('timeline-view', { folder: ${JSON.stringify(FOLDER)}, filename: name + '.png' })).height;
            }
            return JSON.stringify(heights);
        })()`);
    } finally {
        ev(`(() => { ${setSpacing(null)} return JSON.stringify(true); })()`);
    }
}, 120_000);

afterAll(async () => {
    ev(`(() => { ${setSpacing(null)} return JSON.stringify(true); })()`);
    await closeViews();
    deleteNotesUnder(PREFIX);
});

describe('The room at the bottom of a view\'s scroll area', () => {
    for (const a of AREAS) {
        it(`${a.name}: with no value, the last content stops at the area's own padding`, () => {
            const r = readings.none[a.name];
            expectNear(r.gap, r.padding + r.margin);
        });

        it(`${a.name}: with a length, the last content stops that far higher`, () => {
            expectNear(readings.length[a.name].gap - readings.none[a.name].gap, SPACING);
        });

        it(`${a.name}: with a unitless 0 or a negative length, it stops where it does with no value`, () => {
            for (const r of [readings.unitlessZero[a.name], readings.negative[a.name]]) {
                expectNear(r.gap, readings.none[a.name].gap);
                expect(r.padding).toBe(readings.none[a.name].padding);
            }
        });
    }
});

describe('Timeline\'s image export', () => {
    it('leaves the room out', () => {
        expect(exported.length).toBe(exported.none);
    });
});
