/**
 * The first focus of a move of a row, in the running E2E vault: whichever
 * way the hub comes into the move, the note field of where the row goes
 * takes the focus once the move's fields, the row of buttons and the line
 * above [Move] are all drawn, and stands in the body's sight.
 *
 * - On a phone's sheet, a row whose card makes the body scroll: the pencil
 *   pressed with the body scrolled until the pencil's row is at the body's
 *   bottom (as a user scrolls no further than to reach it: the row of
 *   buttons that comes in with the move would cover it), the card's menu in
 *   the hub chosen from its Details tab, and the hub opened in the move from
 *   a card's menu outside it, the place below the body's bottom as it opens.
 *   The note field has the focus, its top and bottom within the body's
 *   room, and the Details tab gives way to the basic tab.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/row-move-focus.test.ts
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { KEYBOARD, resetKeyboard } from '../helpers/keyboard';
import { MENUS } from '../helpers/menus';
import { DIALOG_ROWS } from '../helpers/dialog-rows';

const TEST_FILE = 'test-int-row-move-focus.md';

/** A row with children enough that its card and the form below make the body scroll. */
const NOTE = [
    '# 予定',
    '- [ ] 背の高い行',
    ...Array.from({ length: 30 }, (_, i) => `    - [ ] 子${i + 1}`),
    '# 済み',
    '- [ ] ほかの行',
    '',
].join('\n');

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
${KEYBOARD}
${MENUS}
${DIALOG_ROWS}
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const body = () => hub().querySelector('.tv-overlay__body');
const row = () => plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith('背の高い行'));
const placeInputs = () => [...(hub()?.querySelectorAll('.task-hub__place input') ?? [])];
const act = () => formRow(hub())?.querySelector('.mod-cta') ?? null;
const card = () => hub().querySelector('.task-hub__preview .task-card');
const sendItem = one => one.titleEl?.textContent === ${JSON.stringify(tr('menu.sendToNote'))};
/** Where \`el\` stands against the body's room: its top and bottom less the body's top, and the room's height. */
const against = el => {
    const room = body().getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { top: r.top - room.top, bottom: r.bottom - room.top, room: body().clientHeight };
};
const openHub = async () => {
    phoneLayout();
    plugin.openTaskHub(row().id);
    await until(() => hub()?.querySelector('.task-hub__shown') && hub().querySelector('.task-hub__move'));
    await sleep(400);
};
/** Once the move's fields and [Move] are drawn and the note field has the focus: where it stands. */
const settled = async () => {
    await until(() => placeInputs().length === 2 && act());
    const focused = await until(() => document.activeElement === placeInputs()[0], 3000).then(() => true, () => false);
    await sleep(150);
    return { focused, note: against(placeInputs()[0]), active: document.activeElement?.className ?? null };
};
`;

function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

interface Place { top: number; bottom: number; room: number }
interface Seen { focused: boolean; note: Place; active: string | null }

/** The field stands whole in the body's room. */
function inSight(place: Place): void {
    expect(place.top).toBeGreaterThanOrEqual(-0.5);
    expect(place.bottom).toBeLessThanOrEqual(place.room + 0.5);
}

afterEach(() => {
    run(`
        closeMenus();
        // The × is hidden on a sheet, and pressed by script all the same; a discard asked is answered.
        for (let i = 0; i < 3 && document.querySelector('.tv-overlay:not(.is-closing)'); i++) {
            for (const root of document.querySelectorAll('.tv-overlay:not(.is-closing)')) root.querySelector('.tv-overlay__close')?.click();
            await sleep(150);
            document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-form__discard').forEach(b => b.click());
            await sleep(150);
        }
        await until(() => !document.querySelector('.tv-overlay'), 5000, () => document.querySelector('.tv-overlay')?.className);
        return 'true';
    `);
    resetKeyboard();
});

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('the first focus of a move, on a phone\'s sheet whose body scrolls', () => {
    it('is on the note field, in the body\'s sight, once the pencil is pressed with its row at the body\'s bottom', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<Seen & { pencil: Place }>(`
            await openHub();
            const pencil = hub().querySelector('.task-hub__move');
            const b = body();
            b.scrollTo({ top: b.scrollTop + against(pencil.parentElement).bottom - b.clientHeight, behavior: 'instant' });
            await sleep(50);
            const at = against(pencil);
            pencil.focus();
            pencil.click();
            return JSON.stringify({ pencil: at, ...(await settled()) });
        `);
        // The pencil stood in sight, at the body's bottom.
        expect(seen.pencil.bottom).toBeLessThanOrEqual(seen.pencil.room + 0.5);
        expect(seen.pencil.bottom).toBeGreaterThan(seen.pencil.room - 10);
        expect(seen.focused).toBe(true);
        inSight(seen.note);
    });

    it('is on the note field, in the body\'s sight, once the hub\'s card menu moves the row from the Details tab', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<Seen & { tab: string | null }>(`
            await openHub();
            chooseHubTab(hub(), 'detail');
            await sleep(100);
            card().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
            await until(() => menuItems().some(sendItem));
            menuItem(sendItem);
            const s = await settled();
            return JSON.stringify({ ...s, tab: hubTabOn(hub()) });
        `);
        expect(seen.focused).toBe(true);
        expect(seen.tab).toBe('basic');
        inSight(seen.note);
    });

    it('is on the note field, in the body\'s sight, once the hub opens in the move from a card\'s menu outside it', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<Seen>(`
            phoneLayout();
            // The card menu the hub's cards open, made as a hub first opens.
            if (!plugin.taskHub.cards) {
                plugin.openTaskHub(row().id);
                await until(() => hub());
                hub().closest('.tv-overlay')?.querySelector('.tv-overlay__backdrop')?.click();
                await until(() => !document.querySelector('.tv-overlay'));
            }
            await plugin.taskHub.cards.menuHandler.showContextMenu(0, 0, row());
            menuItem(sendItem);
            await until(() => hub());
            return JSON.stringify(await settled());
        `);
        expect(seen.focused).toBe(true);
        inSight(seen.note);
    });
});
