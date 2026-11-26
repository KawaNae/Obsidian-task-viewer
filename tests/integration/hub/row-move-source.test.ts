/**
 * The source opened while the hub moves a row, in the running E2E vault:
 * the editor shows the move's draft, not the disk's row, and writes nothing
 * itself. The fields of the row's values are shut while it is open, those
 * of where the row goes take edits, and the form's [Cancel] and [Move] are
 * the only buttons. The switch back to the card takes the text into the
 * draft, and [Move] takes it in first and writes it with where the row
 * goes; a text that does not take is said under the editor. The notes'
 * bytes are read back from the disk.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/row-move-source.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { openDialog } from '../helpers/send-dialog';
import { deleteTestFile, readTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { DIALOG_ROWS } from '../helpers/dialog-rows';

const TEST_FILE = 'test-int-row-move-source.md';

const NOTE = [
    '# 予定',
    '- [ ] 動かす行',
    '    - [ ] 子a',
    '    - [ ] 子b',
    '# 済み',
    '- [ ] ほかの行',
    '',
].join('\n');

/** The row moved under 済み, its children as given. */
const movedWith = (...children: string[]) => ['# 予定', '# 済み', '- [ ] 動かす行', ...children.map(child => `    - [ ] ${child}`), '- [ ] ほかの行', ''].join('\n');

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
const shown = el => !!el && !el.hidden && getComputedStyle(el).display !== 'none';
const ask = () => { const el = formRow(hub())?.querySelector('.tv-form__ask'); return shown(el) ? el.textContent : null; };
/** The buttons of the form's row a person sees, by their text. */
const buttons = () => [...formRow(hub()).querySelectorAll('button')].filter(b => shown(b) && b.textContent).map(b => b.textContent);
const buttonNamed = text => [...formRow(hub()).querySelectorAll('button')].find(b => shown(b) && b.textContent === text);
const type = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
const disk = () => app.vault.adapter.read(${JSON.stringify(TEST_FILE)});
/** The switch's buttons: the pencil (the card) and the source. */
const pencil = () => hub().querySelectorAll('.task-hub__mode-toggle button')[0];
const sourceButton = () => hub().querySelectorAll('.task-hub__mode-toggle button')[1];
/** A button pressed as a person presses it: it takes the focus, then the click. */
const pressButton = button => { button.focus(); button.click(); };
const viewOf = which => {
    const el = hub()?.querySelector('.tv-source-editor__' + which + ' .cm-content');
    return el ? (el.cmTile?.view ?? el.cmView?.rootView?.view ?? null) : null;
};
/** Which editor has the focus: 'parent', 'children', or null. */
const focused = () => ['parent', 'children'].find(which => document.activeElement === hub()?.querySelector('.tv-source-editor__' + which + ' .cm-content')) ?? null;
/** Replace the text of the editor \`which\` from \`from\` to \`to\` (its end when not given) with \`insert\`. */
const edit = (which, from, to, insert) => { const view = viewOf(which); view.dispatch({ changes: { from, to: to ?? view.state.doc.length, insert } }); };
/** What is said above the form's fields of a shut. */
const shutSays = () => [...hub().querySelectorAll('.task-hub__form > .tv-form__says--form .tv-form__warning')].map(el => el.textContent);
/** What the line above the form's row says (where a move not made says why). */
const footSays = () => [...(hub().querySelector('.task-hub__create-says')?.children ?? [])].filter(shown).map(el => el.textContent);
/** The source as it shows now. */
const source = () => ({
    open: !!viewOf('children'),
    parent: viewOf('parent')?.state.doc.toString() ?? null,
    children: viewOf('children')?.state.doc.toString() ?? null,
    message: shown(hub().querySelector('.task-hub__source-message')) ? hub().querySelector('.task-hub__source-message').textContent || null : null,
    focused: focused(),
});
/** Open the hub on the row, wait for the heading it stands under, and begin a move by the button: the fields opened. */
const beginMove = async name => {
    plugin.openTaskHub(rowNamed(name).id);
    await until(() => hub()?.querySelector('.task-hub__shown') && moveButton());
    moveButton().click();
    await until(() => placeInputs().length === 2 && act());
    await sleep(100);
};
/** Send the row under 済み. */
const retarget = async () => {
    type(placeInputs()[1], '済み');
    await until(() => !act().disabled, 3000);
};
/** Switch to the source by its button, and wait for the editors. */
const openSource = async () => {
    pressButton(sourceButton());
    await until(() => viewOf('children'));
    await sleep(100);
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

// The focus is followed through the steps: the window has it.
beforeAll(() => { if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']); });

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

describe('the source opened while the hub moves a row', () => {
    it('shows the draft as the fields left it, the values\' fields shut and the place\'s open, [Cancel] and [Move] the only buttons, and the focus kept in the hub by the pencil', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<Record<string, unknown>>(`
            await beginMove('動かす行');
            // The name typed and left in the field: the source opens on it.
            type(nameInput(), '直した行');
            await openSource();
            const rects = [...formRow(hub()).querySelectorAll('button')].filter(b => shown(b) && b.textContent).map(b => b.getBoundingClientRect());
            const opened = {
                ...source(),
                shut: shutSays(),
                name: nameInput().disabled,
                place: placeInputs().map(input => input.disabled),
                foot: footShows(hub()).filter(cls => !cls.includes('create-says')),
                buttons: buttons(),
                oneLine: rects.every(r => Math.abs(r.top - rects[0].top) < 1),
                sourceActions: shown(hub().querySelector('.task-hub__source-actions')),
                disk: await disk(),
            };
            pressButton(pencil());
            await until(() => !viewOf('children') && !nameInput().disabled);
            await sleep(100);
            const back = {
                open: !!viewOf('children'),
                name: nameInput().value,
                shut: shutSays(),
                onBody: document.activeElement === document.body,
                inHub: !!document.activeElement?.closest('.task-hub'),
            };
            return JSON.stringify({ opened, back });
        `);
        expect(seen).toEqual({
            opened: {
                open: true,
                parent: '- [ ] 直した行',
                children: '- [ ] 子a\n- [ ] 子b',
                message: null,
                focused: 'parent',
                shut: [tr('modal.hub.move.sourceShut')],
                name: true,
                place: [false, false],
                foot: ['tv-form__buttons'],
                buttons: [tr('modal.cancel'), tr('modal.send.send')],
                oneLine: true,
                sourceActions: false,
                disk: NOTE,
            },
            back: { open: false, name: '直した行', shut: [], onBody: false, inHub: true },
        });
    });

    it('says why a first line that is no task does not take, under the editor, on [Move] and on the switch back alike, and writes nothing', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<Record<string, unknown>>(`
            await beginMove('動かす行');
            await retarget();
            await openSource();
            edit('parent', 0, undefined, 'ただの行');
            act().click();
            await sleep(500);
            const moved = { ...source(), hub: !!hub(), disk: await disk() };
            pressButton(pencil());
            await sleep(500);
            const back = { ...source(), hub: !!hub(), disk: await disk() };
            return JSON.stringify({ moved, back });
        `);
        const stays = { open: true, parent: 'ただの行', children: '- [ ] 子a\n- [ ] 子b', message: tr('modal.hub.source.notTask'), hub: true, disk: NOTE };
        expect(seen).toEqual({
            moved: { ...stays, focused: 'parent' },
            back: { ...stays, focused: 'parent' },
        });
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
    });

    it('writes a child changed in it where the row goes by [Move], the heading typed while it is open', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<Record<string, unknown>>(`
            await beginMove('動かす行');
            await openSource();
            edit('children', '- [ ] 子a'.length, '- [ ] 子a'.length, '2');
            await retarget();
            const held = await disk();
            act().click();
            await until(() => !hub(), 5000);
            return JSON.stringify({ held, open: !!hub() });
        `);
        expect(seen).toEqual({ held: NOTE, open: false });
        expect(readTestFile(TEST_FILE)).toBe(movedWith('子a2', '子b'));
    });

    it('throws an edit away by [Cancel] once asked, the answer reading as discarding: back to the card that writes each change as it comes, back first giving the focus to the editor', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<Record<string, unknown>>(`
            await beginMove('動かす行');
            await openSource();
            edit('children', 0, '- [ ] 子a'.length, '- [ ] 消える子');
            // Cancel pressed as a person presses it: the focus leaves the editor for it.
            pressButton(formRow(hub()).querySelector('.tv-form__cancel'));
            await until(() => ask());
            const asked = { ask: ask(), buttons: buttons() };
            buttonNamed(${JSON.stringify(tr('modal.draft.keep'))}).click();
            await sleep(200);
            const kept = { ...source(), ask: ask() };
            formRow(hub()).querySelector('.tv-form__cancel').click();
            await until(() => ask());
            formRow(hub()).querySelector('.tv-form__discard').click();
            await until(() => hub().querySelector('.task-hub__shown') && !viewOf('children'));
            await sleep(100);
            const discarded = {
                open: !!viewOf('children'),
                pencil: pencil().classList.contains('is-active'),
                place: placeInputs().length,
                name: nameInput().disabled,
                shut: shutSays(),
                card: hub().querySelector('.task-hub__preview').textContent.includes('消える子'),
                disk: await disk(),
            };
            // Each change is written as it comes again.
            type(nameInput(), '書いた行');
            nameInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
            for (const end = Date.now() + 5000; Date.now() < end && !(await disk()).includes('書いた行');) await sleep(50);
            return JSON.stringify({ asked, kept, discarded, written: await disk() });
        `);
        expect(seen).toEqual({
            asked: {
                ask: tr('modal.hub.move.discardAsk'),
                buttons: [tr('modal.draft.discard'), tr('modal.draft.keep'), tr('modal.send.send')],
            },
            // The focus is in the editor, where it was before the question.
            kept: { open: true, parent: '- [ ] 動かす行', children: '- [ ] 消える子\n- [ ] 子b', message: null, focused: 'parent', ask: null },
            discarded: { open: false, pencil: true, place: 0, name: false, shut: [], card: false, disk: NOTE },
            written: NOTE.replace('動かす行', '書いた行'),
        });
    });

    it('throws an edit away and closes by × once asked, the question cancel put reading as closing once × asks it', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<Record<string, unknown>>(`
            await beginMove('動かす行');
            await openSource();
            edit('children', 0, '- [ ] 子a'.length, '- [ ] 消える子');
            formRow(hub()).querySelector('.tv-form__cancel').click();
            await until(() => ask());
            const byCancel = { ask: ask(), buttons: buttons() };
            hub().querySelector('.tv-overlay__close').click();
            await sleep(200);
            const byClose = { ask: ask(), buttons: buttons(), open: !!hub() };
            formRow(hub()).querySelector('.tv-form__discard').click();
            await until(() => !document.querySelector('.tv-overlay'));
            return JSON.stringify({ byCancel, byClose, open: !!hub() });
        `);
        expect(seen).toEqual({
            byCancel: { ask: tr('modal.hub.move.discardAsk'), buttons: [tr('modal.draft.discard'), tr('modal.draft.keep'), tr('modal.send.send')] },
            byClose: { ask: tr('modal.hub.move.discardAsk'), buttons: [tr('modal.hub.unsavedDiscard'), tr('modal.draft.keep'), tr('modal.send.send')], open: true },
            open: false,
        });
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
    });

    it('draws a child added in it on the card once switched back, the card\'s checkboxes writing nothing', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<Record<string, unknown>>(`
            await beginMove('動かす行');
            await openSource();
            edit('children', viewOf('children').state.doc.length, undefined, '\\n- [x] 子c');
            pressButton(pencil());
            const card = () => hub().querySelector('.task-hub__preview .task-card');
            await until(() => !viewOf('children') && card()?.textContent.includes('子c'));
            const boxes = () => [...card().querySelectorAll('input[type="checkbox"]')];
            const drawn = { children: ['子a', '子b', '子c'].map(name => card().textContent.includes(name)), checked: boxes().map(box => box.checked) };
            boxes()[1].click();
            await sleep(300);
            return JSON.stringify({ drawn, disk: await disk() });
        `);
        expect(seen).toEqual({
            drawn: { children: [true, true, true], checked: [false, false, false, true] },
            disk: NOTE,
        });
    });

    it('keeps the source open over a move the disk refused, why above the buttons, and moves the text mended after, the child taken out gone', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<Record<string, unknown>>(`
            await beginMove('動かす行');
            await retarget();
            await openSource();
            edit('children', 0, '- [ ] 子a\\n'.length, '');
            // The disk refuses the next write once (the write layer's 'failed').
            const real = app.vault.process;
            app.vault.process = async function () { app.vault.process = real; throw new Error('e2e: the disk refused'); };
            let refused;
            try {
                act().click();
                await until(() => footSays().length > 0 && !act().disabled, 5000);
                refused = { ...source(), says: footSays(), foot: footShows(hub()).slice(-2), canMove: !act().disabled, disk: await disk() };
            } finally {
                app.vault.process = real;
            }
            edit('children', '- [ ] 子b'.length, '- [ ] 子b'.length, '2');
            act().click();
            await until(() => !hub(), 5000);
            return JSON.stringify({ refused, open: !!hub() });
        `);
        expect(seen).toEqual({
            refused: {
                open: true,
                parent: '- [ ] 動かす行',
                children: '- [ ] 子b',
                message: null,
                focused: 'parent',
                says: [tr('notice.notWritten', { reason: tr('notice.refusedFailed'), subject: '動かす行' })],
                // The line above the form's row of buttons.
                foot: ['task-hub__create-line', 'tv-form__buttons'],
                canMove: true,
                disk: NOTE,
            },
            open: false,
        });
        expect(readTestFile(TEST_FILE)).toBe(movedWith('子b2'));
    });

    it('does not open on a row whose subtree it cannot open, saying why as out of a move, the fields and [Move] offered', async () => {
        const SHALLOW = ['# 予定', '- [x] 済み親', '    - [ ] 浅い', '      続き', '        - [ ] 子', '# 済み', ''].join('\n');
        await writeIndexedTestFile(TEST_FILE, SHALLOW);
        const seen = run<Record<string, unknown>>(`
            plugin.openTaskHub(rowNamed('浅い').id);
            await until(() => hub()?.querySelector('.task-hub__shown') && moveButton());
            await sleep(100);
            const why = () => ({ pressable: !sourceButton().disabled, shut: shown(hub().querySelector('.task-hub__mode-shut')) ? hub().querySelector('.task-hub__mode-shut').textContent : null });
            const before = why();
            moveButton().click();
            await until(() => placeInputs().length === 2 && act());
            await sleep(100);
            const moving = { ...why(), name: nameInput().disabled };
            sourceButton().click();
            await sleep(300);
            moving.source = !!viewOf('children');
            type(nameInput(), '浅い2');
            await retarget();
            act().click();
            await until(() => !hub(), 5000);
            return JSON.stringify({ before, moving, open: !!hub() });
        `);
        const why = { pressable: false, shut: tr('modal.hub.source.shallow', { line: '1' }) };
        expect(seen).toEqual({ before: why, moving: { ...why, name: false, source: false }, open: false });
        expect(readTestFile(TEST_FILE)).toBe(['# 予定', '- [x] 済み親', '# 済み', '- [ ] 浅い2', '  続き', '    - [ ] 子', ''].join('\n'));
    });

    it('closes only the completion list on Escape, the hub staying open and asking nothing', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<Record<string, unknown>>(`
            await beginMove('動かす行');
            await openSource();
            const view = viewOf('parent');
            view.focus();
            view.dispatch({ selection: { anchor: view.state.doc.length } });
            view.dispatch({ ...view.state.replaceSelection(' [[test-int'), userEvent: 'input.type' });
            const options = () => [...(hub()?.querySelectorAll('.cm-tooltip-autocomplete li') ?? [])];
            await until(() => options().length > 0, 3000, 'no completion list');
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
            await sleep(300);
            return JSON.stringify({ list: options().length, hub: !!hub(), ask: ask(), ...source() });
        `);
        expect(seen).toEqual({
            list: 0, hub: true, ask: null,
            open: true, parent: '- [ ] 動かす行 [[test-int', children: '- [ ] 子a\n- [ ] 子b', message: null, focused: 'parent',
        });
    });
});

describe('the source of a hub the card\'s menu opened in a move', () => {
    it('opens on the draft from the start, the values\' fields shut, and goes back to the card with the text taken in', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        expect(openDialog(TEST_FILE, '動かす行').open).toBe(true);
        const seen = run<Record<string, unknown>>(`
            await openSource();
            const opened = { ...source(), shut: shutSays(), name: nameInput().disabled, place: placeInputs().map(input => input.disabled), buttons: buttons() };
            edit('children', '- [ ] 子a'.length, '- [ ] 子a'.length, '2');
            pressButton(pencil());
            await until(() => !viewOf('children'));
            await sleep(100);
            return JSON.stringify({ opened, card: hub().querySelector('.task-hub__preview').textContent.includes('子a2'), name: nameInput().disabled, disk: await disk() });
        `);
        expect(seen).toEqual({
            opened: {
                open: true, parent: '- [ ] 動かす行', children: '- [ ] 子a\n- [ ] 子b', message: null, focused: 'parent',
                shut: [tr('modal.hub.move.sourceShut')], name: true, place: [false, false],
                buttons: [tr('modal.cancel'), tr('modal.send.send')],
            },
            card: true,
            name: false,
            disk: NOTE,
        });
    });
});
