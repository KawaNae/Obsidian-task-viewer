/**
 * The tabs of a row's hub, in the running E2E vault.
 *
 * - The tab the hub opens on is the tab of the field it is opened on: from
 *   the card menu's Properties, Tags opens it on Details with the focus in
 *   the tag field, the other tab off; Name and Start open it on General with
 *   the focus in their field.
 * - The panel is as tall as General makes it, whichever tab is chosen: a
 *   hub opened once and its tabs chosen one after the other keeps its
 *   panel's place and size, on the desktop's centered box and on a phone's
 *   sheet (`.is-phone` on the body), for a row with no properties and one
 *   with many, whose Details is taller than General and is scrolled to by
 *   the body. A hub opened on Details stands as one opened on General.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/row-tabs.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { MENUS } from '../helpers/menus';
import { DIALOG_ROWS } from '../helpers/dialog-rows';

const TEST_FILE = 'test-int-row-tabs.md';

const NOTE = [
    '# 見出し',
    '- [ ] 名前のある行 @2031-01-21',
    '- [ ] 背の高い行 @2031-01-21',
    ...Array.from({ length: 8 }, (_, i) => `\t- p${i + 1}:: v${i + 1}`),
    '',
].join('\n');

const PRELUDE = `
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
${MENUS}
${DIALOG_ROWS}
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const body = () => hub().querySelector('.tv-overlay__body');
const rowNamed = start => plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(start));
const nameInput = () => hub()?.querySelector('.tv-form__name-section input') ?? null;
/** The start's date: the text field of the first row of dates. */
const startInput = () => hub()?.querySelector('.tv-form__field--date input[type="text"]') ?? null;
const tagInput = () => hub()?.querySelector('.task-hub__tag-add-wrap input') ?? null;
const nextFrame = () => new Promise(r => requestAnimationFrame(r));
/** Wait for the hub to be open: its panel's open animation ended and the focus in it. */
const opened = async () => {
    await until(() => hub());
    await until(() => hub().getAnimations().every(a => a.playState !== 'running'), 3000);
    await until(() => hub().contains(document.activeElement));
};
const rectOf = el => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height }; };
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

beforeAll(async () => {
    // Focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
    await writeIndexedTestFile(TEST_FILE, NOTE);
});

afterEach(() => {
    run(`
        document.body.classList.remove('is-phone');
        closeMenus();
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
        await until(() => !document.querySelector('.tv-overlay'));
        return 'true';
    `);
});

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('the tab a hub opens on from the card menu\'s Properties', () => {
    interface Opened {
        tab: string | null;
        /** Whether the field the item names has the focus. */
        focused: boolean;
        /** Whether the tab chosen holds the field, and whether the other tab is off. */
        inTab: boolean;
        otherOff: boolean;
    }

    const ITEMS = {
        tags: { title: `one => one.titleEl?.textContent === ${JSON.stringify(tr('menu.tagsLabel', { value: '-' }))}`, field: 'tagInput()' },
        name: { title: `one => one.titleEl?.textContent === ${JSON.stringify(tr('menu.name', { name: '名前のある行' }))}`, field: 'nameInput()' },
        start: { title: `one => one.titleEl?.textContent.startsWith(${JSON.stringify(tr('menu.startLabel'))})`, field: 'startInput()' },
    } as const;

    function openFromMenu(item: keyof typeof ITEMS): Opened {
        return run<Opened>(`
            const row = rowNamed('名前のある行');
            // The card menu the hub's cards open, made as a hub first opens.
            if (!plugin.taskHub.cards) {
                plugin.openTaskHub(row.id);
                await until(() => hub());
                hub().closest('.tv-overlay__panel').querySelector('.tv-overlay__close').click();
                await until(() => !document.querySelector('.tv-overlay'));
            }
            await plugin.taskHub.cards.menuHandler.showContextMenu(0, 0, row);
            await until(() => menuTitles().includes(${JSON.stringify(tr('menu.properties'))}), 3000, () => menuTitles().join('|'));
            menuItem(${ITEMS[item].title}, { within: one => one.titleEl?.textContent === ${JSON.stringify(tr('menu.properties'))} });
            const field = () => ${ITEMS[item].field};
            await until(() => field() && document.activeElement === field(), 3000,
                () => 'the focus is on ' + document.activeElement?.className + ', the tab ' + hubTabOn(hub()));
            const tab = hubTabOn(hub());
            const other = tab === 'basic' ? 'detail' : 'basic';
            return JSON.stringify({
                tab,
                focused: document.activeElement === field(),
                inTab: hubPane(hub(), tab).contains(field()),
                otherOff: hubPane(hub(), other).hasAttribute('inert'),
            });
        `);
    }

    it('opens on Details with the focus in the tag field from Tags', () => {
        expect(openFromMenu('tags')).toEqual({ tab: 'detail', focused: true, inTab: true, otherOff: true });
    });

    it.each(['name', 'start'] as const)('opens on General with the focus in its field from %s', (item) => {
        expect(openFromMenu(item)).toEqual({ tab: 'basic', focused: true, inTab: true, otherOff: true });
    });
});

describe('the panel keeps its place and size as the tabs are chosen', () => {
    interface Rect { top: number; left: number; width: number; height: number }
    interface Chosen {
        /** The panel, and the body's height and what it holds, on General, then Details, then General again. */
        panel: Rect[];
        clientHeight: number[];
        scrollHeight: number[];
        /** Details' height and General's. */
        detail: number;
        basic: number;
        /** The panel of the hub opened again on the tag field, so on Details. */
        onDetail: { tab: string | null; panel: Rect };
    }

    function chooseTabs(row: string, phone: boolean): Chosen {
        return run<Chosen>(`
            if (${phone}) document.body.classList.add('is-phone');
            plugin.openTaskHub(rowNamed(${JSON.stringify(row)}).id);
            await opened();
            const panel = () => hub().closest('.tv-overlay__panel');
            const seen = { panel: [], clientHeight: [], scrollHeight: [] };
            const read = () => {
                seen.panel.push(rectOf(panel()));
                seen.clientHeight.push(body().clientHeight);
                seen.scrollHeight.push(body().scrollHeight);
            };
            read();
            chooseHubTab(hub(), 'detail');
            await nextFrame();
            read();
            seen.detail = hubPane(hub(), 'detail').getBoundingClientRect().height;
            chooseHubTab(hub(), 'basic');
            await nextFrame();
            read();
            seen.basic = hubPane(hub(), 'basic').getBoundingClientRect().height;
            panel().querySelector('.tv-overlay__close').click();
            await until(() => !document.querySelector('.tv-overlay'));
            plugin.openTaskHub(rowNamed(${JSON.stringify(row)}).id, { focusField: 'tags' });
            await opened();
            seen.onDetail = { tab: hubTabOn(hub()), panel: rectOf(panel()) };
            return JSON.stringify(seen);
        `);
    }

    function expectSame(a: Rect, b: Rect): void {
        expect(Math.abs(a.top - b.top)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(a.left - b.left)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(0.5);
    }

    for (const phone of [false, true]) {
        const where = phone ? "a phone's sheet" : "the desktop's box";

        it(`${where}, a row with no properties`, () => {
            const seen = chooseTabs('名前のある行', phone);
            for (const p of seen.panel) expectSame(p, seen.panel[0]);
            expect(seen.clientHeight[1]).toBe(seen.clientHeight[0]);
            expect(seen.onDetail.tab).toBe('detail');
            expectSame(seen.onDetail.panel, seen.panel[0]);
        });

        it(`${where}, a row with many properties, its Details taller than General and scrolled to by the body`, () => {
            const seen = chooseTabs('背の高い行', phone);
            expect(seen.detail).toBeGreaterThan(seen.basic + 100);
            for (const p of seen.panel) expectSame(p, seen.panel[0]);
            expect(seen.clientHeight[1]).toBe(seen.clientHeight[0]);
            // Details runs past General's row: the body holds more on it, and as much as before on General again.
            expect(seen.scrollHeight[1]).toBeGreaterThan(seen.scrollHeight[0] + 100);
            expect(seen.scrollHeight[2]).toBe(seen.scrollHeight[0]);
            expect(seen.onDetail.tab).toBe('detail');
            expectSame(seen.onDetail.panel, seen.panel[0]);
        });
    }
});
