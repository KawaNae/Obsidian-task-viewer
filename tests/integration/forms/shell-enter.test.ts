/**
 * The overlay's rules and the form's Enter (段10a), in the running Dev
 * vault: every overlay keeps Obsidian's hotkeys from the note behind and
 * holds the focus from the moment it opens, and an Enter an IME commits a
 * conversion with, or one an open list takes, is not the form's.
 *
 * The create dialog is opened from a card's menu ("Add child task"), as a
 * user opens it; the filter menu from a Timeline's toolbar, with the note
 * active beside it. The note's bytes are read back from the disk.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open,
 *     with a build that has OverlayShell's initialFocus and onFormEnter
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/forms/shell-enter.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';

const TEST_FILE = 'test-int-shell-enter.md';

const NOTE = [
    '# 見出し',
    '- [ ] 親 @2026-10-04',
    '- [ ] 次',
    '',
].join('\n');

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
const R = (window.__tvShellE2E ??= {});
const rowOf = name => {
    const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(name));
    if (!task) throw new Error('no row ' + name);
    return task;
};
/** The create dialog's panel: a dialog with a name section that is not the hub's. */
const createPanel = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__panel--dialog')]
    .find(p => !p.classList.contains('task-hub') && p.querySelector('.tv-form__name-section')) ?? null;
const nameInput = () => createPanel()?.querySelector('.tv-form__name-section input') ?? null;
const hubPanel = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const key = (el, init) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const enter = (el, init = {}) => key(el, { key: 'Enter', code: 'Enter', keyCode: 13, ...init });
const bold = () => key(document.activeElement, { key: 'b', code: 'KeyB', keyCode: 66, metaKey: true, ctrlKey: navigator.platform.indexOf('Mac') < 0 });
const typeName = (text) => { const input = nameInput(); input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); };
/** Open the create dialog from the card menu of the row named, and wait for the focus to come to its name. */
const openCreate = async (name) => {
    const task = rowOf(name);
    // The card menu the hub's cards open, made as a hub first opens.
    if (!plugin.taskHub.cards) {
        plugin.openTaskHub(task.id);
        await until(() => hubPanel());
        hubPanel().closest('.tv-overlay__panel').querySelector('.tv-overlay__close').click();
        await until(() => !hubPanel());
    }
    await plugin.taskHub.cards.menuHandler.showContextMenu(0, 0, task);
    const menu = plugin.menuPresenter.currentMenu;
    const item = menu?.items.find(one => one.titleEl?.textContent === ${JSON.stringify(tr('menu.addChildTask'))});
    if (!item) throw new Error('no add child in the menu');
    menu.hide();
    item.callback(new MouseEvent('click'));
    await until(() => nameInput() && document.activeElement === nameInput());
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
const dialogState = () => ({
    open: !!createPanel(),
    focused: !!nameInput() && document.activeElement === nameInput(),
    name: nameInput()?.value ?? null,
    error: (() => { const el = createPanel()?.querySelector('.tv-form__name-section .tv-form__error'); return el && getComputedStyle(el).display !== 'none' ? el.textContent : null; })(),
    invalid: nameInput()?.classList.contains('tv-ctrl__text-input--invalid') ?? null,
});
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

interface DialogState {
    open: boolean;
    focused: boolean;
    name: string | null;
    error: string | null;
    invalid: boolean | null;
}

/** Close every overlay and the leaves the tests opened. */
function cleanUp(): void {
    run(`
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
        await sleep(100);
        document.querySelectorAll('.tv-overlay:not(.is-closing) .task-hub__source-actions .tv-form__discard').forEach(b => b.click());
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
    // Focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
});

afterEach(() => { cleanUp(); });

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('the create dialog\'s name field', () => {
    it('opens with the focus on the name, takes no Enter an IME commits a conversion with, and creates on the next Enter', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const steps = run<Record<string, DialogState>>(`
            await openCreate('親');
            const opened = dialogState();
            typeName('子');
            const input = nameInput();
            // Chromium on macOS, Safari and WebKit (iPad), Chromium on Windows.
            enter(input, { isComposing: true, keyCode: 229 });
            await sleep(100);
            const chromium = dialogState();
            enter(input, { isComposing: false, keyCode: 229 });
            await sleep(100);
            const webkit = dialogState();
            key(input, { key: 'Process', code: 'Enter', keyCode: 229 });
            await sleep(100);
            const windows = dialogState();
            // An Enter inside a composition, whatever the event says.
            input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
            enter(input);
            input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '子' }));
            await sleep(100);
            const composing = dialogState();
            enter(input);
            await until(() => !createPanel());
            await sleep(500);
            const created = dialogState();
            return JSON.stringify({ opened, chromium, webkit, windows, composing, created });
        `);
        expect(steps.opened).toMatchObject({ open: true, focused: true, name: '' });
        for (const step of ['chromium', 'webkit', 'windows', 'composing']) {
            expect(steps[step], step).toMatchObject({ open: true, name: '子' });
        }
        expect(steps.created.open).toBe(false);
        // Indented by the vault's unit (a tab, or spaces).
        const lines = readTestFile(TEST_FILE).split('\n');
        expect(lines).toHaveLength(5);
        expect(lines[2]).toMatch(/^(\t|    )- \[ \] 子$/);
        expect(lines.filter((_, i) => i !== 2).join('\n')).toBe(NOTE);
    });

    it('creates nothing on an Enter right after it opens: a name is needed, said under the field until one is typed', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const steps = run<Record<string, DialogState>>(`
            await openCreate('親');
            enter(nameInput());
            await sleep(200);
            const empty = dialogState();
            createPanel().querySelector('.mod-cta').click();
            await sleep(200);
            const clicked = dialogState();
            typeName('名前');
            await sleep(50);
            const typed = dialogState();
            return JSON.stringify({ empty, clicked, typed });
        `);
        const required = tr('modal.nameRequired');
        expect(steps.empty).toMatchObject({ open: true, focused: true, error: required, invalid: true });
        expect(steps.clicked).toMatchObject({ open: true, focused: true, error: required });
        expect(steps.typed).toMatchObject({ open: true, error: null, invalid: false });
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
    });

    it('leaves an Enter to the name\'s list while it is open: the Enter picks, and creates nothing', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const base = TEST_FILE.replace(/\.md$/, '');
        const steps = run<Record<string, unknown>>(`
            await openCreate('親');
            const input = nameInput();
            typeName('見る [[' + ${JSON.stringify(base.slice(0, -3))});
            input.setSelectionRange(input.value.length, input.value.length);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const listed = await until(() => [...document.querySelectorAll('.suggestion-container .suggestion-item')].some(el => el.textContent.includes(${JSON.stringify(base)})));
            const highlighted = document.querySelector('.suggestion-container .suggestion-item.is-selected')?.textContent ?? null;
            enter(input);
            await sleep(300);
            const picked = { ...dialogState(), listOpen: !!document.querySelector('.suggestion-container') };
            enter(input);
            await until(() => !createPanel());
            await sleep(500);
            return JSON.stringify({ listed, highlighted, picked, closed: !createPanel() });
        `);
        expect(steps.listed).toBe(true);
        const picked = steps.picked as DialogState & { listOpen: boolean };
        expect(picked).toMatchObject({ open: true, listOpen: false });
        expect(picked.name).toMatch(/^見る \[\[[^\]]+\]\]$/);
        expect(steps.closed).toBe(true);
        const line = readTestFile(TEST_FILE).split('\n')[2];
        expect(line.trimStart()).toBe(`- [ ] ${picked.name}`);
    });
});

describe('every overlay keeps the note\'s hotkeys out and holds the focus', () => {
    it('the create dialog: Mod+B in its name field leaves the note behind as it was', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const result = run<Record<string, unknown>>(`
            const editor = await openNote();
            await openCreate('親');
            const focused = dialogState().focused;
            editor.setSelection({ line: 2, ch: 6 }, { line: 2, ch: 7 });
            bold();
            await sleep(200);
            const inDialog = editor.getLine(2);
            createPanel().querySelector('.tv-overlay__close').click();
            await until(() => !createPanel());
            await sleep(250);
            // The same key with the focus on the note: the hotkey is let in again.
            editor.focus();
            editor.setSelection({ line: 2, ch: 6 }, { line: 2, ch: 7 });
            bold();
            await sleep(200);
            return JSON.stringify({ focused, inDialog, inNote: editor.getLine(2) });
        `);
        expect(result).toEqual({ focused: true, inDialog: '- [ ] 次', inNote: '- [ ] **次**' });
    });

    it('the filter menu: opened beside the active note, it has the focus, Mod+B leaves the note as it was, and the focus goes back on close', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const result = run<Record<string, unknown>>(`
            const editor = await openNote();
            const side = app.workspace.getLeaf('split');
            await side.setViewState({ type: 'timeline-view', active: false });
            R.side = side;
            await sleep(500);
            app.workspace.setActiveLeaf(R.note, { focus: true });
            editor.focus();
            await sleep(100);
            const before = document.activeElement;
            side.view.contentEl.querySelector('.view-toolbar button:has(svg.lucide-filter)').click();
            const popover = () => document.querySelector('.tv-overlay:not(.is-closing) .tv-overlay__panel.filter-popover');
            await until(() => popover() && popover().contains(document.activeElement));
            const inPopover = !!popover()?.contains(document.activeElement);
            const activeNote = app.workspace.activeLeaf === R.note;
            editor.setSelection({ line: 2, ch: 6 }, { line: 2, ch: 7 });
            bold();
            await sleep(200);
            const line = editor.getLine(2);
            key(document.activeElement, { key: 'Escape', code: 'Escape', keyCode: 27 });
            await until(() => !popover());
            await sleep(100);
            return JSON.stringify({ inPopover, activeNote, line, closed: !popover(), focusBack: document.activeElement === before });
        `);
        expect(result).toEqual({ inPopover: true, activeNote: true, line: '- [ ] 次', closed: true, focusBack: true });
    });

    it('the hub opened with no field named: the focus is in its panel at once, and goes back to the note on close', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const result = run<Record<string, unknown>>(`
            const editor = await openNote();
            const before = document.activeElement;
            plugin.openTaskHub(rowOf('親').id);
            await until(() => hubPanel() && hubPanel().contains(document.activeElement));
            const panel = hubPanel().closest('.tv-overlay__panel') ?? hubPanel();
            const onPanel = document.activeElement === panel;
            const inPanel = panel.contains(document.activeElement);
            editor.setSelection({ line: 2, ch: 6 }, { line: 2, ch: 7 });
            bold();
            await sleep(200);
            const line = editor.getLine(2);
            key(document.activeElement, { key: 'Escape', code: 'Escape', keyCode: 27 });
            await until(() => !hubPanel());
            await sleep(100);
            const focusBack = document.activeElement === before;

            // A field named: the focus goes to it, its text selected.
            plugin.openTaskHub(rowOf('親').id, { focusField: 'start' });
            await until(() => hubPanel() && document.activeElement?.tagName === 'INPUT');
            const field = document.activeElement;
            const named = { value: field.value, selected: field.selectionStart === 0 && field.selectionEnd === field.value.length };
            return JSON.stringify({ onPanel, inPanel, line, focusBack, named });
        `);
        expect(result).toEqual({
            onPanel: true, inPanel: true, line: '- [ ] 次', focusBack: true,
            named: { value: '2026-10-04', selected: true },
        });
    });
});
