/**
 * The toolbars write their view's state through the store, and the view
 * answers each change (draw, save, the toolbar mending itself), in the
 * running Dev vault. Each control is clicked as the user clicks it; what the
 * view shows is read from its DOM and what it saves from `getState`.
 *
 * Copy URI is read by standing in for the clipboard while the menu item
 * runs, so the user's clipboard is left alone.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/toolbar-state.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning } from '../helpers/cli-helper';
import { act, closeViews, copyUri, ev, openView, readView, restartView } from '../helpers/view-helper';

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    const live = ev<boolean>(`(() => typeof app.plugins.plugins['obsidian-task-viewer'].viewEvents?.rollIfChanged === 'function')()`);
    if (!live) throw new Error('The Dev vault runs an older build: run `npm run build` and reload the plugin.');
});

afterAll(async () => {
    await closeViews();
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

    it('copies a URI of its config', () => {
        act('tl', `V('tl').store.update({ filterState: undefined, daysToShow: 5 });`);
        const uri = copyUri('tl');
        expect(uri).toMatch(/^obsidian:\/\/task-viewer\?view=timeline&/);
        expect(uri).toContain('daysToShow=5');
        expect(uri).not.toContain('date=');
    });
});

describe('Kanban', () => {
    it('opens, toggles mask mode from its toolbar, and copies a URI', () => {
        const r = openView('kb', 'kanban-view');
        expect(r.type).toBe('kanban-view');
        const masked = act('kb', `click('kb', 'button[aria-pressed]');`);
        expect(masked.state.maskMode).toBe(true);
        expect(copyUri('kb')).toMatch(/^obsidian:\/\/task-viewer\?view=kanban/);
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
