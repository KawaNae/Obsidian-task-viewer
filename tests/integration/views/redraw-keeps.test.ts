/**
 * What a view keeps across a draw the index sets off, in the running E2E
 * vault: the toolbar's filter popover stays open, the scroll stays where it
 * was, the selected card stays selected with its handles, and the
 * sidebar's panel stays in the document, its elements the same and the
 * focus in it kept; and the image export, after such a draw, leaves the
 * toolbar out. Then the cards of the sidebar's list frame across a draw of
 * the view alone, and the sidebar's look following the `showSidebar` the
 * workspace or a URI hands the view.
 *
 * A draw is set off as the user's edits elsewhere set it off: a note of the
 * test's own, whose task no view draws, is written from outside, and every
 * open view hears the index's change. Each such test first sees that the
 * draw happened: an element of the view's body, rebuilt by each draw, is
 * marked before the write, and the mark is gone after it. Only then is what
 * was kept read. The sidebar's look tests read the look alone, whether or not a
 * draw put it there: the view may answer a state handed in without drawing
 * its body again.
 *
 * A draw of the index's draws the sidebar's panel in the same frame, which
 * makes the list frames' elements anew. The draw of the view alone is set
 * off by a change of the view's name, a field the panel does not read; that
 * test sees the view's body made anew and the list frame's element not.
 *
 * Each test opens the views it reads itself, under a name of its own, and
 * reads them while they are in front: a tab behind another has no size, and
 * no scroll.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault open, with the current build
 *     loaded (the preflight builds it into the vault)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/redraw-keeps.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createTeardown } from '../helpers/teardown';
import { deleteNotesUnder } from '../helpers/markdown-frames';
import { writeIndexedTestFile } from '../helpers/test-file-manager';
import {
    PRELUDE, SETTLE_MS, VIEW_BODY, addDays, closeViews, drawAgainByIndex, ev, frames, openView, readSettings, readView,
    setViewState, tr, visualDay,
} from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';

/** Every file of the test is under this: nothing else is written to or deleted. */
const PREFIX = 'test-int-redraw';
/** The tasks the views draw. */
const TASKS = `${PREFIX}-tasks.md`;
/** The note written to set off a draw (`drawAgainByIndex`). */
const TOUCH = `${PREFIX}-touch.md`;
const FOLDER = `${PREFIX}-images`;
const TAG = 'tvredraw';
/** The task selected in the selection tests. */
const SELECTED = 'redraw selected';
/** How many tasks are put on the day: enough that Calendar's grid and Kanban's board scroll. */
const MANY = 40;

const teardown = createTeardown();

/** The day the views look at, three weeks from today, so that no view's look leans on today. */
let DAY: string;
/** The `date` that puts DAY first among Timeline's days. */
let timelineDate: string;

function tasksNote(): string {
    return [
        `- [ ] ${SELECTED} #${TAG} @${DAY}T10:00>11:00`,
        ...Array.from({ length: MANY }, (_, i) => `- [ ] redraw many ${i + 1} #${TAG} @${DAY}`),
        '',
    ].join('\n');
}

/** The Kanban board of the tests: 3 rows of 8 lists of the day's tasks, wider and taller than the pane. */
function kanbanGrid(): Record<string, unknown>[][] {
    const list = (id: string) => ({ id, name: id, filterState: { logic: 'and', filters: [{ property: 'tag', operator: 'includes', value: [TAG] }] } });
    return [0, 1, 2].map(r => Array.from({ length: 8 }, (_, c) => list(`rk-${r}${c}`)));
}

/** The state each view is opened with to look at DAY. */
function stateFor(type: string): Record<string, unknown> {
    switch (type) {
        case 'timeline-view': return { date: timelineDate, daysToShow: 3, showSidebar: true, sidebar: [] };
        case 'calendar-view': return { date: DAY, showSidebar: true, sidebar: [] };
        case 'schedule-view': return { date: DAY };
        case 'kanban-view': return { grid: kanbanGrid() };
        default: return {};
    }
}

beforeAll(async () => {
    const { startHour, pastDaysToShow } = readSettings(['startHour', 'pastDaysToShow']) as { startHour: number; pastDaysToShow: number };
    DAY = addDays(visualDay(startHour), 21);
    timelineDate = addDays(DAY, pastDaysToShow);
    deleteNotesUnder(PREFIX);
    teardown.add('delete the notes', async () => {
        deleteNotesUnder(PREFIX);
        await waitForFileDeindexed(TASKS);
    });
    teardown.add('close the views', closeViews);
    await writeIndexedTestFile(TASKS, tasksNote());
}, 60_000);

afterAll(() => teardown.run());

afterEach(async () => {
    ev(`(() => { ${PRELUDE} closeOverlays(); closeMenus(); return JSON.stringify(true); })()`);
    await closeViews();
});

describe('The toolbar\'s filter popover stays open while the view draws again', () => {
    /** Statements that open the filter popover from the toolbar of the view `n`. */
    const opener = (type: string) => type === 'mini-calendar-view'
        ? `click(n, '.view-toolbar__btn--more'); await wait(100); menuItem(i => i.titleEl?.textContent.trim() === ${JSON.stringify(tr('toolbar.filter'))});`
        : `click(n, '.view-toolbar button:has(svg.lucide-filter)');`;

    for (const type of ['timeline-view', 'calendar-view', 'schedule-view', 'kanban-view', 'mini-calendar-view']) {
        it(`${type}: the same popover is open after the draw, and still edits the view's filter`, async () => {
            const name = `rk-pop-${type}`;
            openView(name, type, stateFor(type));
            ev(`(async () => {
                ${PRELUDE}
                ${UNTIL}
                const n = ${JSON.stringify(name)};
                ${opener(type)}
                await until(() => document.querySelector('.tv-overlay__panel.filter-popover'), 3000, 'the filter popover');
                document.querySelector('.tv-overlay__panel.filter-popover').dataset.tvKeep = '1';
                return JSON.stringify(true);
            })()`);

            await drawAgainByIndex(name, TOUCH);

            const after = ev<{ panels: number; kept: boolean; filters: number }>(`(async () => {
                ${PRELUDE}
                const panels = [...document.querySelectorAll('.tv-overlay__panel.filter-popover')];
                const kept = panels.length === 1 && panels[0].dataset.tvKeep === '1' && panels[0].isConnected;
                if (kept) {
                    buttonText(fFooter(), ${JSON.stringify(tr('filter.addFilter'))}).click();
                    await wait(${SETTLE_MS});
                }
                return JSON.stringify({ panels: panels.length, kept, filters: V(${JSON.stringify(name)}).getState().filterState?.filters?.length ?? 0 });
            })()`);
            expect(after).toEqual({ panels: 1, kept: true, filters: 1 });
        });
    }
});

describe('The scroll stays where it was while the view draws again', () => {
    const AREAS: { type: string; area: string; both: boolean }[] = [
        { type: 'timeline-view', area: '.timeline-grid', both: false },
        { type: 'calendar-view', area: '.cal-grid__body', both: false },
        { type: 'schedule-view', area: '.schedule-view__body-scroll', both: false },
        { type: 'kanban-view', area: '.kanban-view__grid-host', both: true },
    ];

    /** Read the scroll of `name`'s area; with `to`, scroll it to the middle first. */
    function scrollOf(name: string, area: string, to: boolean): { top: number; left: number; maxTop: number; maxLeft: number } {
        return ev(`(async () => {
            ${PRELUDE}
            const a = V(${JSON.stringify(name)}).contentEl.querySelector(${JSON.stringify(area)});
            if (!a) throw new Error('no ${area}');
            const maxTop = a.scrollHeight - a.clientHeight;
            const maxLeft = a.scrollWidth - a.clientWidth;
            if (${to}) {
                a.scrollTop = Math.round(maxTop / 2);
                a.scrollLeft = Math.round(maxLeft / 2);
                ${frames(2)}
            }
            return JSON.stringify({ top: a.scrollTop, left: a.scrollLeft, maxTop, maxLeft });
        })()`);
    }

    for (const { type, area, both } of AREAS) {
        it(`${type}: ${both ? 'both offsets of' : 'the offset of'} ${area} are kept`, async () => {
            const name = `rk-scroll-${type}`;
            openView(name, type, stateFor(type));
            const before = scrollOf(name, area, true);
            // The area scrolls, and was scrolled away from its start.
            expect(before.top).toBeGreaterThan(0);
            if (both) expect(before.left).toBeGreaterThan(0);

            await drawAgainByIndex(name, TOUCH);

            const after = scrollOf(name, area, false);
            expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
            if (both) expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(1);
        });
    }
});

describe('The selected card stays selected while the view draws again', () => {
    /** The cards of the selected task in `name`, and how many other cards are selected. */
    function selection(name: string, select: boolean): { cards: number; selected: number; handles: number; others: number } {
        return ev(`(async () => {
            ${PRELUDE}
            const el = V(${JSON.stringify(name)}).contentEl;
            const main = [...el.querySelectorAll('.task-card')].filter(c => !c.closest('.tv-sidebar__frames'));
            const mine = main.filter(c => c.textContent.includes(${JSON.stringify(SELECTED)}));
            if (${select}) {
                if (mine.length === 0) throw new Error('no card of ${SELECTED}');
                mine[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
                await wait(100);
            }
            return JSON.stringify({
                cards: mine.length,
                selected: mine.filter(c => c.classList.contains('is-selected')).length,
                handles: mine.reduce((n, c) => n + c.querySelectorAll('.task-card__handle').length, 0),
                others: main.filter(c => !mine.includes(c) && c.classList.contains('is-selected')).length,
            });
        })()`);
    }

    for (const type of ['timeline-view', 'calendar-view']) {
        it(`${type}: .is-selected and the handles are on its cards after the draw`, async () => {
            const name = `rk-sel-${type}`;
            openView(name, type, stateFor(type));
            const before = selection(name, true);
            expect(before.cards).toBeGreaterThan(0);
            expect(before.selected).toBe(before.cards);
            expect(before.handles).toBeGreaterThan(0);

            await drawAgainByIndex(name, TOUCH);

            const after = selection(name, false);
            expect(after).toEqual({ ...before, others: 0 });
        });
    }
});

describe('The sidebar\'s panel stays in the document while the view draws again', () => {
    /** The elements of the sidebar that are read, by their class. */
    const KEPT = {
        layout: '.tv-sidebar',
        panel: '.tv-sidebar__panel',
        body: '.tv-sidebar__panel-body',
        frames: '.tv-sidebar__frames',
        add: '.tv-sidebar__panel-add-btn',
    };

    for (const type of ['timeline-view', 'calendar-view']) {
        it(`${type}: the same elements are there after the draw, none was taken out meanwhile, and the focus in the panel stays`, async () => {
            const name = `rk-panel-${type}`;
            openView(name, type, stateFor(type));
            // Each element of the sidebar is kept, every node taken out of the
            // view from now on is recorded, and the panel's add button takes
            // the focus.
            const focused = ev<boolean>(`(() => {
                ${PRELUDE}
                const el = V(${JSON.stringify(name)}).contentEl;
                const kept = {};
                for (const [key, sel] of Object.entries(${JSON.stringify(KEPT)})) {
                    kept[key] = el.querySelector(sel);
                    if (!kept[key]) throw new Error('no ' + sel);
                }
                const removed = [];
                const record = records => { for (const r of records) removed.push(...r.removedNodes); };
                const observer = new MutationObserver(record);
                observer.observe(el, { childList: true, subtree: true });
                kept.add.focus();
                window.__tvPanelKept = { kept, removed, record, observer };
                return JSON.stringify(document.activeElement === kept.add);
            })()`);
            expect(focused).toBe(true);

            await drawAgainByIndex(name, TOUCH);

            const after = ev<{ same: string[]; connected: string[]; takenOut: string[]; focused: boolean }>(`(() => {
                ${PRELUDE}
                const { kept, removed, record, observer } = window.__tvPanelKept;
                delete window.__tvPanelKept;
                record(observer.takeRecords());
                observer.disconnect();
                const el = V(${JSON.stringify(name)}).contentEl;
                const sels = ${JSON.stringify(KEPT)};
                const keys = Object.keys(sels);
                return JSON.stringify({
                    same: keys.filter(k => el.querySelector(sels[k]) === kept[k]),
                    connected: keys.filter(k => kept[k].isConnected),
                    takenOut: keys.filter(k => removed.some(n => n === kept[k] || n.contains?.(kept[k]))),
                    focused: document.activeElement === kept.add,
                });
            })()`);
            const all = Object.keys(KEPT);
            expect(after).toEqual({ same: all, connected: all, takenOut: [], focused: true });
        });
    }
});

describe('The cards of the sidebar\'s list frame stay while the view alone draws again', () => {
    /** A list frame of the day's tasks, so that the panel holds task cards of its own. */
    const LIST = { kind: 'list', id: 'rk-frame-list', name: 'rk-frame-list', filterState: { logic: 'and', filters: [{ property: 'tag', operator: 'includes', value: [TAG] }] } };

    for (const type of ['timeline-view', 'calendar-view']) {
        it(`${type}: a change of the view's name draws the view and not the panel, and the panel's cards are the same elements, in the document`, () => {
            const name = `rk-frame-${type}`;
            openView(name, type, { ...stateFor(type), sidebar: [LIST] });
            // The list frame's element and its cards are kept, and the view's
            // body is marked: a draw of the view makes the body anew, and a
            // draw of the panel makes the list frame's element anew.
            const cards = ev<number>(`(() => {
                ${PRELUDE}
                const v = V(${JSON.stringify(name)});
                const list = v.contentEl.querySelector('.tv-sidebar__frames .pinned-list');
                if (!list) throw new Error('no list frame');
                const cards = [...list.querySelectorAll('.task-card')];
                v.contentEl.querySelector(${JSON.stringify(VIEW_BODY[type])}).dataset.tvRedrawMark = '1';
                window.__tvFrameKept = { list, cards };
                return JSON.stringify(cards.length);
            })()`);
            expect(cards).toBeGreaterThan(0);

            const after = ev<{ listSame: boolean; same: number; connected: number }>(`(async () => {
                ${PRELUDE}
                ${UNTIL}
                const v = V(${JSON.stringify(name)});
                const { list, cards } = window.__tvFrameKept;
                delete window.__tvFrameKept;
                v.update({ customName: ${JSON.stringify(`${name} renamed`)} });
                await until(() => !v.contentEl.querySelector('[data-tv-redraw-mark]') && v.contentEl.querySelector(${JSON.stringify(VIEW_BODY[type])}), 5000,
                    ${JSON.stringify(`${name} drawn again after its name changed`)});
                ${frames(3)}
                const now = [...v.contentEl.querySelectorAll('.tv-sidebar__frames .pinned-list .task-card')];
                return JSON.stringify({
                    listSame: v.contentEl.querySelector('.tv-sidebar__frames .pinned-list') === list,
                    same: cards.filter((c, i) => now[i] === c).length,
                    connected: cards.filter(c => c.isConnected).length,
                });
            })()`);
            expect(after).toEqual({ listSame: true, same: cards, connected: cards });
        });
    }
});

/** How the sidebar of a view looks. */
interface SidebarLook {
    panelHidden: boolean;
    mainOpen: boolean;
    backdropVisible: boolean;
    toggleOpen: boolean;
}

function sidebarLook(name: string): SidebarLook {
    return ev<SidebarLook>(`(() => {
        ${PRELUDE}
        const el = V(${JSON.stringify(name)}).contentEl;
        const has = (sel, cls) => {
            const e = el.querySelector(sel);
            if (!e) throw new Error('no ' + sel);
            return e.classList.contains(cls);
        };
        return JSON.stringify({
            panelHidden: has('.tv-sidebar__panel', 'tv-sidebar__panel--hidden'),
            mainOpen: has('.tv-sidebar__main', 'tv-sidebar__main--open'),
            backdropVisible: has('.tv-sidebar__backdrop', 'tv-sidebar__backdrop--visible'),
            toggleOpen: has('.sidebar-toggle-button-icon', 'is-open'),
        });
    })()`);
}

const OPEN: SidebarLook = { panelHidden: false, mainOpen: true, backdropVisible: true, toggleOpen: true };
const CLOSED: SidebarLook = { panelHidden: true, mainOpen: false, backdropVisible: false, toggleOpen: false };

describe('The sidebar looks as the showSidebar handed in says', () => {
    for (const type of ['timeline-view', 'calendar-view']) {
        it(`${type}: opened with it false, the panel is hidden`, () => {
            const name = `rk-sb-open-${type}`;
            openView(name, type, { ...stateFor(type), showSidebar: false });
            expect(sidebarLook(name)).toEqual(CLOSED);
        });

        it(`${type}: a state handed over the view hides the panel, and the next shows it`, () => {
            const name = `rk-sb-state-${type}`;
            openView(name, type, stateFor(type));
            expect(sidebarLook(name)).toEqual(OPEN);
            setViewState(name, { ...stateFor(type), showSidebar: false });
            expect(sidebarLook(name)).toEqual(CLOSED);
            setViewState(name, { ...stateFor(type), showSidebar: true });
            expect(sidebarLook(name)).toEqual(OPEN);
        });

        it(`${type}: a URI opened over the view (position=override) hides the panel`, () => {
            const name = `rk-sb-uri-${type}`;
            openView(name, type, stateFor(type));
            expect(sidebarLook(name)).toEqual(OPEN);
            const same = ev<boolean>(`(async () => {
                ${PRELUDE}
                const leaf = R[${JSON.stringify(name)}];
                if (app.workspace.getLeavesOfType(${JSON.stringify(type)}).length !== 1) throw new Error('another ${type} is open beside the test\\'s');
                app.workspace.protocolHandler.handlers.get('task-viewer')({
                    action: 'task-viewer', position: 'override', view: ${JSON.stringify(type.replace(/-view$/, ''))}, date: ${JSON.stringify(DAY)}, showSidebar: 'false',
                });
                await wait(${SETTLE_MS});
                return JSON.stringify(app.workspace.getLeavesOfType(${JSON.stringify(type)})[0] === leaf);
            })()`);
            expect(same).toBe(true);
            expect(readView(name).state.showSidebar).toBe(false);
            expect(sidebarLook(name)).toEqual(CLOSED);
        });
    }
});

describe('The image export leaves the toolbar out', () => {
    /** The toolbar's color, and the color of a strip put in the body as a control. */
    const TOOLBAR = [255, 0, 255];
    const CONTROL = [0, 255, 255];

    for (const type of ['timeline-view', 'schedule-view', 'kanban-view']) {
        it(`${type}: none of the toolbar's color is in the image, while the body's strip is`, async () => {
            const name = `rk-export-${type}`;
            openView(name, type, stateFor(type));
            await drawAgainByIndex(name, TOUCH);
            const counts = ev<{ toolbar: number; control: number }>(`(async () => {
                ${PRELUDE}
                const leaf = R[${JSON.stringify(name)}];
                const shown = app.workspace.getLeavesOfType(${JSON.stringify(type)}).filter(l => l.view.contentEl?.offsetWidth > 0);
                if (shown.length !== 1 || shown[0] !== leaf) throw new Error('another ${type} is shown beside the test\\'s');
                const el = leaf.view.contentEl;
                const toolbar = el.querySelector('.view-toolbar');
                if (!toolbar) throw new Error('no toolbar');
                const painted = [toolbar, toolbar.parentElement];
                for (const e of painted) e.style.setProperty('background', 'rgb(${TOOLBAR.join(',')})', 'important');
                const strip = el.querySelector(${JSON.stringify(VIEW_BODY[type])}).createDiv();
                strip.style.cssText = 'height: 20px; min-height: 20px; width: 100px; background: rgb(${CONTROL.join(',')});';
                let path;
                try {
                    path = (await P.exportService.exportOpenView(${JSON.stringify(type)}, { folder: ${JSON.stringify(FOLDER)}, filename: ${JSON.stringify(`${type}.png`)} })).path;
                } finally {
                    for (const e of painted) e.style.removeProperty('background');
                    strip.remove();
                }
                const data = await app.vault.adapter.readBinary(path);
                const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }));
                const c = document.createElement('canvas');
                c.width = bitmap.width; c.height = bitmap.height;
                const g = c.getContext('2d');
                g.drawImage(bitmap, 0, 0);
                const px = g.getImageData(0, 0, c.width, c.height).data;
                const near = (i, [r, gr, b]) => Math.abs(px[i] - r) <= 4 && Math.abs(px[i + 1] - gr) <= 4 && Math.abs(px[i + 2] - b) <= 4 && px[i + 3] === 255;
                let toolbarCount = 0, controlCount = 0;
                for (let i = 0; i < px.length; i += 4) {
                    if (near(i, ${JSON.stringify(TOOLBAR)})) toolbarCount++;
                    else if (near(i, ${JSON.stringify(CONTROL)})) controlCount++;
                }
                return JSON.stringify({ toolbar: toolbarCount, control: controlCount });
            })()`);
            expect(counts.control).toBeGreaterThan(0);
            expect(counts.toolbar).toBe(0);
        });
    }
});
