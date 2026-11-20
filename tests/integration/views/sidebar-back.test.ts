/**
 * The sidebar of Timeline and Calendar takes the user's "back" while it lies
 * open over the view (the view at or below the breakpoint), in the running
 * E2E vault. Obsidian's `history.back()` calls what is on top of its stack,
 * as Android's back and the mouse's back button do. The back closes it there
 * and leaves the view's `showSidebar` as it was. Beside the view (wider) the
 * back is left to the rest of the app; a dialog opened over the sidebar
 * takes it first; a view in a tab behind another does not take it, and its
 * sidebar is closed once its tab is shown again.
 *
 * The width is set on the view's own content (its leaf is the test's, so no
 * pane of the vault is resized), as the user's pane would be.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault open, with the current build
 *     loaded (the preflight builds it into the vault)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/sidebar-back.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { closeViews, ev, openView, PRELUDE, tr } from '../helpers/view-helper';
import { UNTIL } from '../helpers/waits';

const NARROW = 500;
const WIDE = 1000;

// A probe left in Obsidian's stack would take every back after it.
afterEach(() => {
    ev(`(() => { window.__tvBackProbe?.release(); return JSON.stringify(true); })()`);
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
        /**
         * Put a probe of the test's own on Obsidian's stack of what takes the
         * back, under whatever is put on it later, and count the backs that
         * reach it: one reaches it only when nothing above it holds the back.
         * It stands in the stack as a suggestion does, through the \`open\` and
         * \`close\` of \`PopoverSuggest\`, the class the editor's suggestions
         * extend, with no scope to push and no DOM to attach.
         */
        const probeBack = () => {
            // Open, the sidebar may hold the back already, and the probe would stand over its hold.
            if (shown()) throw new Error('the sidebar is open before the probe is put under it');
            let proto = Object.getPrototypeOf(app.workspace.editorSuggest.suggests[0] ?? {});
            while (proto && !['open', 'close', 'attachDom'].every(k => Object.hasOwn(proto, k))) proto = Object.getPrototypeOf(proto);
            if (!proto) throw new Error('no PopoverSuggest to stand in the stack by');
            const probe = {
                app: { keymap: { pushScope() {}, popScope() {} } },
                scope: null, isOpen: false, win: null, autoDestroy: null,
                suggestions: { setSuggestions() {} },
                attachDom() {}, detachDom() {},
                backs: 0,
                onHistoryBack() { this.backs++; },
                release() { proto.close.call(probe); delete window.__tvBackProbe; },
            };
            proto.open.call(probe);
            window.__tvBackProbe = probe;
            return probe;
        };
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
            after: { shown: false, saved: true, over: true },
            // Closed, it holds the back no more: the next one is the app's.
            again: { shown: false, saved: true, over: true },
        });
    });

    it('leaves the back alone while it lies beside the view: the back goes on to what is under it', () => {
        const r = ev<Record<string, unknown>>(`(async () => {
            ${sidebarPrelude(name)}
            const probe = probeBack();
            try {
                await openAt(${WIDE});
                const before = sidebar();
                await back();
                return JSON.stringify({ before, after: sidebar(), backsUnder: probe.backs });
            } finally {
                probe.release();
            }
        })()`);
        expect(r).toEqual({
            before: { shown: true, saved: true, over: false },
            after: { shown: true, saved: true, over: false },
            backsUnder: 1,
        });
    });

    it('lets go of the back once the view widens, and takes it again once the sidebar is opened over the narrowed view', () => {
        const r = ev<Record<string, unknown>>(`(async () => {
            ${sidebarPrelude(name)}
            await openAt(${WIDE});
            await openAt(${NARROW});
            el.style.width = '${WIDE}px';
            await wait(200);
            await back();
            const wide = sidebar();
            await openAt(${NARROW});
            await back();
            return JSON.stringify({ wide, narrowed: sidebar() });
        })()`);
        expect(r).toEqual({
            wide: { shown: true, saved: true, over: false },
            narrowed: { shown: false, saved: true, over: true },
        });
    });

    it('is under a dialog opened over it: the back closes the dialog first, then the sidebar', () => {
        const r = ev<Record<string, unknown>>(`(async () => {
            ${sidebarPrelude(name)}
            ${UNTIL}
            const dialog = () => !!document.querySelector('.tv-overlay:not(.is-closing) .tv-overlay__panel.tv-section');
            await openAt(${NARROW});
            el.querySelector('.tv-sidebar__panel-add-btn').click();
            await wait(100);
            menuItem(it => it.titleEl?.textContent === ${JSON.stringify(tr('sidebar.addSection'))});
            await until(dialog, 3000, 'no section dialog');
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
            after: { shown: false, saved: true, over: true },
        });
    });

    it('does not take the back from a tab shown over it, and is closed, holding none, once its tab is shown again', () => {
        const r = ev<Record<string, unknown>>(`(async () => {
            ${sidebarPrelude(name)}
            const probe = probeBack();
            try {
                await openAt(${NARROW});
                const own = R[${JSON.stringify(name)}];
                const other = app.workspace.getLeaf('tab');
                await other.setViewState({ type: 'empty', active: true });
                await wait(300);
                await back();
                const behind = sidebar();
                const backsUnderBehind = probe.backs;
                other.detach();
                app.workspace.setActiveLeaf(own, { focus: true });
                await wait(400);
                const shownAgain = sidebar();
                await back();
                return JSON.stringify({ behind, backsUnderBehind, shownAgain, after: sidebar(), backsUnder: probe.backs });
            } finally {
                probe.release();
            }
        })()`);
        expect(r).toEqual({
            behind: { shown: true, saved: true, over: true },
            // Held over the view, the back was let go of as the tab was hidden: it goes on to what is under it.
            backsUnderBehind: 1,
            shownAgain: { shown: false, saved: true, over: true },
            after: { shown: false, saved: true, over: true },
            backsUnder: 2,
        });
    });
});
