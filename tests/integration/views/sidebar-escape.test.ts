/**
 * The sidebar of Timeline and Calendar takes no Escape, in the running E2E
 * vault: an Escape leaves it open and its `showSidebar` as it was, whatever
 * has the focus, beside the view or lying open over it. The toggle, a click
 * on the backdrop and the back close it (sidebar-back reads the back).
 *
 * The Escape is a keydown sent to the element that has the focus, bubbling,
 * as the key reaches the window. What Obsidian does with it otherwise (the
 * active leaf it moves to) is Obsidian's, and is not read here.
 *
 * The width is set on the view's own content (its leaf is the test's, so no
 * pane of the vault is resized), as the user's pane would be.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault open, with the current build
 *     loaded (the preflight builds it into the vault)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/sidebar-escape.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createTeardown } from '../helpers/teardown';
import { deleteTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { closeViews, ev, PRELUDE } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';

const NOTE = 'test-int-sidebar-escape.md';
const NARROW = 500;
const WIDE = 1000;

const teardown = createTeardown();

beforeAll(async () => {
    teardown.add('delete the note', async () => { deleteTestFile(NOTE); await waitForFileDeindexed(NOTE); });
    await writeIndexedTestFile(NOTE, '- [ ] sidebar escape\n');
});

afterAll(() => teardown.run());

afterEach(async () => {
    await closeViews();
});

/** Snippet names to open views and the note in leaves of the test's, and to read a view's sidebar. */
const SCENE = `
    ${PRELUDE}
    ${UNTIL}
    /** Open a view of \`type\` with its sidebar open in a new tab of the active pane, named \`name\`, at the width \`w\`. */
    const openViewAt = async (name, type, w) => {
        const leaf = app.workspace.getLeaf('tab');
        await leaf.setViewState({ type, state: { showSidebar: true }, active: true });
        R[name] = leaf;
        leaf.view.contentEl.style.width = w + 'px';
        await wait(300);
        return leaf;
    };
    /** Open the test's note in \`leaf\`, in source mode, and put the focus in its editor. */
    const openNote = async (name, leaf) => {
        R[name] = leaf;
        await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}), { state: { mode: 'source', source: true } });
        app.workspace.setActiveLeaf(leaf, { focus: true });
        await wait(300);
        leaf.view.editor.focus();
        await wait(100);
        return leaf;
    };
    const sidebar = (name) => {
        const el = V(name).contentEl;
        return {
            shown: !el.querySelector('.tv-sidebar__panel').classList.contains('tv-sidebar__panel--hidden'),
            saved: V(name).getState().showSidebar ?? true,
            over: !!el.querySelector('.tv-sidebar--mobile'),
        };
    };
    const escape = async () => {
        key(document.activeElement ?? document.body, 'Escape');
        await wait(400);
    };
`;

describe('the sidebar and Escape', () => {
    it('stays open, its state kept, in a Calendar shown and a Timeline in a tab behind it, on an Escape in a note of another pane', () => {
        const r = ev<Record<string, unknown>>(`(async () => {
            ${SCENE}
            await openViewAt('esc-tl', 'timeline-view', ${WIDE});
            await openViewAt('esc-cal', 'calendar-view', ${WIDE});
            const note = await openNote('esc-note', app.workspace.getLeaf('split'));
            const scene = {
                inNote: note.view.containerEl.contains(document.activeElement),
                timelineBehind: V('esc-tl').contentEl.clientWidth === 0,
            };
            const before = { calendar: sidebar('esc-cal'), timeline: sidebar('esc-tl') };
            await escape();
            const after = { calendar: sidebar('esc-cal'), timeline: sidebar('esc-tl') };
            return JSON.stringify({ scene, before, after });
        })()`);
        const open = { shown: true, saved: true, over: false };
        expect(r).toEqual({
            scene: { inNote: true, timelineBehind: true },
            before: { calendar: open, timeline: open },
            after: { calendar: open, timeline: open },
        });
    });

    it('stays open, its state kept, on an Escape while its Timeline is active beside a tab of a note', () => {
        const r = ev<Record<string, unknown>>(`(async () => {
            ${SCENE}
            await openNote('esc-note', app.workspace.getLeaf('tab'));
            const timeline = await openViewAt('esc-tl', 'timeline-view', ${WIDE});
            app.workspace.setActiveLeaf(timeline, { focus: true });
            await wait(300);
            const active = app.workspace.activeLeaf === timeline;
            const before = sidebar('esc-tl');
            await escape();
            const after = sidebar('esc-tl');
            // Obsidian may have made the note's tab active: the Timeline is shown again to be read as the user sees it.
            app.workspace.setActiveLeaf(timeline, { focus: true });
            await wait(300);
            return JSON.stringify({ active, before, after, shownAgain: sidebar('esc-tl') });
        })()`);
        const open = { shown: true, saved: true, over: false };
        expect(r).toEqual({ active: true, before: open, after: open, shownAgain: open });
    });
});

describe.each([
    ['Timeline', 'timeline-view'],
    ['Calendar', 'calendar-view'],
])("%s's sidebar lying open over the view", (_label, type) => {
    it('stays open, its state kept, on an Escape', () => {
        const r = ev<Record<string, unknown>>(`(async () => {
            ${SCENE}
            const leaf = await openViewAt('esc-narrow', ${JSON.stringify(type)}, ${NARROW});
            const el = leaf.view.contentEl;
            // At narrow width the sidebar opens only from the toggle, as the user opens it.
            if (!sidebar('esc-narrow').shown) el.querySelector('.sidebar-toggle-button-icon').click();
            await until(() => sidebar('esc-narrow').shown, 3000, 'the sidebar did not open');
            await wait(400);
            const before = sidebar('esc-narrow');
            await escape();
            return JSON.stringify({ before, after: sidebar('esc-narrow') });
        })()`);
        const open = { shown: true, saved: true, over: true };
        expect(r).toEqual({ before: open, after: open });
    });
});
