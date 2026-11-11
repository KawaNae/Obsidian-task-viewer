/**
 * The sidebar of Timeline and Calendar takes the user's "back" while it lies
 * open over the view (the view at or below the breakpoint), in the running
 * Dev vault. Obsidian's `history.back()` calls what is on top of its stack,
 * as Android's back and the mouse's back button do. Beside the view (wider)
 * the back is left to the rest of the app; a dialog opened over the sidebar
 * takes it first; a view in a tab behind another does not take it.
 *
 * The width is set on the view's own content (its leaf is the test's, so no
 * pane of the vault is resized), as the user's pane would be.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/sidebar-back.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning } from '../helpers/cli-helper';
import { closeViews, ev, openView, PRELUDE, tr } from '../helpers/view-helper';

const NARROW = 500;
const WIDE = 1000;

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
});

afterAll(async () => {
    await closeViews();
});

/** Snippet names for the sidebar of the view `name`. */
function sidebarPrelude(name: string): string {
    return `
        ${PRELUDE}
        const el = V(${JSON.stringify(name)}).contentEl;
        const shown = () => !el.querySelector('.tv-sidebar__panel').classList.contains('tv-sidebar__panel--hidden');
        const sidebar = () => ({ shown: shown(), saved: V(${JSON.stringify(name)}).getState().showSidebar ?? true, over: !!el.querySelector('.tv-sidebar--mobile') });
        /** Give the content the width \`w\` and open the sidebar with the toggle, as the user does. */
        const openAt = async (w) => {
            el.style.width = w + 'px';
            await wait(200);
            if (!shown()) el.querySelector('.sidebar-toggle-button-icon').click();
            await wait(400);
            if (!shown()) throw new Error('the sidebar did not open');
        };
        const back = async () => { window.history.back(); await wait(400); };
    `;
}

describe.each([
    ['Timeline', 'timeline-view'],
    ['Calendar', 'calendar-view'],
])("%s's sidebar and the back", (_label, type) => {
    const name = `back-${type}`;

    beforeAll(() => {
        openView(name, type);
    });

    it('closes on the back while it lies open over the view, as a click on the backdrop does', () => {
        const r = ev<Record<string, unknown>>(`(async () => {
            ${sidebarPrelude(name)}
            await openAt(${NARROW});
            const before = sidebar();
            await back();
            const after = sidebar();
            await back();
            return JSON.stringify({ before, after, again: sidebar() });
        })()`);
        expect(r).toEqual({
            before: { shown: true, saved: true, over: true },
            after: { shown: false, saved: false, over: true },
            // Closed, it holds the back no more: the next one is the app's.
            again: { shown: false, saved: false, over: true },
        });
    });

    it('leaves the back alone while it lies beside the view', () => {
        const r = ev<Record<string, unknown>>(`(async () => {
            ${sidebarPrelude(name)}
            await openAt(${WIDE});
            const before = sidebar();
            await back();
            return JSON.stringify({ before, after: sidebar() });
        })()`);
        expect(r).toEqual({
            before: { shown: true, saved: true, over: false },
            after: { shown: true, saved: true, over: false },
        });
    });

    it('takes the back once the view narrows, and lets go of it once the view widens', () => {
        const r = ev<Record<string, unknown>>(`(async () => {
            ${sidebarPrelude(name)}
            await openAt(${WIDE});
            el.style.width = '${NARROW}px';
            await wait(200);
            el.style.width = '${WIDE}px';
            await wait(200);
            await back();
            const wide = sidebar();
            el.style.width = '${NARROW}px';
            await wait(200);
            await back();
            return JSON.stringify({ wide, narrowed: sidebar() });
        })()`);
        expect(r).toEqual({
            wide: { shown: true, saved: true, over: false },
            narrowed: { shown: false, saved: false, over: true },
        });
    });

    it('is under a dialog opened over it: the back closes the dialog first, then the sidebar', () => {
        const r = ev<Record<string, unknown>>(`(async () => {
            ${sidebarPrelude(name)}
            const until = async (pred, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; await wait(50); } return false; };
            const dialog = () => !!document.querySelector('.tv-overlay:not(.is-closing) .tv-overlay__panel.tv-section');
            await openAt(${NARROW});
            el.querySelector('.tv-sidebar__panel-add-btn').click();
            await wait(100);
            menuItem(it => it.titleEl?.textContent === ${JSON.stringify(tr('sidebar.addSection'))});
            if (!(await until(dialog))) throw new Error('no section dialog');
            // The dialog's note field may have its list open under it: each is stepped back from first.
            const steps = [];
            for (let i = 0; i < 3 && dialog(); i++) {
                await back();
                steps.push(sidebar().shown);
            }
            const dialogClosed = !dialog();
            await back();
            return JSON.stringify({ dialogClosed, sidebarWhileDialog: steps.every(Boolean), after: sidebar() });
        })()`);
        expect(r).toEqual({
            dialogClosed: true,
            sidebarWhileDialog: true,
            after: { shown: false, saved: false, over: true },
        });
    });

    it('does not take the back from a tab shown over it, and takes it again once its tab is shown', () => {
        const r = ev<Record<string, unknown>>(`(async () => {
            ${sidebarPrelude(name)}
            await openAt(${NARROW});
            const own = R[${JSON.stringify(name)}];
            const other = app.workspace.getLeaf('tab');
            await other.setViewState({ type: 'empty', active: true });
            await wait(300);
            await back();
            const behind = sidebar();
            other.detach();
            app.workspace.setActiveLeaf(own, { focus: true });
            await wait(400);
            const shownAgain = sidebar();
            await back();
            return JSON.stringify({ behind, shownAgain, after: sidebar() });
        })()`);
        expect(r).toEqual({
            behind: { shown: true, saved: true, over: true },
            shownAgain: { shown: true, saved: true, over: true },
            after: { shown: false, saved: false, over: true },
        });
    });
});
