/**
 * The lists of candidates under our fields (段10f), in the running Dev
 * vault: every one is Obsidian's input suggest (`ShownSuggest`), which keeps
 * the note's hotkeys out while it is open, takes no Enter an IME commits a
 * conversion with, and behaves as Obsidian's lists do: the first item is
 * selected as it opens, an Enter puts the selected item in, and an Escape
 * closes the list alone (論点A).
 *
 * The hub is opened on a row as a card opens it, a note beside it active in
 * source mode; fields are typed in as a person types (the text, then its
 * `input` event). The note's bytes are read back from the disk.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open,
 *     with a build of 段10f
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/forms/suggest-lists.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';

const TEST_FILE = 'test-int-suggest-lists.md';

const NOTE = [
    '# 見出し',
    '- [ ] 親 @2026-10-04 #e2e-suggest-project #e2e-suggest-proj-x',
    '- [ ] 次',
    '',
].join('\n');

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
const R = (window.__tvSuggestE2E ??= {});
const rowOf = name => {
    const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(name));
    if (!task) throw new Error('no row ' + name);
    return task;
};
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const nameInput = () => hub()?.querySelector('.tv-form__name-section input') ?? null;
const tagInput = () => hub()?.querySelector('.task-hub__tag-add-wrap input') ?? null;
const key = (el, init) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const enter = (el, init = {}) => key(el, { key: 'Enter', code: 'Enter', keyCode: 13, ...init });
const escape = el => key(el, { key: 'Escape', code: 'Escape', keyCode: 27 });
const bold = () => key(document.activeElement, { key: 'b', code: 'KeyB', keyCode: 66, metaKey: true, ctrlKey: navigator.platform.indexOf('Mac') < 0 });
/** Type text in a field as a person does: the text, then its input event. */
const type = (input, text) => { input.focus(); input.value = text; input.setSelectionRange(text.length, text.length); input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
/** The list Obsidian shows under a field: its items' text, and the one selected. */
const list = () => {
    const box = document.querySelector('.suggestion-container');
    if (!box) return null;
    return {
        items: [...box.querySelectorAll('.suggestion-item')].map(el => el.textContent.trim()),
        selected: box.querySelector('.suggestion-item.is-selected')?.textContent.trim() ?? null,
    };
};
/** A note's leaf in source mode, active, its line 2's second character selected. */
const openNote = async () => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(TEST_FILE)});
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(file, { state: { mode: 'source', source: true } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await sleep(300);
    R.note = leaf;
    const editor = leaf.view.editor;
    editor.focus();
    editor.setSelection({ line: 2, ch: 6 }, { line: 2, ch: 7 });
    return editor;
};
const openHub = async (name, focusField) => {
    plugin.openTaskHub(rowOf(name).id, focusField ? { focusField } : undefined);
    await until(() => hub() && nameInput());
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

/** Close every overlay and list, and the leaves the tests opened. */
function cleanUp(): void {
    run(`
        document.querySelectorAll('.suggestion-container').forEach(el => el.remove());
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
        await sleep(100);
        hub()?.querySelector('.task-hub__form .tv-form__discard')?.click();
        await until(() => !hub());
        for (const name of Object.keys(R)) { R[name]?.detach(); delete R[name]; }
        plugin.menuPresenter.dismiss();
        await sleep(250);
        return 'ok';
    `);
}

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    // Focus moves and hotkeys need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
});

afterEach(() => { cleanUp(); });

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('a list open under a field keeps the note\'s hotkeys out', () => {
    it('the hub\'s name: Mod+B while its [[ list is open leaves the note behind as it was', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const result = run<Record<string, unknown>>(`
            const editor = await openNote();
            // Opened with the focus on its panel: the field is focused after, as a click does.
            await openHub('親');
            type(nameInput(), '親 [[test-int-suggest');
            const listed = await until(() => list()?.items.length > 0);
            editor.setSelection({ line: 2, ch: 6 }, { line: 2, ch: 7 });
            bold();
            await sleep(200);
            return JSON.stringify({ listed, line: editor.getLine(2), focused: document.activeElement === nameInput() });
        `);
        expect(result).toEqual({ listed: true, line: '- [ ] 次', focused: true });
    });
});
