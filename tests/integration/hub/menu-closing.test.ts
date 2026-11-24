/**
 * A field focused from a card menu's item while the menu takes time to go,
 * in the running E2E vault: when the field takes the focus, and when the
 * menu has gone (`MenuPresenter.currentMenu` let go of).
 *
 * The phone's menu is a sheet that slides away once an item is chosen, and
 * Obsidian tells the menu has gone (`onHide`) once it has. A field focused
 * meanwhile raises the on-screen keyboard under the sheet still sliding
 * away. The desktop's menu goes at once, so the sheet's closing is made by
 * the menu's `hide` waiting `CLOSING` ms (`menuItem`'s `closingMs`), long
 * beyond the overlay's open animation (0.15 s).
 *
 * Chosen in a card menu elsewhere, the item opens the hub, whose panel
 * holds the focus while the menu is there: its field takes the focus once
 * the menu has gone (`placeFirstFocus`). Chosen in the hub's own card, the
 * item focuses the form's field as it is chosen, the menu still there.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/menu-closing.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { MENUS } from '../helpers/menus';

const TEST_FILE = 'test-int-menu-closing.md';
const ROW = '閉じる行';

const NOTE = [
    '# 見出し',
    `- [ ] ${ROW} @2031-01-21`,
    '',
].join('\n');

/** How long the menu takes to go once told to: beyond the overlay's open animation. */
const CLOSING = 400;

const PRELUDE = `
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
${MENUS}
const hubs = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing) .task-hub')];
const hub = () => hubs().pop() ?? null;
const nameInput = () => hub()?.querySelector('.tv-form__name-section input') ?? null;
const row = () => {
    const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(${JSON.stringify(ROW)}));
    if (!task) throw new Error('no row');
    return task;
};
/**
 * Choose Properties › Name in the menu open, the menu taking CLOSING ms to
 * go; then, from frame to frame, whether the name field has the focus and
 * whether the menu is still there, until the menu has gone and the field
 * has the focus (3 s at most).
 */
const chooseName = async () => {
    const menu = tvMenus().currentMenu;
    if (!menu) throw new Error('no menu open');
    menuItem(i => i.titleEl?.textContent === ${JSON.stringify(tr('menu.name', { name: ROW }))}, {
        within: i => i.titleEl?.textContent === ${JSON.stringify(tr('menu.properties'))},
        closingMs: ${CLOSING},
    });
    const chosen = { focused: document.activeElement === nameInput(), menu: tvMenus().currentMenu === menu };
    const t0 = performance.now();
    const frames = [];
    for (;;) {
        await new Promise(r => requestAnimationFrame(r));
        const panel = hub()?.closest('.tv-overlay__panel') ?? null;
        const frame = {
            t: Math.round(performance.now() - t0),
            focused: !!nameInput() && document.activeElement === nameInput(),
            panel: !!panel && document.activeElement === panel,
            menu: tvMenus().currentMenu === menu,
        };
        frames.push(frame);
        if ((!frame.menu && frame.focused) || frame.t > 3000) break;
    }
    const focusedAt = frames.find(f => f.focused) ?? null;
    const whileMenu = frames.filter(f => f.menu);
    return {
        chosen,
        focusedAt,
        goneAt: frames.find(f => !f.menu)?.t ?? null,
        whileMenu: { frames: whileMenu.length, focused: whileMenu.some(f => f.focused), panel: whileMenu.filter(f => f.panel).length },
    };
};
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

interface Seen {
    /** Right as the item was chosen: whether the name field had the focus, and whether the menu was there. */
    chosen: { focused: boolean; menu: boolean };
    /** The first frame the name field had the focus, ms after the item was chosen, and whether the menu was there. */
    focusedAt: { t: number; focused: boolean; panel: boolean; menu: boolean } | null;
    /** The first frame the menu had gone, ms after the item was chosen. */
    goneAt: number | null;
    /** The frames the menu was still there: how many, whether the name field had the focus in one, and in how many the hub's panel had it. */
    whileMenu: { frames: number; focused: boolean; panel: number };
}

beforeAll(async () => {
    // Focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
    await writeIndexedTestFile(TEST_FILE, NOTE);
});

afterEach(() => {
    run(`
        tvMenus().dismiss();
        await until(() => !tvMenus().currentMenu, ${CLOSING * 3});
        for (let i = 0; i < 4 && hub(); i++) {
            const top = hub();
            top.closest('.tv-overlay__panel').querySelector('.tv-overlay__close').click();
            await until(() => !hubs().includes(top));
        }
        return 'true';
    `);
});

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('a field focused from a menu that takes time to go', () => {
    it('in the hub\'s own card menu: the form\'s field takes the focus as the item is chosen, the menu still there', () => {
        const seen = run<Seen>(`
            plugin.openTaskHub(row().id);
            await until(() => hub() && hub().contains(document.activeElement));
            hub().querySelector('.task-hub__preview .task-card')
                .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
            await until(() => menuTitles().includes(${JSON.stringify(tr('menu.properties'))}), 3000, () => menuTitles().join('|'));
            return JSON.stringify(await chooseName());
        `);
        expect(seen.chosen).toEqual({ focused: true, menu: true });
        expect(seen.goneAt).not.toBeNull();
        expect(seen.goneAt!).toBeGreaterThanOrEqual(CLOSING - 50);
    });

    it('in a card menu out of the hub: the hub it opens holds the focus on its panel while the menu is there, and focuses the field once it has gone', () => {
        const seen = run<Seen>(`
            // The card menu the hub's cards open, made as a hub first opens.
            if (!plugin.taskHub.cards) {
                plugin.openTaskHub(row().id);
                await until(() => hub());
                hub().closest('.tv-overlay__panel').querySelector('.tv-overlay__close').click();
                await until(() => !hub());
            }
            await plugin.taskHub.cards.menuHandler.showContextMenu(0, 0, row());
            await until(() => menuTitles().includes(${JSON.stringify(tr('menu.properties'))}), 3000, () => menuTitles().join('|'));
            return JSON.stringify(await chooseName());
        `);
        expect(seen.chosen).toEqual({ focused: false, menu: true });
        expect(seen.goneAt).not.toBeNull();
        expect(seen.goneAt!).toBeGreaterThanOrEqual(CLOSING - 50);
        expect(seen.whileMenu.focused).toBe(false);
        // Past the hub's open animation (0.15 s), the panel holds the focus while the menu is there.
        expect(seen.whileMenu.panel).toBeGreaterThan(0);
        expect(seen.focusedAt).not.toBeNull();
        expect(seen.focusedAt!.menu).toBe(false);
        expect(seen.focusedAt!.t).toBeGreaterThanOrEqual(seen.goneAt!);
    });
});
