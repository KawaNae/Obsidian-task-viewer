/**
 * The hub's source mode, in the running Dev vault: the hub opened on a row,
 * its source edited through the CodeMirror views the hub shows, applied,
 * and the note's bytes read back.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open,
 *     with a build that has the source mode
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/source-mode.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { isObsidianRunning, obsidianEval, sleep } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, waitForFileDeindexed, writeIndexedTestFile, writeTestFile } from '../helpers/test-file-manager';

const TEST_FILE = 'test-int-source-mode.md';

const NOTE = [
    '# 見出し',
    '- [ ] 親 @2026-09-29',
    '    - [ ] 子a',
    '    - [ ] 子b',
    '- [ ] 次',
    '',
].join('\n');

/** A row whose code block keeps the paragraph below it from going on the row's text. */
const FENCED = [
    '# 見出し',
    '- [ ] 親 @2026-09-29',
    '    ```',
    '    code',
    '    ```',
    '段落',
    '',
].join('\n');

/** A parent with text to break off, and a numbered child. */
const LISTS = [
    '# 見出し',
    '- [x] 親 後半',
    '    - [ ] 子a',
    '    1. 手順',
    '- [ ] 次',
    '',
].join('\n');

/**
 * What every snippet starts with: the plugin, the CodeMirror view behind an
 * editor of the hub (`cmTile` from CodeMirror 6.39, `cmView` before it), and
 * what the source mode shows.
 */
const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const viewOf = which => {
    const el = document.querySelector('.task-hub .tv-source-editor__' + which + ' .cm-content');
    return el ? (el.cmTile?.view ?? el.cmView?.rootView?.view ?? null) : null;
};
const shown = sel => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none'; };
const state = () => ({
    hub: !!document.querySelector('.task-hub'),
    source: !!document.querySelector('.task-hub .tv-source-editor'),
    parent: viewOf('parent')?.state.doc.toString() ?? null,
    children: viewOf('children')?.state.doc.toString() ?? null,
    message: shown('.task-hub__source-message') ? document.querySelector('.task-hub__source-message').textContent : null,
    asking: shown('.task-hub__source-ask'),
    lost: shown('.task-hub__source-lost'),
    actions: shown('.task-hub__source-actions'),
    shut: shown('.task-hub__mode-shut') ? document.querySelector('.task-hub__mode-shut').textContent : null,
    notices: document.querySelectorAll('.notice').length,
});
const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
const KEY_CODES = { Enter: 13, Tab: 9, ArrowUp: 38, ArrowDown: 40 };
/** A key pressed in the editor that has the focus, as a keydown CodeMirror's keymap reads. */
const press = async (key, opts = {}) => {
    const target = document.activeElement;
    target.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, keyCode: KEY_CODES[key] ?? 0, bubbles: true, cancelable: true, ...opts }));
    await sleep(30);
};
const typeText = (text) => { const view = viewOf(focused()); view.dispatch(view.state.replaceSelection(text)); };
/** Which editor has the focus: 'parent', 'children', or null. */
const focused = () => ['parent', 'children'].find(which => document.activeElement === document.querySelector('.task-hub .tv-source-editor__' + which + ' .cm-content')) ?? null;
const caret = () => { const which = focused(); const view = which && viewOf(which); return view ? view.state.selection.main.head : null; };
`;

interface SourceState {
    hub: boolean;
    source: boolean;
    parent: string | null;
    children: string | null;
    message: string | null;
    asking: boolean;
    lost: boolean;
    actions: boolean;
    shut: string | null;
    notices: number;
}

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

function sourceState(): SourceState {
    return run<SourceState>('return JSON.stringify(state());');
}

/** Open the hub on the row whose name starts with `name`, and switch it to the source. */
function openSource(name: string): SourceState {
    return run<SourceState>(`
        const task = plugin.getTaskIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(${JSON.stringify(name)}));
        if (!task) throw new Error('no row ' + ${JSON.stringify(name)});
        plugin.openTaskHub(task.id);
        await until(() => document.querySelector('.task-hub__mode-toggle'));
        document.querySelectorAll('.task-hub__mode-toggle button')[1].click();
        await until(() => viewOf('children'));
        return JSON.stringify(state());
    `);
}

/** Click a button of the source mode, and wait for what it leads to to settle. */
function click(selector: string): SourceState {
    return run<SourceState>(`
        const button = document.querySelector(${JSON.stringify(selector)});
        if (!button) throw new Error('no button ' + ${JSON.stringify(selector)});
        button.click();
        await until(() => !document.querySelector('.task-hub__source-actions .mod-cta')?.disabled || !viewOf('children'));
        await sleep(300);
        return JSON.stringify(state());
    `);
}

/** Close whatever hub is open, throwing its draft away if it asks. */
function closeHub(): void {
    run(`
        document.querySelector('.task-hub .tv-overlay__close, .tv-overlay__close')?.click();
        await sleep(100);
        document.querySelector('.task-hub__source-discard')?.click();
        await until(() => !document.querySelector('.task-hub'));
        return 'ok';
    `);
}

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
});

afterEach(() => { closeHub(); });

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('the hub\'s source mode', () => {
    beforeAll(async () => { await writeIndexedTestFile(TEST_FILE, NOTE); });

    it('keeps a draft from a close, and writes it with the parent and children as the file spells them on Mod+Enter', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const opened = openSource('親');
        expect(opened).toMatchObject({ source: true, parent: '- [ ] 親 @2026-09-29', children: '- [ ] 子a\n- [ ] 子b', actions: true });

        // The parent checked, a child's text changed, a line added a level under the last child.
        run(`
            const parent = viewOf('parent'), children = viewOf('children');
            const box = parent.state.doc.toString().indexOf('[ ]') + 1;
            parent.dispatch({ changes: { from: box, to: box + 1, insert: 'x' } });
            children.dispatch({ changes: { from: children.state.doc.line(1).to, insert: '2' } });
            children.dispatch({ changes: { from: children.state.doc.length, insert: '\\n    - [ ] 孫' } });
            return 'ok';
        `);

        // A close the user asks for keeps the draft, and asks.
        const asked = click('.task-hub .tv-overlay__close');
        expect(asked).toMatchObject({ hub: true, source: true, asking: true });
        // One row asks: discard and the question at its start, back (where cancel was, with the focus) and apply at its end.
        const row = run<Record<string, unknown>>(`
            const actions = document.querySelector('.task-hub__source-actions');
            const items = [...actions.children].filter(el => getComputedStyle(el).display !== 'none');
            const rects = items.map(el => el.getBoundingClientRect());
            const box = actions.getBoundingClientRect();
            return JSON.stringify({
                items: items.map(el => el.textContent),
                oneLine: rects.every(r => Math.abs(r.top + r.height / 2 - (rects[0].top + rects[0].height / 2)) < 2),
                discardAtStart: Math.abs(rects[0].left - box.left) < 2,
                applyAtEnd: Math.abs(rects[3].right - box.right) < 2,
                apart: rects[2].left - rects[1].right > 16,
                focused: document.activeElement === actions.querySelector('.task-hub__source-cancel'),
            });
        `);
        expect(row).toEqual({ items: ['捨てる', '下書きを捨てますか', '戻る', '適用'], oneLine: true, discardAtStart: true, applyAtEnd: true, apart: true, focused: true });
        const kept = click('.task-hub__source-cancel');
        expect(run<string[]>(`return JSON.stringify([...document.querySelectorAll('.task-hub__source-actions > *')].filter(el => getComputedStyle(el).display !== 'none').map(el => el.textContent));`)).toEqual(['キャンセル', '適用']);
        expect(kept).toMatchObject({ source: true, asking: false, children: '- [ ] 子a2\n- [ ] 子b\n    - [ ] 孫' });

        const applied = run<SourceState>(`
            const content = document.querySelector('.task-hub .tv-source-editor__parent .cm-content');
            viewOf('parent').focus();
            content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, metaKey: true, ctrlKey: navigator.platform.indexOf('Mac') < 0, bubbles: true, cancelable: true }));
            await until(() => !viewOf('children'));
            await sleep(300);
            return JSON.stringify(state());
        `);
        expect(applied).toMatchObject({ hub: true, source: false });
        expect(readTestFile(TEST_FILE)).toBe([
            '# 見出し',
            '- [x] 親 @2026-09-29',
            '    - [ ] 子a2',
            '    - [ ] 子b',
            '        - [ ] 孫',
            '- [ ] 次',
            '',
        ].join('\n'));
    });

    it('keeps a refused draft with why under it, tells no notice, and does not write the same draft again', async () => {
        await writeIndexedTestFile(TEST_FILE, FENCED);
        openSource('親');
        // Without the code block, the paragraph below would go on the child's text: refused as \`disturbs\`.
        run(`
            const children = viewOf('children');
            children.dispatch({ changes: { from: 0, to: children.state.doc.length, insert: 'text' } });
            const service = plugin.writeService;
            window.__tvSourceWrites = 0;
            window.__tvSourceReplace = service.replaceSubtree;
            service.replaceSubtree = function (...args) { window.__tvSourceWrites++; return window.__tvSourceReplace.apply(this, args); };
            return 'ok';
        `);
        try {
            const before = sourceState();
            const refused = click('.task-hub__source-actions .mod-cta');
            expect(refused).toMatchObject({ source: true, children: 'text', actions: true });
            expect(refused.message).toBeTruthy();
            expect(refused.notices).toBe(before.notices);
            expect(readTestFile(TEST_FILE)).toBe(FENCED);

            const again = click('.task-hub__source-actions .mod-cta');
            expect(again).toMatchObject({ source: true, message: refused.message });
            expect(run<number>('return window.__tvSourceWrites;')).toBe(1);
            expect(readTestFile(TEST_FILE)).toBe(FENCED);
        } finally {
            run(`plugin.writeService.replaceSubtree = window.__tvSourceReplace; delete window.__tvSourceReplace; delete window.__tvSourceWrites; return 'ok';`);
        }
    });

    it('breaks the parent\'s line into its first child, goes on with lists on Enter, and moves between the editors by arrow', async () => {
        await writeIndexedTestFile(TEST_FILE, LISTS);
        const opened = openSource('親');
        expect(opened).toMatchObject({ parent: '- [x] 親 後半', children: '- [ ] 子a\n1. 手順' });

        const steps = run<Record<string, unknown>>(`
            const parent = viewOf('parent');
            parent.focus();
            parent.dispatch({ selection: { anchor: parent.state.doc.toString().indexOf(' 後半') } });
            await press('Enter');
            const broken = { ...state(), focused: focused(), caret: caret() };

            await press('ArrowUp');
            const up = { focused: focused(), caret: caret() };
            await press('ArrowDown');
            const down = { focused: focused(), caret: caret() };

            const children = viewOf('children');
            children.dispatch({ selection: { anchor: children.state.doc.line(1).to } });
            await press('Enter');
            typeText('足した');
            children.dispatch({ selection: { anchor: children.state.doc.line(4).to } });
            await press('Enter');
            typeText('次の手順');
            return JSON.stringify({ broken, up, down, after: state() });
        `);
        expect(steps).toMatchObject({
            broken: { parent: '- [x] 親', children: '- [ ] 後半\n- [ ] 子a\n1. 手順', focused: 'children', caret: 6 },
            up: { focused: 'parent', caret: 6 },
            down: { focused: 'children', caret: 6 },
            after: { parent: '- [x] 親', children: '- [ ] 後半\n- [ ] 足した\n- [ ] 子a\n1. 手順\n2. 次の手順' },
        });

        const applied = click('.task-hub__source-actions .mod-cta');
        expect(applied.source).toBe(false);
        expect(readTestFile(TEST_FILE)).toBe([
            '# 見出し',
            '- [x] 親',
            '    - [ ] 後半',
            '    - [ ] 足した',
            '    - [ ] 子a',
            '    1. 手順',
            '    2. 次の手順',
            '- [ ] 次',
            '',
        ].join('\n'));
    });

    it('shows the editors as invalid while asking, and opens the hub asked for once the draft is thrown away', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        openSource('親');
        const asked = run<Record<string, unknown>>(`
            const children = viewOf('children');
            children.dispatch({ changes: { from: children.state.doc.length, insert: ' 下書き' } });
            const next = plugin.getTaskIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith('次'));
            plugin.openTaskHub(next.id);
            await sleep(100);
            const pane = document.querySelector('.task-hub__source-pane');
            const editor = document.querySelector('.task-hub .tv-source-editor__children .cm-editor');
            return JSON.stringify({ ...state(), marked: pane.classList.contains('task-hub__source-pane--asking'), shadow: getComputedStyle(editor).boxShadow, preview: document.querySelector('.task-hub__preview').textContent });
        `);
        expect(asked).toMatchObject({ hub: true, source: true, asking: true, marked: true, children: '- [ ] 子a\n- [ ] 子b 下書き' });
        expect(asked.shadow).not.toBe('none');

        const handed = run<Record<string, unknown>>(`
            document.querySelector('.task-hub__source-discard').click();
            await until(() => document.querySelectorAll('.task-hub').length === 1 && document.querySelector('.task-hub__preview')?.textContent.includes('次'));
            await sleep(300);
            return JSON.stringify({ ...state(), hubs: document.querySelectorAll('.task-hub:not(.is-closing)').length, preview: document.querySelector('.task-hub:not(.is-closing) .task-hub__preview').textContent });
        `);
        expect(handed).toMatchObject({ hub: true, source: false, hubs: 1 });
        expect(handed.preview).toContain('次');
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
    });

    it('withdraws the question on an edit, and writes a draft applied while asked, the hub staying open', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        openSource('親');
        const steps = run<Record<string, SourceState>>(`
            const children = viewOf('children');
            children.focus();
            children.dispatch({ selection: { anchor: children.state.doc.length } });
            typeText(' 1');
            document.querySelector('.task-hub .tv-overlay__close').click();
            await sleep(100);
            const asked = state();
            viewOf('children').focus();
            await sleep(50);
            const focusedBack = state();
            typeText('2');
            await sleep(50);
            const edited = state();
            document.querySelector('.task-hub .tv-overlay__close').click();
            await sleep(100);
            const askedAgain = state();
            return JSON.stringify({ asked, focusedBack, edited, askedAgain });
        `);
        expect(steps.asked).toMatchObject({ hub: true, asking: true, actions: true });
        // The focus given back without an edit leaves the question.
        expect(steps.focusedBack).toMatchObject({ asking: true });
        expect(steps.edited).toMatchObject({ hub: true, source: true, asking: false, children: '- [ ] 子a\n- [ ] 子b 12' });
        expect(steps.askedAgain).toMatchObject({ asking: true });

        const applied = click('.task-hub__source-actions .mod-cta');
        expect(applied).toMatchObject({ hub: true, source: false, asking: false });
        expect(readTestFile(TEST_FILE)).toBe(NOTE.replace('子b', '子b 12'));
    });

    it('keeps Obsidian\'s hotkeys from the note behind while the focus is in the hub, its child popovers among it', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const result = run<Record<string, unknown>>(`
            const file = app.vault.getAbstractFileByPath(${JSON.stringify(TEST_FILE)});
            const leaf = app.workspace.getLeaf('tab');
            await leaf.openFile(file, { state: { mode: 'source', source: true } });
            app.workspace.setActiveLeaf(leaf, { focus: true });
            await sleep(300);
            const editor = leaf.view.editor;
            const pick = () => editor.setSelection({ line: 4, ch: 6 }, { line: 4, ch: 7 });
            const bold = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', keyCode: 66, metaKey: true, ctrlKey: navigator.platform.indexOf('Mac') < 0, bubbles: true, cancelable: true }));
            try {
                const task = plugin.getTaskIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith('親'));
                plugin.openTaskHub(task.id);
                await until(() => document.querySelector('.task-hub__form input.tv-ctrl__text-input'));
                pick();
                document.querySelector('.task-hub__form input.tv-ctrl__text-input').focus();
                bold();
                await sleep(200);
                const inField = editor.getLine(4);

                document.querySelector('.task-hub__status-pill').click();
                await until(() => document.querySelector('.tv-ctrl__suggest button, .tv-ctrl__suggest input'));
                document.querySelector('.tv-ctrl__suggest button, .tv-ctrl__suggest input').focus();
                const inChild = { inPanel: !!document.activeElement.closest('.task-hub') };
                bold();
                await sleep(200);
                inChild.line = editor.getLine(4);
                document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                await sleep(200);
                const afterEscape = { child: !!document.querySelector('.tv-ctrl__suggest'), hub: !!document.querySelector('.task-hub:not(.is-closing)') };

                // The same key with the focus moved to the note: the hotkey is let in again.
                editor.focus();
                pick();
                bold();
                await sleep(200);
                const inNote = editor.getLine(4);
                return JSON.stringify({ inField, inChild, afterEscape, inNote });
            } finally {
                leaf.detach();
            }
        `);
        expect(result).toMatchObject({
            inField: '- [ ] 次',
            inChild: { inPanel: false, line: '- [ ] 次' },
            afterEscape: { child: false, hub: true },
            inNote: '- [ ] **次**',
        });
    });

    it('keeps the draft of a row lost to a change from outside, offering to copy it and throw it away', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        openSource('親');
        run(`
            const children = viewOf('children');
            children.dispatch({ changes: { from: children.state.doc.line(2).to, insert: ' 下書き' } });
            return 'ok';
        `);

        writeTestFile(TEST_FILE, NOTE + '- [ ] 外で足した行\n');
        let lost = sourceState();
        for (let i = 0; i < 40 && !lost.lost; i++) {
            await sleep(250);
            lost = sourceState();
        }
        expect(lost).toMatchObject({ source: true, lost: true, actions: false, children: '- [ ] 子a\n- [ ] 子b 下書き' });

        const discarded = click('.task-hub__source-lost .mod-warning');
        expect(discarded.source).toBe(false);
        expect(discarded.shut).toBeTruthy();
        expect(readTestFile(TEST_FILE)).toBe(NOTE + '- [ ] 外で足した行\n');
    });
});
