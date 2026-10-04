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
import { deleteTestFile, readTestFile, waitForFileDeindexed, writeIndexedTestFile, writeTestFile } from '../helpers/test-file-manager';

const TEST_FILE = 'test-int-suggest-lists.md';
const NOTE_A = 'test-int-suggest-props-a.md';
const NOTE_B = 'test-int-suggest-props-b.md';
const NOTE_CRLF = 'test-int-suggest-crlf.md';

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
    for (const file of [TEST_FILE, NOTE_A, NOTE_B, NOTE_CRLF]) {
        deleteTestFile(file);
        await waitForFileDeindexed(file);
    }
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

describe('the hub\'s tag field: Obsidian\'s list, with Obsidian\'s keys (論点A)', () => {
    it('opens its list as the field takes the focus, the first item selected; Escape closes the list and leaves the hub open', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const result = run<Record<string, unknown>>(`
            await openHub('次', 'tags');
            const opened = await until(() => list()?.items.length > 0);
            const shown = list();
            escape(tagInput());
            await sleep(200);
            return JSON.stringify({ opened, first: shown.items[0] === shown.selected, closed: !list(), hub: !!hub(), focused: document.activeElement === tagInput() });
        `);
        expect(result).toEqual({ opened: true, first: true, closed: true, hub: true, focused: true });
    });

    it('puts the selected item in on an Enter while the list is open', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const result = run<Record<string, unknown>>(`
            await openHub('次');
            type(tagInput(), 'e2e-suggest-proj');
            await until(() => list()?.items.length === 2);
            const shown = list();
            enter(tagInput());
            await sleep(800);
            return JSON.stringify({ shown, tags: rowOf('次').tags, field: tagInput().value });
        `);
        expect(result).toEqual({
            shown: { items: ['#e2e-suggest-proj-x', '#e2e-suggest-project'], selected: '#e2e-suggest-proj-x' },
            tags: ['e2e-suggest-proj-x'],
            field: '',
        });
        expect(readTestFile(TEST_FILE)).toContain('e2e-suggest-proj-x');
    });

    it('adds the tag as typed on an Enter after Escape has closed the list', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const result = run<Record<string, unknown>>(`
            await openHub('次');
            type(tagInput(), 'e2e-suggest-proj');
            const listed = await until(() => list()?.items.length === 2);
            escape(tagInput());
            await sleep(100);
            const closed = !list() && !!hub();
            enter(tagInput());
            await sleep(800);
            return JSON.stringify({ listed, closed, tags: rowOf('次').tags });
        `);
        expect(result).toEqual({ listed: true, closed: true, tags: ['e2e-suggest-proj'] });
    });

    it('picks nothing on an Enter an IME commits a conversion with (WebKit: keyCode 229 after the composition), and the next Enter picks', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const result = run<Record<string, unknown>>(`
            await openHub('次');
            type(tagInput(), 'e2e-suggest-proj');
            await until(() => list()?.items.length === 2);
            enter(tagInput(), { keyCode: 229 });
            await sleep(300);
            const afterIme = { list: !!list(), value: tagInput().value, tags: rowOf('次').tags.length };
            enter(tagInput());
            await sleep(800);
            return JSON.stringify({ afterIme, tags: rowOf('次').tags });
        `);
        expect(result).toEqual({ afterIme: { list: true, value: 'e2e-suggest-proj', tags: 0 }, tags: ['e2e-suggest-proj-x'] });
    });

    it('narrows its list again once an IME commits a conversion', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const result = run<Record<string, unknown>>(`
            await openHub('次');
            const input = tagInput();
            input.focus();
            // Chromium: the composition's input events say isComposing; the last comes after compositionend in WebKit.
            input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
            input.value = 'e2e-suggest-projec';
            input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
            input.value = 'e2e-suggest-project';
            input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'e2e-suggest-project' }));
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            await sleep(300);
            return JSON.stringify(list());
        `);
        expect(result).toEqual({ items: ['#e2e-suggest-project'], selected: '#e2e-suggest-project' });
    });
});

describe('the hub\'s status button', () => {
    it('opens the card menu\'s statuses, the row\'s checked, and writes the one picked', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const result = run<Record<string, unknown>>(`
            await openHub('次');
            hub().querySelector('.task-hub__status-pill').click();
            await sleep(200);
            // On macOS the menu may be the native one, outside the DOM: its items are read from the Menu.
            const items = plugin.menuPresenter.currentMenu?.items ?? [];
            const titles = items.map(i => i.titleEl?.textContent ?? '');
            const checked = items.filter(i => i.checked).map(i => i.titleEl?.textContent ?? '');
            const defs = plugin.settings.statusDefinitions;
            const done = defs.find(d => d.char === 'x');
            const item = items[defs.indexOf(done)];
            plugin.menuPresenter.dismiss();
            item.callback(new MouseEvent('click'));
            await sleep(800);
            return JSON.stringify({ titles, labels: defs.map(d => d.label || '\u00A0'), checked, todo: defs.find(d => d.char === ' ')?.label || '\u00A0', pill: hub().querySelector('.task-hub__status-pill').textContent, done: done.label });
        `);
        expect(result.titles).toEqual(result.labels);
        expect(result.checked).toEqual([result.todo]);
        expect(result.pill).toBe(result.done);
        expect(readTestFile(TEST_FILE).split('\n')[2]).toBe('- [x] 次');
    });
});

describe('the filter\'s fields', () => {
    it('a property\'s value: an Enter commits it once, and leaving the field after does not again', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const result = run<Record<string, unknown>>(`
            const side = app.workspace.getLeaf('split');
            await side.setViewState({ type: 'timeline-view', active: false, state: { filterState: { logic: 'and', filters: [{ property: 'property', operator: 'equals', key: 'e2e-suggest-none', value: '' }] } } });
            R.side = side;
            await sleep(500);
            const menu = side.view.toolbar.filterMenu;
            let commits = 0;
            const commit = menu.commit;
            menu.commit = function (...args) { commits++; return commit.apply(this, args); };
            side.view.contentEl.querySelector('.view-toolbar button:has(svg.lucide-filter)').click();
            const popover = () => document.querySelector('.tv-overlay:not(.is-closing) .tv-overlay__panel.filter-popover');
            await until(() => popover());
            const input = popover().querySelector('.filter-popover__property-value-wrap input');
            type(input, 'abc');
            enter(input);
            await sleep(200);
            const afterEnter = commits;
            input.dispatchEvent(new FocusEvent('blur'));
            await sleep(200);
            const value = popover().querySelector('.filter-popover__property-value-wrap input').value;
            escape(document.activeElement);
            await until(() => !popover());
            return JSON.stringify({ afterEnter, afterBlur: commits, value, saved: side.view.getState().filterState.filters[0].value });
        `);
        expect(result).toEqual({ afterEnter: 1, afterBlur: 1, value: 'abc', saved: 'abc' });
    });

    it('a tag pill: its list is Obsidian\'s, Escape closes it and leaves the filter menu open', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const result = run<Record<string, unknown>>(`
            const side = app.workspace.getLeaf('split');
            await side.setViewState({ type: 'timeline-view', active: false, state: { filterState: { logic: 'and', filters: [{ property: 'tag', operator: 'includes' }] } } });
            R.side = side;
            await sleep(500);
            side.view.contentEl.querySelector('.view-toolbar button:has(svg.lucide-filter)').click();
            const popover = () => document.querySelector('.tv-overlay:not(.is-closing) .tv-overlay__panel.filter-popover');
            await until(() => popover());
            const input = popover().querySelector('.filter-popover__tag-value input');
            type(input, 'e2e-suggest-proj');
            const listed = await until(() => list()?.items.length === 2);
            const shown = list();
            escape(input);
            await sleep(200);
            const afterEscape = { list: !!list(), popover: !!popover() };
            type(popover().querySelector('.filter-popover__tag-value input'), 'e2e-suggest-proj');
            await until(() => list()?.items.length === 2);
            enter(popover().querySelector('.filter-popover__tag-value input'));
            await sleep(300);
            const pills = [...popover().querySelectorAll('.tv-ctrl__pill')].map(p => p.textContent.trim());
            escape(document.activeElement);
            await until(() => !popover());
            return JSON.stringify({ listed, shown, afterEscape, pills });
        `);
        expect(result).toEqual({
            listed: true,
            shown: { items: ['#e2e-suggest-proj-x', '#e2e-suggest-project'], selected: '#e2e-suggest-proj-x' },
            afterEscape: { list: false, popover: true },
            pills: ['#e2e-suggest-proj-x'],
        });
    });
});

describe('the Properties view\'s color picker', () => {
    it('writes to the note of its own leaf, beside the active one', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const key = run<string>(`return JSON.stringify(plugin.settings.scopeKeys.color);`);
        writeTestFile(NOTE_A, `---\n${key}: red\n---\n本文 A\n`);
        writeTestFile(NOTE_B, `---\n${key}: blue\n---\n本文 B\n`);
        const result = run<Record<string, unknown>>(`
            await until(() => app.vault.getAbstractFileByPath(${JSON.stringify(NOTE_B)}));
            const open = async (path, how) => {
                const leaf = app.workspace.getLeaf(how);
                await leaf.openFile(app.vault.getAbstractFileByPath(path), { state: { mode: 'source', source: false } });
                return leaf;
            };
            R.a = await open(${JSON.stringify(NOTE_A)}, 'tab');
            R.b = await open(${JSON.stringify(NOTE_B)}, 'split');
            app.workspace.setActiveLeaf(R.b, { focus: true });
            const pickerOf = leaf => leaf.view.containerEl.querySelector('.metadata-property input[type="color"]');
            const found = await until(() => pickerOf(R.a) && pickerOf(R.b));
            const active = app.workspace.getActiveFile()?.path;
            const picker = pickerOf(R.a);
            picker.value = '#00ff00';
            picker.dispatchEvent(new Event('input', { bubbles: true }));
            picker.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(800);
            return JSON.stringify({ found, active });
        `);
        expect(result).toEqual({ found: true, active: NOTE_B });
        expect(readTestFile(NOTE_A)).toBe(`---\n${key}: 00ff00\n---\n本文 A\n`);
        expect(readTestFile(NOTE_B)).toBe(`---\n${key}: blue\n---\n本文 B\n`);
    });
});

describe('the editor\'s suggest of a frontmatter color', () => {
    it('is offered in a note written with CRLF, and replaces the value alone, its comment kept', async () => {
        const key = run<string>(`return JSON.stringify(plugin.settings.scopeKeys.color);`);
        writeTestFile(NOTE_CRLF, ['---', `${key}: re  # mine`, 'tags: a', '---', 'body', ''].join('\r\n'));
        const result = run<Record<string, unknown>>(`
            await until(() => app.vault.getAbstractFileByPath(${JSON.stringify(NOTE_CRLF)}));
            const leaf = app.workspace.getLeaf('tab');
            R.crlf = leaf;
            await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE_CRLF)}), { state: { mode: 'source', source: true } });
            app.workspace.setActiveLeaf(leaf, { focus: true });
            await sleep(400);
            const editor = leaf.view.editor;
            editor.focus();
            // Typed as a person types: Obsidian offers its editor suggests on a typed change.
            const cm = editor.cm;
            const at = cm.state.doc.line(2).from + ${JSON.stringify(key)}.length + 4;
            cm.dispatch({ changes: { from: at, insert: 'd' }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
            await until(() => list()?.items.length > 0);
            const shown = list();
            enter(document.activeElement);
            await sleep(300);
            return JSON.stringify({ first: shown?.items[0], selected: shown?.selected, line: editor.getLine(1) });
        `);
        expect(result).toEqual({ first: 'red', selected: 'red', line: `${key}: red  # mine` });
    });
});
