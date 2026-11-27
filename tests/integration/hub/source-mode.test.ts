/**
 * The hub's source mode, in the running E2E vault: the hub opened on a row,
 * its source edited through the CodeMirror views the hub shows, applied,
 * and the note's bytes read back. The card the source takes the place of
 * is drawn again as the form's writes change the row, and the source opens
 * on what those writes left.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open,
 *     with a build that has the source mode
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/source-mode.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { obsidianEval, sleep } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile, writeTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { DIALOG_ROWS } from '../helpers/dialog-rows';

const TEST_FILE = 'test-int-source-mode.md';

const NOTE = [
    '# 見出し',
    '- [ ] 親 @2026-09-29',
    '    - [ ] 子a',
    '    - [ ] 子b',
    '- [ ] 次',
    '',
].join('\n');

/**
 * A row with a tag, in a note of its own. The list under the hub's tag field
 * offers the tags of the vault's rows, and shows only when there is one.
 */
const TAGGED_FILE = 'test-int-source-mode-tagged.md';
const TAGGED = '- [ ] 札 #test-int-source-mode\n';

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
    asking: shown('.task-hub__source-actions .tv-form__ask'),
    lost: shown('.task-hub__source-lost'),
    actions: shown('.task-hub__source-actions'),
    shut: shown('.task-hub__mode-shut') ? document.querySelector('.task-hub__mode-shut').textContent : null,
    notices: document.querySelectorAll('.notice').length,
});
/**
 * Where the switch stands: on the title's line after the title and before the
 * ×, centred on the title; whether a row of its own is left above the card;
 * and the line saying why the source cannot open, its text and whether it
 * stands between the body's top and the card, or takes no room.
 */
const layout = () => {
    const panel = document.querySelector('.task-hub');
    const head = panel.querySelector('.tv-overlay__head');
    const title = head.querySelector('.tv-form__title').getBoundingClientRect();
    const toggleEl = panel.querySelector('.task-hub__mode-toggle');
    const toggle = toggleEl.getBoundingClientRect();
    const close = panel.querySelector('.tv-overlay__close').getBoundingClientRect();
    const bodyEl = panel.querySelector('.tv-overlay__body');
    const body = bodyEl.getBoundingClientRect();
    const card = panel.querySelector('.task-hub__preview').getBoundingClientRect();
    const shutEl = panel.querySelector('.task-hub__mode-shut');
    const shutBox = shutEl.getBoundingClientRect();
    return {
        inHead: toggleEl.parentElement === head,
        afterTitle: toggle.left >= title.right,
        beforeClose: toggle.right <= close.left,
        centred: Math.abs((toggle.top + toggle.bottom) / 2 - (title.top + title.bottom) / 2) < 1,
        modeBar: !!panel.querySelector('.task-hub__mode-bar'),
        shut: shown('.task-hub__mode-shut') ? shutEl.textContent : null,
        shutAboveCard: shown('.task-hub__mode-shut') ? shutBox.bottom <= card.top + 0.5 && shutBox.top >= body.top : null,
        shutHeight: Math.round(shutBox.height),
        first: [...bodyEl.children].find(el => getComputedStyle(el).display !== 'none')?.classList[0] ?? null,
    };
};
${UNTIL}
${DIALOG_ROWS}
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
/** The color a CSS value resolves to in the hub, as computed styles give it. */
const colorOf = value => { const probe = document.querySelector('.task-hub').createDiv(); probe.style.color = value; const color = getComputedStyle(probe).color; probe.remove(); return color; };
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
        const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(${JSON.stringify(name)}));
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
        document.querySelector('.task-hub__source-actions .tv-form__discard')?.click();
        await until(() => !document.querySelector('.task-hub'));
        return 'ok';
    `);
}

afterEach(() => { closeHub(); });

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    deleteTestFile(TAGGED_FILE);
    await waitForFileDeindexed(TEST_FILE);
    await waitForFileDeindexed(TAGGED_FILE);
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
        // One row asks: the question on a line of its own, then discard at the start of the next, back (where cancel was, with the focus) and apply at its end.
        const row = run<Record<string, unknown>>(`
            const actions = document.querySelector('.task-hub__source-actions .tv-form__buttons');
            const items = [...actions.children].filter(el => getComputedStyle(el).display !== 'none');
            const rects = items.map(el => el.getBoundingClientRect());
            const box = actions.getBoundingClientRect();
            return JSON.stringify({
                items: items.map(el => el.textContent),
                askAbove: rects[0].bottom <= rects[1].top,
                buttonsOneLine: rects.slice(2).every(r => Math.abs(r.top - rects[1].top) < 1),
                askAtStart: Math.abs(rects[0].left - box.left) < 2,
                discardAtStart: Math.abs(rects[1].left - box.left) < 2,
                applyAtEnd: Math.abs(rects[3].right - box.right) < 2,
                apart: rects[2].left - rects[1].right > 16,
                focused: document.activeElement === actions.querySelector('.tv-form__cancel'),
            });
        `);
        expect(row).toEqual({ items: [tr('modal.draft.discardAsk'), tr('modal.draft.discard'), tr('modal.draft.keep'), tr('modal.hub.source.apply')], askAbove: true, buttonsOneLine: true, askAtStart: true, discardAtStart: true, applyAtEnd: true, apart: true, focused: true });
        const kept = click('.task-hub__source-actions .tv-form__cancel');
        expect(run<string[]>(`return JSON.stringify([...document.querySelectorAll('.task-hub__source-actions .tv-form__buttons > *')].filter(el => getComputedStyle(el).display !== 'none').map(el => el.textContent));`)).toEqual([tr('modal.cancel'), tr('modal.hub.source.apply')]);
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
            const service = plugin.operations;
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
            run(`plugin.operations.replaceSubtree = window.__tvSourceReplace; delete window.__tvSourceReplace; delete window.__tvSourceWrites; return 'ok';`);
        }
    });

    it('boxes the parent and the children each as an input field, the children\'s box indented with the guide outside it, and says what goes in an empty one', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        openSource('次');
        const look = run<Record<string, unknown>>(`
            const parent = document.querySelector('.task-hub .tv-source-editor__parent');
            const children = document.querySelector('.task-hub .tv-source-editor__children');
            const p = parent.getBoundingClientRect(), c = children.getBoundingClientRect();
            const guide = getComputedStyle(children, '::before');
            const border = parseFloat(getComputedStyle(children).borderLeftWidth);
            const guideLeft = c.left + border + parseFloat(guide.left);
            const guideTop = c.top + border + parseFloat(guide.top);
            const dash = viewOf('parent').coordsForChar(0);
            const accent = colorOf('var(--tv-accent)');
            const focusedBoxes = () => [parent, children].map(box => getComputedStyle(box).borderTopColor === accent);
            viewOf('parent').focus();
            await sleep(100);
            const onParent = focusedBoxes();
            viewOf('children').focus();
            await sleep(100);
            const onChildren = focusedBoxes();
            return JSON.stringify({
                boxes: [parent, children].map(box => box.classList.contains('tv-ctrl__input-wrap') && box.classList.contains('tv-ctrl__input-wrap--glow')),
                oneBox: document.querySelector('.task-hub .tv-source-editor').classList.contains('tv-ctrl__input-wrap'),
                indented: c.left - p.left > 10 && Math.abs(p.right - c.right) < 1,
                guideUnderDash: guideLeft >= dash.left && guideLeft <= dash.right && guideLeft < c.left - 2,
                guideSpansBox: Math.abs(guideTop - c.top) < 1 && Math.abs(parseFloat(guide.height) - c.height) < 1,
                placeholder: children.querySelector('.cm-placeholder')?.textContent ?? null,
                onParent, onChildren,
            });
        `);
        expect(look).toEqual({
            boxes: [true, true], oneBox: false, indented: true, guideUnderDash: true, guideSpansBox: true,
            placeholder: tr('modal.sourceChildren'), onParent: [true, false], onChildren: [false, true],
        });
        // Typed in, the placeholder goes.
        const typed = run<string | null>(`viewOf('children').focus(); typeText('- [ ] 子'); await sleep(50); return JSON.stringify(document.querySelector('.task-hub .tv-source-editor__children .cm-placeholder')?.textContent ?? null);`);
        expect(typed).toBeNull();
    });

    it('shuts the form\'s picker fields as a whole: their menu and picker buttons open nothing and change nothing', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        openSource('親');
        const shut = run<Record<string, unknown>>(`
            const fields = [...document.querySelectorAll('.task-hub .tv-form__input-with-picker')];
            const controls = fields.flatMap(f => [...f.querySelectorAll('input, button')]);
            const start = fields[0];
            const shownBefore = start.querySelector('.tv-ctrl__text-input').value;
            const showPicker = HTMLInputElement.prototype.showPicker;
            const presenter = app.plugins.plugins['obsidian-task-viewer'].menuPresenter;
            const present = presenter.present;
            let opened = 0;
            HTMLInputElement.prototype.showPicker = function () { opened++; };
            presenter.present = function (...args) { opened++; return present.apply(this, args); };
            try {
                start.querySelector('button.tv-form__menu-button').click();
                for (const f of fields) {
                    f.querySelector('.tv-form__picker-button').click();
                    f.querySelector('.tv-form__native-picker-input').click();
                }
            } finally {
                HTMLInputElement.prototype.showPicker = showPicker;
                presenter.present = present;
            }
            await sleep(200);
            return JSON.stringify({
                fields: fields.length,
                startMenu: !!start.querySelector('button.tv-form__menu-button'),
                allDisabled: controls.every(c => c.disabled),
                shownBefore,
                shownAfter: start.querySelector('.tv-ctrl__text-input').value,
                opened,
            });
        `);
        // Six date and time fields and the color field.
        expect(shut).toEqual({ fields: 7, startMenu: true, allDisabled: true, shownBefore: '2026-09-29', shownAfter: '2026-09-29', opened: 0 });
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
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

    it('asks when another hub is asked for, showing the editors as invalid, and opens no other hub once the draft is thrown away', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        openSource('親');
        const asked = run<Record<string, unknown>>(`
            const children = viewOf('children');
            children.dispatch({ changes: { from: children.state.doc.length, insert: ' 下書き' } });
            const next = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith('次'));
            plugin.openTaskHub(next.id);
            await sleep(100);
            const pane = document.querySelector('.task-hub__source-pane');
            const boxes = [...document.querySelectorAll('.task-hub .tv-source-editor > .tv-ctrl__input-wrap')];
            const danger = colorOf('var(--tv-text-danger)');
            return JSON.stringify({ ...state(), marked: pane.classList.contains('tv-source-drafts--asking'), red: boxes.length === 2 && boxes.every(box => getComputedStyle(box).borderTopColor === danger), preview: document.querySelector('.task-hub__preview').textContent });
        `);
        expect(asked).toMatchObject({ hub: true, source: true, asking: true, marked: true, red: true, children: '- [ ] 子a\n- [ ] 子b 下書き' });

        const discarded = run<Record<string, unknown>>(`
            document.querySelector('.task-hub__source-actions .tv-form__discard').click();
            await until(() => !document.querySelector('.task-hub'));
            await sleep(300);
            return JSON.stringify(state());
        `);
        // The hub asked for is forgotten: throwing the draft away closes this hub and opens none.
        expect(discarded).toMatchObject({ hub: false, source: false });
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

    it('takes the focus to back on every close refused, the question standing or not', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        openSource('親');
        const steps = run<Record<string, unknown>>(`
            const children = viewOf('children');
            children.dispatch({ changes: { from: children.state.doc.length, insert: ' 下書き' } });
            const onBack = () => document.activeElement === document.querySelector('.task-hub__source-actions .tv-form__cancel');
            const outside = () => document.querySelector('.task-hub .tv-overlay__backdrop, .tv-overlay__backdrop')
                .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
            // First asked by a press outside, with the focus in the editor.
            viewOf('children').focus();
            outside();
            await sleep(50);
            const first = { ...state(), onBack: onBack() };
            // The focus given back to the editor, then a close again: the question stands, the focus goes to back.
            viewOf('children').focus();
            await sleep(50);
            const inEditor = onBack();
            outside();
            await sleep(50);
            const again = { ...state(), onBack: onBack() };
            viewOf('children').focus();
            document.querySelector('.task-hub .tv-overlay__close').click();
            await sleep(50);
            const byButton = { ...state(), onBack: onBack() };
            return JSON.stringify({ first, inEditor, again, byButton });
        `);
        expect(steps).toMatchObject({
            first: { hub: true, asking: true, onBack: true },
            inEditor: false,
            again: { hub: true, asking: true, onBack: true },
            byButton: { hub: true, asking: true, onBack: true },
        });
    });

    it('takes the back as Escape: a list open under a field first, then a close that asks over a draft', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        await writeIndexedTestFile(TAGGED_FILE, TAGGED);
        // Obsidian's history.back() calls what is on top of its stack, as Android's back and the mouse's back button do.
        const steps = run<Record<string, unknown>>(`
            const onBack = () => document.activeElement === document.querySelector('.task-hub__source-actions .tv-form__cancel');
            const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith('親'));
            // The list under the tag field (Obsidian's), open as the field takes the focus.
            plugin.openTaskHub(task.id, { focusField: 'tags' });
            await until(() => document.querySelector('.suggestion-container'));
            window.history.back();
            await sleep(200);
            const child = { child: !!document.querySelector('.suggestion-container'), hub: state().hub };

            document.querySelectorAll('.task-hub__mode-toggle button')[1].click();
            await until(() => viewOf('children'));
            const children = viewOf('children');
            children.dispatch({ changes: { from: children.state.doc.length, insert: ' 下書き' } });
            children.focus();
            window.history.back();
            await sleep(100);
            const asked = { ...state(), onBack: onBack() };
            viewOf('children').focus();
            window.history.back();
            await sleep(100);
            const again = { ...state(), onBack: onBack() };

            document.querySelector('.task-hub__source-actions .tv-form__discard').click();
            await until(() => !document.querySelector('.task-hub:not(.is-closing)'));
            const discarded = state().hub;

            plugin.openTaskHub(task.id);
            await until(() => document.querySelector('.task-hub__mode-toggle'));
            window.history.back();
            await sleep(300);
            const closed = !document.querySelector('.task-hub:not(.is-closing)');
            return JSON.stringify({ child, asked, again, discarded, closed });
        `);
        expect(steps).toMatchObject({
            child: { child: false, hub: true },
            asked: { hub: true, asking: true, onBack: true },
            again: { hub: true, asking: true, onBack: true },
            discarded: false,
            closed: true,
        });
    });

    it('keeps Obsidian\'s hotkeys from the note behind while the focus is in the hub, a list open under a field among it', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        await writeIndexedTestFile(TAGGED_FILE, TAGGED);
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
                const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith('親'));
                plugin.openTaskHub(task.id);
                await until(() => document.querySelector('.task-hub__form input.tv-ctrl__text-input'));
                pick();
                document.querySelector('.task-hub__form input.tv-ctrl__text-input').focus();
                bold();
                await sleep(200);
                const inField = editor.getLine(4);

                // A list open under a field (Obsidian's, on the body): the focus stays in the field.
                chooseTabOf(document.querySelector('.task-hub__tag-add-wrap input')).focus();
                await until(() => document.querySelector('.suggestion-container'));
                const inChild = { inPanel: !!document.activeElement.closest('.task-hub'), list: !!document.querySelector('.suggestion-container') };
                pick();
                bold();
                await sleep(200);
                inChild.line = editor.getLine(4);
                document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                await sleep(200);
                const afterEscape = { child: !!document.querySelector('.suggestion-container'), hub: !!document.querySelector('.task-hub:not(.is-closing)') };

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
            inChild: { inPanel: true, list: true, line: '- [ ] 次' },
            afterEscape: { child: false, hub: true },
            inNote: '- [ ] **次**',
        });
    });

    it('keeps the form\'s tabs to be chosen while it holds the row and after, each tab\'s fields shut while it does and open again after', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const steps = run<Record<string, unknown>>(`
            const hub = () => document.querySelector('.task-hub');
            /** The text fields of a tab, apart from the add field of a list, and how many of them are shut. */
            const fieldsOf = id => [...hubPane(hub(), id).querySelectorAll('input[type="text"], input:not([type]), textarea')];
            /** The tab chosen by its button, and how it stands then: its fields shut or not, the other tab off. */
            const choose = id => {
                chooseHubTab(hub(), id);
                const fields = fieldsOf(id);
                return {
                    tab: hubTabOn(hub()),
                    pressable: !hubTab(hub(), id).disabled,
                    fields: fields.length,
                    shut: fields.filter(f => f.disabled).length,
                    otherOff: hubPane(hub(), id === 'basic' ? 'detail' : 'basic').hasAttribute('inert'),
                };
            };
            const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith('親'));
            plugin.openTaskHub(task.id);
            await until(() => document.querySelector('.task-hub__mode-toggle'));
            const before = { detail: choose('detail'), basic: choose('basic') };
            document.querySelectorAll('.task-hub__mode-toggle button')[1].click();
            await until(() => viewOf('children'));
            const during = { detail: choose('detail'), basic: choose('basic') };
            document.querySelectorAll('.task-hub__mode-toggle button')[0].click();
            await until(() => !viewOf('children') && !fieldsOf('basic')[0].disabled);
            const after = { detail: choose('detail'), basic: choose('basic') };
            return JSON.stringify({ before, during, after });
        `);
        type Tab = { tab: string; pressable: boolean; fields: number; shut: number; otherOff: boolean };
        const before = steps.before as Record<'basic' | 'detail', Tab>;
        for (const id of ['basic', 'detail'] as const) {
            expect(before[id]).toMatchObject({ tab: id, pressable: true, shut: 0, otherOff: true });
            expect(before[id].fields).toBeGreaterThan(0);
            // While the source holds the row, every field of the tab is shut, and the tab is still chosen by its button.
            expect(steps.during).toHaveProperty(id, { ...before[id], shut: before[id].fields });
            expect(steps.after).toHaveProperty(id, before[id]);
        }
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
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
        expect(discarded.shut).toBe(tr('modal.hub.taskMissing'));
        // Why it cannot open is a line of its own above the card; the switch stays on the title's line.
        expect(run<Record<string, unknown>>('return JSON.stringify(layout());')).toMatchObject({ inHead: true, modeBar: false, shut: tr('modal.hub.taskMissing'), shutAboveCard: true, first: 'task-hub__mode-shut' });
        expect(readTestFile(TEST_FILE)).toBe(NOTE + '- [ ] 外で足した行\n');
    });
});

describe('the hub\'s switch between the form and the source', () => {
    it('stands on the title\'s line, after the title and clear of the ×, in the form and in the source, the body starting with the card while the source can open', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const steps = run<Record<string, unknown>>(`
            const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith('親'));
            plugin.openTaskHub(task.id);
            await until(() => document.querySelector('.task-hub__mode-toggle'));
            await sleep(300);
            const out = { title: document.querySelector('.task-hub .tv-form__title').textContent, view: layout() };
            document.querySelectorAll('.task-hub__mode-toggle button')[1].click();
            await until(() => viewOf('children'));
            out.source = layout();
            return JSON.stringify(out);
        `);
        const onTitleLine = { inHead: true, afterTitle: true, beforeClose: true, centred: true, modeBar: false, shut: null, shutHeight: 0 };
        expect(steps).toEqual({
            title: tr('modal.hub.title'),
            view: { ...onTitleLine, shutAboveCard: null, first: 'task-hub__preview' },
            source: { ...onTitleLine, shutAboveCard: null, first: 'task-hub__source-pane' },
        });
    });
});

describe('the hub following its row', () => {
    it('draws the row as the form wrote it in the card', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<Record<string, unknown>>(`
            const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith('親'));
            plugin.openTaskHub(task.id);
            const content = () => document.querySelector('.task-hub .task-hub__preview .task-card__content');
            const name = () => document.querySelector('.task-hub .tv-form__name-section input');
            await until(() => content() && name());
            const before = content().textContent;
            const input = name();
            input.focus();
            input.value = '親7';
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
            // The card is drawn again once the index has the row as written (the write's echo).
            await until(() => content()?.textContent.includes('親7'), 5000, 'the card drawn again with the name written');
            return JSON.stringify({ before: before.includes('親7'), after: content().textContent.includes('親7'), disk: await app.vault.adapter.read(${JSON.stringify(TEST_FILE)}) });
        `);
        expect(seen).toEqual({ before: false, after: true, disk: NOTE.replace('- [ ] 親 @2026-09-29', '- [ ] 親7 @2026-09-29') });
    });

    it('opens the source on the name the form wrote, once its write is answered', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const steps = run<Record<string, unknown>>(`
            const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith('親'));
            plugin.openTaskHub(task.id);
            const name = () => document.querySelector('.task-hub .tv-form__name-section input');
            await until(() => name() && document.querySelector('.task-hub__mode-toggle'));
            // The disk holds the next write until it is let go: the switch to the source is asked while the name's write is under way.
            const real = app.vault.process;
            let release;
            const held = new Promise(r => { release = r; });
            app.vault.process = async function (...args) { app.vault.process = real; await held; return real.apply(this, args); };
            const out = {};
            try {
                const input = name();
                input.focus();
                input.value = '親5';
                input.dispatchEvent(new InputEvent('input', { bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
                document.querySelectorAll('.task-hub__mode-toggle button')[1].click();
                // While the write is held the source does not open.
                await sleep(300);
                out.held = { source: !!viewOf('parent'), disk: await app.vault.adapter.read(${JSON.stringify(TEST_FILE)}) };
                release();
                await until(() => viewOf('parent'), 5000, 'the source opened once the write was answered');
            } finally {
                release();
                app.vault.process = real;
            }
            out.opened = { parent: viewOf('parent').state.doc.toString(), disk: await app.vault.adapter.read(${JSON.stringify(TEST_FILE)}) };
            return JSON.stringify(out);
        `);
        const written = NOTE.replace('- [ ] 親 @2026-09-29', '- [ ] 親5 @2026-09-29');
        expect(steps).toEqual({
            held: { source: false, disk: NOTE },
            opened: { parent: '- [ ] 親5 @2026-09-29', disk: written },
        });
    });
});
