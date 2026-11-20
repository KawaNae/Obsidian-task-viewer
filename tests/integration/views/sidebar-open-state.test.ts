/**
 * Whether the sidebar of Timeline and Calendar is open, beside the view and
 * over it, in the running E2E vault. Beside the view (wide) it is the view's
 * `showSidebar`, written by the toggle alone. Over the view (narrow) it is a
 * value the sidebar holds and saves nowhere: the toggle, the backdrop and the
 * back open and close it there and leave `showSidebar` as it was, and each
 * time the view is shown narrow (narrowed, opened anew, or its tab shown
 * again) the sidebar starts closed.
 *
 * The width is set on the view's own content (its leaf is the test's, so no
 * pane of the vault is resized), as the user's pane would be.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault open, with the current build
 *     loaded (the preflight builds it into the vault)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/sidebar-open-state.test.ts
 */
import { describe, it, expect, afterEach } from 'vitest';
import { closeViews, copyUri, ev, openView, PRELUDE } from '../helpers/view-helper';

const NARROW = 500;
const WIDE = 1000;

afterEach(async () => {
    await closeViews();
});

/** Snippet names for the sidebar of the view `name`. */
function sidebarPrelude(name: string): string {
    return `
        ${PRELUDE}
        const el = () => V(${JSON.stringify(name)}).contentEl;
        const shown = () => !el().querySelector('.tv-sidebar__panel').classList.contains('tv-sidebar__panel--hidden');
        /** The sidebar as the user sees it, its toolbar button and the state the view saves. */
        const sidebar = () => ({
            shown: shown(),
            button: el().querySelector('.sidebar-toggle-button-icon').classList.contains('is-open'),
            saved: V(${JSON.stringify(name)}).getState().showSidebar ?? true,
            over: !!el().querySelector('.tv-sidebar--mobile'),
        });
        const width = async (w) => { el().style.width = w + 'px'; await wait(200); };
        const toggle = async () => { el().querySelector('.sidebar-toggle-button-icon').click(); await wait(400); };
        const backdrop = async () => { el().querySelector('.tv-sidebar__backdrop').click(); await wait(400); };
        const back = async () => { window.history.back(); await wait(400); };
    `;
}

/** The sidebar of a view, as `sidebarPrelude`'s `sidebar` reads it. */
interface Sidebar { shown: boolean; button: boolean; saved: boolean; over: boolean }

/** Whether the layout is set to slide, and whether the panel's transform ran a transition. */
interface Slide { animate: boolean; slid: boolean }

const look = (shown: boolean, saved: boolean, over: boolean): Sidebar => ({ shown, button: shown, saved, over });

describe.each([
    ['Timeline', 'timeline-view'],
    ['Calendar', 'calendar-view'],
])("%s's sidebar, beside the view and over it", (_label, type) => {
    const name = `open-state-${type}`;

    it('closes once the view narrows, opened beside it with the toggle', () => {
        openView(name, type, { showSidebar: false });
        const r = ev<Record<string, Sidebar>>(`(async () => {
            ${sidebarPrelude(name)}
            await width(${WIDE});
            await toggle();
            const wide = sidebar();
            await width(${NARROW});
            return JSON.stringify({ wide, narrowed: sidebar() });
        })()`);
        expect(r).toEqual({ wide: look(true, true, false), narrowed: look(false, true, true) });
    });

    it('closes once the view narrows, opened beside it by the saved state', () => {
        openView(name, type, { showSidebar: true });
        const r = ev<Record<string, Sidebar>>(`(async () => {
            ${sidebarPrelude(name)}
            await width(${WIDE});
            const wide = sidebar();
            await width(${NARROW});
            return JSON.stringify({ wide, narrowed: sidebar() });
        })()`);
        expect(r).toEqual({ wide: look(true, true, false), narrowed: look(false, true, true) });
    });

    it('is as it was beside the view once the view widens, closed over it by the backdrop or the toggle', () => {
        openView(name, type, { showSidebar: true });
        const r = ev<Record<string, Sidebar>>(`(async () => {
            ${sidebarPrelude(name)}
            await width(${NARROW});
            await toggle();
            const opened = sidebar();
            await backdrop();
            const byBackdrop = sidebar();
            await width(${WIDE});
            const widenedFromBackdrop = sidebar();
            await width(${NARROW});
            await toggle();
            await toggle();
            const byToggle = sidebar();
            await width(${WIDE});
            return JSON.stringify({ opened, byBackdrop, widenedFromBackdrop, byToggle, widenedFromToggle: sidebar() });
        })()`);
        expect(r).toEqual({
            opened: look(true, true, true),
            byBackdrop: look(false, true, true),
            widenedFromBackdrop: look(true, true, false),
            byToggle: look(false, true, true),
            widenedFromToggle: look(true, true, false),
        });
    });

    it('is closed once the view widens, closed beside it and opened over it, and closed once the view narrows again', () => {
        openView(name, type, { showSidebar: false });
        const r = ev<Record<string, Sidebar>>(`(async () => {
            ${sidebarPrelude(name)}
            await width(${WIDE});
            const wide = sidebar();
            await width(${NARROW});
            await toggle();
            const opened = sidebar();
            await width(${WIDE});
            const widened = sidebar();
            await width(${NARROW});
            return JSON.stringify({ wide, opened, widened, narrowedAgain: sidebar() });
        })()`);
        expect(r).toEqual({
            wide: look(false, false, false),
            opened: look(true, false, true),
            widened: look(false, false, false),
            narrowedAgain: look(false, false, true),
        });
    });

    it('is closed in the view opened anew from the state it saved, opened over it before', () => {
        openView(name, type, { showSidebar: false });
        const r = ev<Record<string, unknown>>(`(async () => {
            ${sidebarPrelude(name)}
            await width(${NARROW});
            await toggle();
            const opened = sidebar();
            const state = V(${JSON.stringify(name)}).getState();
            R[${JSON.stringify(name)}].detach();
            await wait(100);
            const leaf = app.workspace.getLeaf('tab');
            await leaf.setViewState({ type: ${JSON.stringify(type)}, state, active: true });
            R[${JSON.stringify(name)}] = leaf;
            await wait(300);
            await width(${WIDE});
            const reopenedWide = sidebar();
            await width(${NARROW});
            return JSON.stringify({ opened, reopenedWide, reopenedNarrow: sidebar() });
        })()`);
        expect(r).toEqual({
            opened: look(true, false, true),
            reopenedWide: look(false, false, false),
            reopenedNarrow: look(false, false, true),
        });
    });

    it('is closed once its tab is shown again, opened over the view before another tab was shown', () => {
        openView(name, type, { showSidebar: true });
        const r = ev<Record<string, unknown>>(`(async () => {
            ${sidebarPrelude(name)}
            await width(${NARROW});
            await toggle();
            const opened = sidebar();
            // The widths the view's content is seen at, by a watcher of the kind the sidebar puts on it.
            const seen = [];
            const watcher = new ResizeObserver(() => seen.push(el().clientWidth));
            watcher.observe(el());
            await wait(100);
            const own = R[${JSON.stringify(name)}];
            const other = app.workspace.getLeaf('tab');
            await other.setViewState({ type: 'empty', active: true });
            await wait(300);
            const hiddenWidth = el().clientWidth;
            other.detach();
            app.workspace.setActiveLeaf(own, { focus: true });
            await wait(400);
            watcher.disconnect();
            const shownAgain = sidebar();
            await back();
            return JSON.stringify({ opened, hiddenWidth, seen, shownAgain, afterBack: sidebar() });
        })()`);
        expect(r).toEqual({
            opened: look(true, true, true),
            hiddenWidth: 0,
            // Hidden, the content is seen with no width; shown again, at its own.
            seen: [NARROW, 0, NARROW],
            shownAgain: look(false, true, true),
            afterBack: look(false, true, true),
        });
    });

    it('stays open over the view while the view stays narrow, its width changing', () => {
        openView(name, type, { showSidebar: false });
        const r = ev<Record<string, Sidebar>>(`(async () => {
            ${sidebarPrelude(name)}
            await width(${NARROW});
            await toggle();
            await width(${NARROW - 100});
            await width(768);
            return JSON.stringify({ narrowedMore: sidebar() });
        })()`);
        expect(r).toEqual({ narrowedMore: look(true, false, true) });
    });

    it('slides as the toggle, the backdrop and the back open and close it, and not as the view narrows', () => {
        openView(name, type, { showSidebar: true });
        const r = ev<Record<string, Slide>>(`(async () => {
            ${sidebarPrelude(name)}
            const panel = el().querySelector('.tv-sidebar__panel');
            /**
             * Do \`act\`, then read whether the layout is set to slide and
             * whether the panel's own transform did move over a time: a
             * change applied at once runs no transition.
             */
            const scene = async (act) => {
                let slid = false;
                const heard = (e) => { if (e.target === panel && e.propertyName === 'transform') slid = true; };
                panel.addEventListener('transitionrun', heard);
                try {
                    await act();
                } finally {
                    panel.removeEventListener('transitionrun', heard);
                }
                return { animate: el().querySelector('.tv-sidebar').classList.contains('tv-sidebar--animate'), slid };
            };
            await width(${WIDE});
            const wideClosing = await scene(toggle);
            const wideOpening = await scene(toggle);
            const narrowed = await scene(() => width(${NARROW}));
            const narrowOpening = await scene(toggle);
            const byBackdrop = await scene(backdrop);
            await toggle();
            const byBack = await scene(back);
            return JSON.stringify({ wideClosing, wideOpening, narrowed, narrowOpening, byBackdrop, byBack });
        })()`);
        const slides: Slide = { animate: true, slid: true };
        expect(r).toEqual({
            wideClosing: slides,
            wideOpening: slides,
            narrowed: { animate: false, slid: false },
            narrowOpening: slides,
            byBackdrop: slides,
            byBack: slides,
        });
    });

    it('copies into its URI the showSidebar of the wide width, whatever was done over the view', () => {
        openView(name, type, { showSidebar: true });
        ev(`(async () => {
            ${sidebarPrelude(name)}
            await width(${NARROW});
            await toggle();
            await toggle();
            // The toolbar's menu is read at the width it has beside the view.
            await width(${WIDE});
            return JSON.stringify(true);
        })()`);
        const uri = copyUri(name);
        expect(new URL(uri).searchParams.get('showSidebar')).toBe('true');
    });
});
