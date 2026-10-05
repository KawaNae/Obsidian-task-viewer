/**
 * The toolbars write their view's state through the store, and the view
 * answers each change (draw, save, the toolbar mending itself), in the
 * running Dev vault. Each control is clicked as the user clicks it; what the
 * view shows is read from its DOM and what it saves from `getState`.
 *
 * Copy URI is read by standing in for the clipboard while the menu item
 * runs, so the user's clipboard is left alone. It writes the view's config
 * when no view template folder is set, and the name of a template when one
 * is (`view-templates.test.ts`), so the folder is cleared for these tests and
 * put back after them.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * The fold of the action zone into ⋮ is read by narrowing the view's own
 * content to a width (its leaf is the test's, so no pane of the vault is
 * resized) and putting it back.
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/toolbar-state.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning } from '../helpers/cli-helper';
import {
    act, closeViews, copyUri, ev, openView, overrideSettings, PRELUDE, readView, restartView, type HeldSettings,
} from '../helpers/view-helper';

let held: HeldSettings<'viewTemplateFolder'>;

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    const live = ev<boolean>(`(() => typeof app.plugins.plugins['obsidian-task-viewer'].viewEvents?.rollIfChanged === 'function')()`);
    if (!live) throw new Error('The Dev vault runs an older build: run `npm run build` and reload the plugin.');
    held = overrideSettings({ viewTemplateFolder: '' });
});

afterAll(async () => {
    await closeViews();
    held?.restore();
});

/** The toolbar's controls of a Timeline, as it shows them. */
interface TimelineControls {
    days: string | null;
    zoom: string | null;
    mask: string | null;
}

function timelineControls(): TimelineControls {
    return ev<TimelineControls>(`(() => {
        const el = window.__tvE2E.tl.view.contentEl;
        return JSON.stringify({
            days: el.querySelector('.view-toolbar__btn--days .view-toolbar__btn-label')?.textContent ?? null,
            zoom: el.querySelector('.view-toolbar__btn--zoom .view-toolbar__btn-label')?.textContent ?? null,
            mask: el.querySelector('button[aria-pressed]')?.getAttribute('aria-pressed') ?? null,
        });
    })()`);
}

describe("Timeline's toolbar", () => {
    beforeAll(() => {
        openView('tl', 'timeline-view', { daysToShow: 3, zoomLevel: 1 });
    });

    it('adds and takes away a day with + and -', () => {
        let r = act('tl', `click('tl', '.view-toolbar__days-group > button:last-child');`);
        expect(r.state.daysToShow).toBe(4);
        expect(r.dates?.length).toBe(4);
        r = act('tl', `click('tl', '.view-toolbar__days-group > button:first-child');`);
        expect(r.state.daysToShow).toBe(3);
        expect(r.dates?.length).toBe(3);
    });

    it('zooms to the level picked in the zoom menu, and its label follows', () => {
        const r = act('tl', `
            click('tl', '.view-toolbar__btn--zoom');
            await wait(100);
            menuItem(i => i.titleEl?.textContent.trim() === '150%');
        `);
        expect(r.state.zoomLevel).toBe(1.5);
        expect(timelineControls().zoom).toBe('150%');
        act('tl', `
            click('tl', '.view-toolbar__btn--zoom');
            await wait(100);
            menuItem(i => i.titleEl?.textContent.trim() === '100%');
        `);
        expect(readView('tl').state.zoomLevel).toBe(1);
    });

    it('turns mask mode on and off', () => {
        let r = act('tl', `click('tl', 'button[aria-pressed]');`);
        expect(r.state.maskMode).toBe(true);
        expect(timelineControls().mask).toBe('true');
        r = act('tl', `click('tl', 'button[aria-pressed]');`);
        expect(r.state.maskMode).toBe(false);
        expect(timelineControls().mask).toBe('false');
    });

    it('opens and closes the sidebar', () => {
        const before = readView('tl').state.showSidebar ?? true;
        let r = act('tl', `click('tl', '.sidebar-toggle-button-icon');`);
        expect(r.state.showSidebar).toBe(!before);
        r = act('tl', `click('tl', '.sidebar-toggle-button-icon');`);
        expect(r.state.showSidebar).toBe(before);
    });

    it('keeps a filter written to its store, and saves it', () => {
        const filterState = { logic: 'and', filters: [{ property: 'file', operator: 'includes', value: ['no-such-file.md'] }] };
        const r = act('tl', `V('tl').store.update({ filterState: ${JSON.stringify(filterState)} });`);
        expect(r.state.filterState).toBeTruthy();
        const restarted = restartView('tl', 'tl-2');
        expect(restarted.state.filterState).toEqual(r.state.filterState);
        // No card of another file is drawn.
        const cards = ev<number>(`(() => window.__tvE2E['tl-2'].view.contentEl.querySelectorAll('.task-card').length)()`);
        expect(cards).toBe(0);
    });

    it('copies a URI of its config, with no template folder set', () => {
        act('tl', `V('tl').store.update({ filterState: undefined, daysToShow: 5 });`);
        const uri = copyUri('tl');
        expect(uri).toMatch(/^obsidian:\/\/task-viewer\?view=timeline&/);
        expect(uri).toContain('daysToShow=5');
        expect(uri).toContain('zoomLevel=1');
        expect(uri).not.toContain('template=');
        expect(uri).not.toContain('date=');
    });
});

/** How a toolbar lies at a width. */
interface ToolbarFit {
    /** The width the toolbar has. */
    has: number;
    /** The width its row takes open (action zone shown, ⋮ hidden). */
    needed: number;
    compact: boolean;
    /** Whether the action zone and ⋮ show. */
    zone: boolean;
    more: boolean;
    /** How far the row runs past the toolbar. */
    overflow: number;
}

/**
 * Narrow `name`'s content to `width` px (null: back to the pane's), wait for
 * the toolbar to answer, and read how it lies. `hidden` puts the content out
 * of sight (no width) instead.
 */
function fitAt(name: string, width: number | null, opts: { hidden?: boolean } = {}): ToolbarFit {
    return ev<ToolbarFit>(`(async () => {
        ${PRELUDE}
        const el = V(${JSON.stringify(name)}).contentEl;
        el.style.width = ${width === null ? "''" : `'${width}px'`};
        el.style.display = ${opts.hidden ? "'none'" : "''"};
        await wait(150);
        const tb = el.querySelector('.view-toolbar');
        const compact = tb.classList.contains('is-compact');
        const shown = (sel) => getComputedStyle(tb.querySelector(sel)).display !== 'none';
        const zone = shown('.view-toolbar__action-zone');
        const more = shown('.view-toolbar__btn--more');
        const has = tb.getBoundingClientRect().width;
        const overflow = tb.scrollWidth - tb.clientWidth;
        el.style.display = '';
        tb.classList.remove('is-compact');
        tb.style.width = 'max-content';
        const needed = tb.getBoundingClientRect().width;
        tb.style.width = '';
        if (compact) tb.classList.add('is-compact');
        return JSON.stringify({ has, needed, compact, zone, more, overflow });
    })()`);
}

describe('The toolbar folds its actions into ⋮ when its row does not fit', () => {
    afterAll(() => {
        for (const name of ['tl-fold', 'cal-fold', 'sch-fold']) {
            try { fitAt(name, null); } catch { /* not opened */ }
        }
    });

    /** At `width`, folded exactly when the open row is wider, and never overflowing. */
    function expectFits(fit: ToolbarFit, width: number): void {
        expect(fit.has).toBe(width);
        expect(fit.compact).toBe(fit.needed > width);
        expect(fit.zone).toBe(!fit.compact);
        expect(fit.more).toBe(fit.compact);
        expect(fit.overflow).toBe(0);
    }

    it("Timeline's, at 700, 560 and 400 px, and back", () => {
        openView('tl-fold', 'timeline-view', { daysToShow: 3, zoomLevel: 1 });
        const wide = fitAt('tl-fold', 700);
        // Wider than the fixed 500 px the fold used to be at.
        expect(wide.needed).toBeGreaterThan(500);
        expect(wide.needed).toBeLessThan(700);
        expectFits(wide, 700);
        expect(wide.compact).toBe(false);

        const between = fitAt('tl-fold', 560);
        expectFits(between, 560);
        expect(between.compact).toBe(true);

        const narrow = fitAt('tl-fold', 400);
        expectFits(narrow, 400);
        expect(narrow.compact).toBe(true);

        const again = fitAt('tl-fold', 700);
        expectFits(again, 700);
        expect(again.compact).toBe(false);
    });

    it('folds or unfolds as the row it holds grows or shrinks, at the same width', () => {
        const open = fitAt('tl-fold', 700);
        // A width the row fits with the zoom label's room to spare, by less than a button.
        const width = Math.ceil(open.needed) + 4;
        expectFits(fitAt('tl-fold', width), width);
        expect(fitAt('tl-fold', width).compact).toBe(false);
        // The days label "3 days" gives way to a longer one.
        act('tl-fold', `V('tl-fold').store.update({ daysToShow: 12 });`);
        const grown = fitAt('tl-fold', width);
        expect(grown.needed).toBeGreaterThan(open.needed);
        expectFits(grown, width);
        expect(grown.compact).toBe(true);
        act('tl-fold', `V('tl-fold').store.update({ daysToShow: 3 });`);
        const back = fitAt('tl-fold', width);
        expectFits(back, width);
        expect(back.compact).toBe(false);
    });

    it('keeps its fold out of sight', () => {
        const folded = fitAt('tl-fold', 400);
        expect(folded.compact).toBe(true);
        const hidden = fitAt('tl-fold', 700, { hidden: true });
        expect(hidden.has).toBe(0);
        expect(hidden.compact).toBe(true);
        const seen = fitAt('tl-fold', 700);
        expectFits(seen, 700);
        expect(seen.compact).toBe(false);
    });

    it("Calendar's and Schedule's, around the width each needs", () => {
        // One at a time: a tab behind another has no width.
        for (const [name, type] of [['cal-fold', 'calendar-view'], ['sch-fold', 'schedule-view']]) {
            openView(name, type);
            const needed = Math.ceil(fitAt(name, 700).needed);
            expectFits(fitAt(name, needed + 10), needed + 10);
            expect(fitAt(name, needed + 10).compact).toBe(false);
            expectFits(fitAt(name, needed - 10), needed - 10);
            expect(fitAt(name, needed - 10).compact).toBe(true);
        }
    });
});

describe('Kanban', () => {
    it('opens, toggles mask mode from its toolbar, and copies a URI', () => {
        const r = openView('kb', 'kanban-view');
        expect(r.type).toBe('kanban-view');
        const masked = act('kb', `click('kb', 'button[aria-pressed]');`);
        expect(masked.state.maskMode).toBe(true);
        const uri = copyUri('kb');
        expect(uri).toMatch(/^obsidian:\/\/task-viewer\?view=kanban/);
        expect(uri).toContain('maskMode=true');
        expect(uri).not.toContain('template=');
        const off = act('kb', `click('kb', 'button[aria-pressed]');`);
        expect(off.state.maskMode).toBe(false);
    });
});

describe('Timer', () => {
    it('opens in pomodoro, changes mode from its menu, keeps it on restart and copies it as timerViewMode', () => {
        const r = openView('tm', 'timer-view');
        expect(r.state.timerViewMode).toBe('pomodoro');

        const changed = act('tm', `
            click('tm', '.view-toolbar__btn--dropdown');
            await wait(100);
            if (menuItems().length !== 4) throw new Error('mode menu has ' + menuItems().length + ' items');
            menuItem((_, i) => i === 0);
        `);
        expect(changed.state.timerViewMode).toBe('countup');

        const restarted = restartView('tm', 'tm-2');
        expect(restarted.state.timerViewMode).toBe('countup');

        const uri = copyUri('tm');
        expect(uri).toMatch(/^obsidian:\/\/task-viewer\?view=timer/);
        expect(uri).toContain('timerViewMode=countup');
        expect(uri).not.toMatch(/[?&]mode=/);
    });
});
