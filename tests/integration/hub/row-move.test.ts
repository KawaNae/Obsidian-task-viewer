/**
 * A row moved from its hub, in the running E2E vault: the button at the
 * end of the note's row where the row stands puts the destination's fields
 * in the place's stead, opened on where the row stands. A change of the
 * fields then is held, not written; [Move] writes it and where the row goes
 * at once and closes the hub, and [Cancel], once it asked whether to throw
 * the change and the destination away, leaves the note as it was and shows
 * where the row stands again. While it moves, the card is drawn from the
 * draft, its children too, and nothing is done on it.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/row-move.test.ts
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { DIALOG_ROWS } from '../helpers/dialog-rows';

const TEST_FILE = 'test-int-row-move.md';

const NOTE = [
    '# 予定',
    '- [ ] 動かす行',
    '# 済み',
    '- [ ] ほかの行',
    '',
].join('\n');

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
${DIALOG_ROWS}
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const rowNamed = start => plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(start));
const nameInput = () => hub().querySelector('.tv-form__name-section input');
/** The destination's fields, the note's and the heading's. */
const placeInputs = () => [...hub().querySelectorAll('.task-hub__place input')];
const moveButton = () => hub().querySelector('.task-hub__move');
const act = () => formRow(hub()).querySelector('.mod-cta');
const ask = () => formRow(hub()).querySelector('.tv-form__ask')?.textContent ?? null;
const type = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
const card = () => hub().querySelector('.task-hub__preview .task-card');
/** What is done on the card: whether it is marked as one nothing is done on, and its children's ⋯. */
const cardActs = () => ({ inert: card().dataset.inert === 'true', childMenus: card().querySelectorAll('.task-card__child-menu-btn').length });
const disk = () => app.vault.adapter.read(${JSON.stringify(TEST_FILE)});
/** Open the hub on the row, wait for the heading it stands under, and begin a move by the button: the fields opened. */
const beginMove = async () => {
    plugin.openTaskHub(rowNamed('動かす行').id);
    await until(() => hub()?.querySelector('.task-hub__shown') && [...hub().querySelectorAll('.task-hub__shown-value')][1].textContent === '予定');
    moveButton().click();
    await until(() => placeInputs().length === 2 && act());
    await sleep(100);
    return {
        fields: placeInputs().map(input => input.value),
        focusOnNote: document.activeElement === placeInputs()[0],
        act: act().textContent,
        canMove: !act().disabled,
        cancel: !!formRow(hub()).querySelector('.tv-form__cancel'),
    };
};
/** Rename the row and send it under 済み: the name typed, then the heading, which takes the name in as the focus leaves it. */
const renameAndRetarget = async () => {
    type(nameInput(), '直した行');
    type(placeInputs()[1], '済み');
    await until(() => !act().disabled, 3000);
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

afterEach(() => {
    run(`
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
        await sleep(100);
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-form__discard').forEach(b => b.click());
        await until(() => !document.querySelector('.tv-overlay'));
        return 'true';
    `);
});

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

const OPENED = {
    fields: [TEST_FILE.slice(0, -3), '予定'],
    focusOnNote: true,
    act: tr('modal.send.send'),
    canMove: false,
    cancel: true,
};

describe('a row moved from its hub', () => {
    it('writes the change held and where the row goes at once by [Move], and closes the hub', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<typeof OPENED & { held: string; open: boolean }>(`
            const opened = await beginMove();
            await renameAndRetarget();
            const held = await disk();
            act().click();
            await until(() => !hub(), 5000);
            return JSON.stringify({ ...opened, held, open: !!hub() });
        `);
        expect(seen).toEqual({ ...OPENED, held: NOTE, open: false });
        expect(readTestFile(TEST_FILE)).toBe(['# 予定', '# 済み', '- [ ] 直した行', '- [ ] ほかの行', ''].join('\n'));
    });

    it('leaves the note as it was by [Cancel], asking first, and shows where the row stands again', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<Record<string, unknown>>(`
            const opened = await beginMove();
            await renameAndRetarget();
            formRow(hub()).querySelector('.tv-form__cancel').click();
            await until(() => ask());
            const asked = ask();
            formRow(hub()).querySelector('.tv-form__discard').click();
            await until(() => hub().querySelector('.task-hub__shown'));
            await sleep(100);
            return JSON.stringify({
                opened,
                asked,
                open: !!hub(),
                fields: placeInputs().length,
                name: nameInput().value,
                focusOnButton: document.activeElement === moveButton(),
                act: !!act() && getComputedStyle(formRow(hub())).display !== 'none' && !formRow(hub()).hidden,
                disk: await disk(),
            });
        `);
        expect(seen).toEqual({
            opened: OPENED,
            asked: tr('modal.hub.move.discardAsk'),
            open: true,
            fields: 0,
            name: '動かす行',
            focusOnButton: true,
            act: false,
            disk: NOTE,
        });
    });

    it('draws the card from the draft while it moves, its children too, nothing done on it, and from the note again by [Cancel]', async () => {
        const TREE = ['# 予定', '- [ ] 子のある行', '    - [ ] 子の行', '# 済み', '- [ ] ほかの行', ''].join('\n');
        await writeIndexedTestFile(TEST_FILE, TREE);
        const seen = run<Record<string, unknown>>(`
            plugin.openTaskHub(rowNamed('子のある行').id);
            await until(() => card()?.querySelector('.task-card__child-menu-btn') && moveButton());
            const before = cardActs();
            moveButton().click();
            await until(() => placeInputs().length === 2 && act());
            const moving = cardActs();
            // A press on the child's checkbox writes nothing.
            card().querySelectorAll('input[type="checkbox"]')[1].click();
            await sleep(300);
            const afterPress = await disk();
            // A property put in on the details tab is a line of the draft's, shown on the card.
            chooseHubTab(hub(), 'detail');
            const key = hub().querySelector('.task-hub__prop-add .tv-form__label input');
            const value = hub().querySelector('.task-hub__prop-add input.tv-form__control');
            type(key, 'area');
            type(value, 'lab');
            value.dispatchEvent(new FocusEvent('blur'));
            await until(() => card().textContent.includes('area'), 3000);
            const shown = { property: card().textContent.includes('lab'), child: card().textContent.includes('子の行'), acts: cardActs() };
            const held = await disk();
            formRow(hub()).querySelector('.tv-form__cancel').click();
            await until(() => ask());
            formRow(hub()).querySelector('.tv-form__discard').click();
            await until(() => hub().querySelector('.task-hub__shown') && card()?.querySelector('.task-card__child-menu-btn'));
            return JSON.stringify({ before, moving, afterPress, shown, held, after: cardActs(), property: card().textContent.includes('lab') });
        `);
        expect(seen).toEqual({
            before: { inert: false, childMenus: 1 },
            moving: { inert: true, childMenus: 0 },
            afterPress: TREE,
            shown: { property: true, child: true, acts: { inert: true, childMenus: 0 } },
            held: TREE,
            after: { inert: false, childMenus: 1 },
            property: false,
        });
        expect(readTestFile(TEST_FILE)).toBe(TREE);
    });
});
