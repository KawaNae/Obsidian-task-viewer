/**
 * The overlay's rules and the form's Enter, in the running Dev
 * vault: every overlay keeps Obsidian's hotkeys from the note behind and
 * holds the focus from the moment it opens, and an Enter an IME commits a
 * conversion with, or one an open list takes, is not the form's.
 *
 * The hub on a task not written yet is opened from a card's menu ("Add
 * child task"), as a user opens it, with no hub under it, or over the hub it
 * was opened from; the filter menu from a Timeline's toolbar, with the note
 * active beside it. The note's bytes are read back from the disk.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/forms/shell-enter.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { MENUS } from '../helpers/menus';
import { DIALOG_ROWS } from '../helpers/dialog-rows';

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
${UNTIL}
${DIALOG_ROWS}
${MENUS}
const R = (window.__tvShellE2E ??= {});
const rowOf = name => {
    const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(name));
    if (!task) throw new Error('no row ' + name);
    return task;
};
/** The hub on a task not written yet: the hub that offers a create. */
const isDraft = p => !!formRow(p)?.querySelector(':scope > .mod-cta');
const createPanel = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing) .task-hub')].find(isDraft) ?? null;
const nameInput = () => createPanel()?.querySelector('.tv-form__name-section input') ?? null;
const createButton = () => formRow(createPanel()).querySelector(':scope > .mod-cta');
/** The hub on a row. */
const hubPanel = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing) .task-hub')].find(p => !isDraft(p)) ?? null;
const key = (el, init) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const enter = (el, init = {}) => key(el, { key: 'Enter', code: 'Enter', keyCode: 13, ...init });
const bold = () => key(document.activeElement, { key: 'b', code: 'KeyB', keyCode: 66, metaKey: true, ctrlKey: navigator.platform.indexOf('Mac') < 0 });
const typeName = (text) => { const input = nameInput(); input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); };
/** Open the hub on a task not written yet from the card menu of the row named, and wait for the focus to come to its name. */
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
    menuItem(one => one.titleEl?.textContent === ${JSON.stringify(tr('menu.addChildTask'))});
    await until(() => nameInput() && document.activeElement === nameInput());
};
/**
 * Open the hub on a task not written yet over the hub of the row named, as
 * a user does: the hub opened on the row, then its card's menu, Add child
 * task. Wait for both to be open and the focus on the name. The one place
 * this file opens a hub over another.
 */
const openCreateOverHub = async (name) => {
    const task = rowOf(name);
    plugin.openTaskHub(task.id);
    await until(() => hubPanel() && hubPanel().contains(document.activeElement));
    await plugin.taskHub.cards.menuHandler.showContextMenu(0, 0, task);
    menuItem(one => one.titleEl?.textContent === ${JSON.stringify(tr('menu.addChildTask'))});
    await until(() => hubPanel() && nameInput() && document.activeElement === nameInput());
};
const pressEscape = () => key(document.activeElement, { key: 'Escape', code: 'Escape', keyCode: 27 });
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
    /** Any error the hub says, under a field or at its end. */
    errors: [...(createPanel()?.querySelectorAll('.tv-form__error') ?? [])].filter(el => getComputedStyle(el).display !== 'none').map(el => el.textContent),
    invalid: nameInput()?.classList.contains('tv-ctrl__text-input--invalid') ?? null,
    /** The name as the card shows it, its note's link left out: what the field committed. */
    card: (() => {
        const item = createPanel()?.querySelector('.task-hub__preview .task-card__content li')?.cloneNode(true);
        item?.querySelector('.task-card__file-link')?.remove();
        return item ? item.textContent.trim() : null;
    })(),
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
    errors: string[];
    invalid: boolean | null;
    card: string | null;
}

/** Close every overlay and the leaves the tests opened. */
function cleanUp(): void {
    run(`
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
        await sleep(100);
        document.querySelectorAll('.tv-overlay:not(.is-closing) .task-hub__source-actions .tv-form__discard').forEach(b => b.click());
        document.querySelectorAll('.tv-overlay:not(.is-closing) .task-hub').forEach(p => formRow(p)?.querySelector(':scope > .tv-form__discard')?.click());
        for (const name of Object.keys(R)) { R[name]?.detach(); delete R[name]; }
        plugin.menuPresenter.dismiss();
        await sleep(250);
        return 'ok';
    `);
}

beforeAll(() => {
    // Focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
});

afterEach(() => { cleanUp(); });

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('the name field of the hub on a task not written yet', () => {
    it('opens with the focus on the name, takes no Enter an IME commits a conversion with, and the next Enter commits the name alone', async () => {
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
            await until(() => dialogState().card === '子');
            const committed = { ...dialogState(), disk: await app.vault.adapter.read(${JSON.stringify(TEST_FILE)}) };
            createButton().click();
            await until(() => !createPanel());
            const created = dialogState();
            return JSON.stringify({ opened, chromium, webkit, windows, composing, committed, created });
        `);
        expect(steps.opened).toMatchObject({ open: true, focused: true, name: '' });
        for (const step of ['chromium', 'webkit', 'windows', 'composing']) {
            // Not committed: the card still shows the name it opened with.
            expect(steps[step], step).toMatchObject({ open: true, name: '子', card: '' });
        }
        // The Enter commits the name, and creates nothing: the create alone writes.
        expect(steps.committed).toMatchObject({ open: true, name: '子', card: '子', disk: NOTE });
        expect(steps.created.open).toBe(false);
        // Indented by the vault's unit (a tab, or spaces).
        const lines = readTestFile(TEST_FILE).split('\n');
        expect(lines).toHaveLength(5);
        expect(lines[2]).toMatch(/^(\t|    )- \[ \] 子$/);
        expect(lines.filter((_, i) => i !== 2).join('\n')).toBe(NOTE);
    });

    it('creates nothing on an Enter right after it opens, and says nothing of the name', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        run(`
            await openCreate('親');
            enter(nameInput());
            return 'ok';
        `);
        // Read in the next call: the Enter has had that time to make something.
        const empty = run<DialogState>(`return JSON.stringify(dialogState());`);
        expect(empty).toMatchObject({ open: true, focused: true, name: '', errors: [], invalid: false });
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
    });

    it('leaves an Enter to the name\'s list while it is open: the Enter picks, and the next commits the name alone', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const base = TEST_FILE.replace(/\.md$/, '');
        const steps = run<Record<string, unknown>>(`
            await openCreate('親');
            const input = nameInput();
            typeName('見る [[' + ${JSON.stringify(base.slice(0, -3))});
            input.setSelectionRange(input.value.length, input.value.length);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await until(() => [...document.querySelectorAll('.suggestion-container .suggestion-item')].some(el => el.textContent.includes(${JSON.stringify(base)})));
            const highlighted = document.querySelector('.suggestion-container .suggestion-item.is-selected')?.textContent ?? null;
            enter(input);
            await sleep(300);
            const picked = { ...dialogState(), listOpen: !!document.querySelector('.suggestion-container') };
            enter(input);
            await until(() => dialogState().card.startsWith('見る'));
            const committed = { open: !!createPanel(), disk: await app.vault.adapter.read(${JSON.stringify(TEST_FILE)}) };
            createButton().click();
            await until(() => !createPanel());
            return JSON.stringify({ highlighted, picked, committed, closed: !createPanel() });
        `);
        const picked = steps.picked as DialogState & { listOpen: boolean };
        expect(picked).toMatchObject({ open: true, listOpen: false });
        expect(picked.name).toMatch(/^見る \[\[[^\]]+\]\]$/);
        expect(steps.committed).toEqual({ open: true, disk: NOTE });
        expect(steps.closed).toBe(true);
        const line = readTestFile(TEST_FILE).split('\n')[2];
        expect(line.trimStart()).toBe(`- [ ] ${picked.name}`);
    });
});

describe('every overlay keeps the note\'s hotkeys out and holds the focus', () => {
    it('the hub on a task not written yet: Mod+B in its name field leaves the note behind as it was', async () => {
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

describe('overlays opened over one another', () => {
    it('the hub on a task not written yet over the hub on a row: Escape closes it alone, the hub on the row staying open, and the next Escape closes that', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const steps = run<Record<string, unknown>>(`
            await openCreateOverHub('親');
            const opened = { hub: !!hubPanel(), create: !!createPanel() };
            pressEscape();
            await until(() => !createPanel());
            await sleep(300);
            const first = { hub: !!hubPanel(), create: !!createPanel() };
            pressEscape();
            await until(() => !hubPanel());
            await sleep(100);
            const second = { hub: !!hubPanel(), create: !!createPanel() };
            return JSON.stringify({ opened, first, second });
        `);
        expect(steps).toEqual({
            opened: { hub: true, create: true },
            first: { hub: true, create: false },
            second: { hub: false, create: false },
        });
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
    });
});
