/**
 * The questions put to the user, in the running E2E vault: the
 * delete's confirmation, a flow's three ways to delete, and a timer's three
 * ways to start on a completed task stand on OverlayShell (`askChoice`),
 * open with the focus on cancel, and answer once: the button pressed, or
 * cancel however else they close (Escape, the close button, a press
 * outside). The timer's Custom... length (`askText`) says under its field
 * what does not read, stays open, and closes on a value that does, in the
 * range of the settings' table (a work of a minute or more).
 *
 * The forms that ask in their row of buttons whether to throw a draft away
 * (the hub of a task not written yet, the hub's source mode, the hub moving
 * a row) stand the question on a line of its own on the centered box,
 * whatever its width: discard at the start of the next line, back and the
 * act at its end.
 *
 * The delete is chosen from a card's menu, as a user chooses it; the timer
 * is started on the completed row as its menu starts it. The note's bytes
 * are read back from the disk.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open,
 *     with a build that has the questions of modals/ask
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/forms/ask-dialogs.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { closeEveryTimer } from '../helpers/timers';
import { closeViews, openView, readSettings, saveSettings, tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { MENUS } from '../helpers/menus';

const TEST_FILE = 'test-int-ask-dialogs.md';

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
${MENUS}
const rowOf = name => {
    const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(name));
    if (!task) throw new Error('no row ' + name);
    return task;
};
const askPanel = () => document.querySelector('.tv-overlay:not(.is-closing) .tv-overlay__panel.tv-ask');
/**
 * Whether the question has its first focus: on what it named, in its panel.
 * The panel itself holds the focus while it opens, so that is not it yet.
 */
const firstFocused = () => !!askPanel() && askPanel().contains(document.activeElement) && document.activeElement !== askPanel();
const buttons = () => [...(askPanel()?.querySelectorAll('.tv-form__buttons button') ?? [])];
const button = text => { const b = buttons().find(one => one.textContent === text); if (!b) throw new Error('no button ' + text); return b; };
/** What the question shows: its title, buttons, what has the focus, and what it says under a field. */
const askState = () => {
    const panel = askPanel();
    if (!panel) return { open: false };
    const active = document.activeElement;
    const says = [...panel.querySelectorAll('.tv-form__says > *')].map(el => el.textContent).join(' ');
    return {
        open: true,
        title: panel.querySelector('.tv-form__title')?.textContent ?? null,
        buttons: buttons().map(b => b.textContent),
        focus: active?.tagName === 'BUTTON' && panel.contains(active) ? active.textContent
            : active?.tagName === 'INPUT' && panel.contains(active) ? 'input' : null,
        says: says || null,
    };
};
const key = (el, init) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const escape = () => key(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape', keyCode: 27 });
const enter = el => key(el, { key: 'Enter', code: 'Enter', keyCode: 13 });
/** A press outside the panel: on the backdrop, as the shell sees one. */
const outside = () => askPanel().closest('.tv-overlay').querySelector('.tv-overlay__backdrop')
    .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
const closeButton = () => askPanel().querySelector('.tv-overlay__close').click();
/** Choose the item titled \`title\` of the card menu of the row named, and wait for the question and its first focus. */
const fromMenu = async (name, title) => {
    const task = rowOf(name);
    // The card menu the hub's cards open, made as a hub first opens.
    if (!plugin.taskHub.cards) {
        plugin.openTaskHub(task.id);
        await until(() => document.querySelector('.tv-overlay:not(.is-closing) .task-hub'));
        document.querySelector('.tv-overlay:not(.is-closing) .task-hub').closest('.tv-overlay__panel').querySelector('.tv-overlay__close').click();
        await sleep(250);
    }
    await plugin.taskHub.cards.menuHandler.showContextMenu(0, 0, task);
    menuItem(one => one.titleEl?.textContent === title);
    await until(() => firstFocused());
};
/** Wait for the question to be gone, and for what its answer wrote. */
const closed = async () => { await until(() => !askPanel()); await sleep(600); return askState(); };
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

interface AskState {
    open: boolean;
    title?: string | null;
    buttons?: string[];
    focus?: string | null;
    says?: string | null;
}

/** Close every overlay and menu the tests left open. */
function cleanUp(): void {
    run(`
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
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

describe('the delete\'s confirmation', () => {
    const NOTE = ['# 見出し', '- [ ] 消す @2026-10-04', '- [ ] 残す', ''].join('\n');

    it('opens on cancel, and deletes nothing when cancelled, escaped, closed or pressed outside of', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const steps = run<Record<string, AskState>>(`
            const out = {};
            const ways = { cancel: () => button(${JSON.stringify(tr('modal.cancel'))}).click(), escape, closeButton, outside };
            for (const [way, close] of Object.entries(ways)) {
                await fromMenu('消す', ${JSON.stringify(tr('menu.deleteTask'))});
                out[way + 'Opened'] = askState();
                close();
                out[way] = await closed();
            }
            return JSON.stringify(out);
        `);
        for (const way of ['cancel', 'escape', 'closeButton', 'outside']) {
            expect(steps[`${way}Opened`], way).toEqual({
                open: true,
                title: tr('menu.deleteTaskTitle'),
                buttons: [tr('modal.cancel'), tr('modal.delete')],
                focus: tr('modal.cancel'),
                says: null,
            });
            expect(steps[way], way).toEqual({ open: false });
        }
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
    });

    it('deletes the row on delete', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const after = run<AskState>(`
            await fromMenu('消す', ${JSON.stringify(tr('menu.deleteTask'))});
            button(${JSON.stringify(tr('modal.delete'))}).click();
            return JSON.stringify(await closed());
        `);
        expect(after.open).toBe(false);
        expect(readTestFile(TEST_FILE)).toBe(['# 見出し', '- [ ] 残す', ''].join('\n'));
    });
});

describe('a flow\'s three ways to delete', () => {
    const NOTE = ['# 見出し', '- [ ] 流れ @2026-10-04 ==> at(start + 1d)', ''].join('\n');
    const flowLines = () => readTestFile(TEST_FILE).split('\n').filter(l => l.includes('流れ'));

    it('opens on cancel with the next line shown, and deletes nothing when cancelled or escaped', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const steps = run<Record<string, AskState & { preview?: string | null }>>(`
            const out = {};
            const ways = { cancel: () => button(${JSON.stringify(tr('modal.cancel'))}).click(), escape };
            for (const [way, close] of Object.entries(ways)) {
                await fromMenu('流れ', ${JSON.stringify(tr('menu.deleteTask'))});
                // The line itself carries '=> ', which the eval's answer is read after: only its date comes back.
                const preview = askPanel().querySelector('.tv-flow-delete__preview code')?.textContent ?? '';
                out[way + 'Opened'] = { ...askState(), preview: preview.match(/@\\d{4}-\\d{2}-\\d{2}/)?.[0] ?? null };
                close();
                out[way] = await closed();
            }
            return JSON.stringify(out);
        `);
        for (const way of ['cancel', 'escape']) {
            expect(steps[`${way}Opened`], way).toMatchObject({
                open: true,
                title: tr('flowDelete.title'),
                buttons: [tr('modal.cancel'), tr('flowDelete.deleteOnly'), tr('flowDelete.fireAndDelete')],
                focus: tr('modal.cancel'),
            });
            expect(steps[`${way}Opened`].preview, way).toBe('@2026-10-05');
            expect(steps[way], way).toEqual({ open: false });
        }
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
    });

    it('deletes without a next line on delete without firing', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        run(`
            await fromMenu('流れ', ${JSON.stringify(tr('menu.deleteTask'))});
            button(${JSON.stringify(tr('flowDelete.deleteOnly'))}).click();
            return JSON.stringify(await closed());
        `);
        expect(flowLines()).toEqual([]);
    });

    it('writes the next line and deletes on fire and delete', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        run(`
            await fromMenu('流れ', ${JSON.stringify(tr('menu.deleteTask'))});
            button(${JSON.stringify(tr('flowDelete.fireAndDelete'))}).click();
            return JSON.stringify(await closed());
        `);
        const lines = flowLines();
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('@2026-10-05');
        expect(lines[0]).not.toContain('@2026-10-04');
    });
});

describe('a timer\'s three ways to start on a completed task', () => {
    const NOTE = ['# 見出し', '- [x] 済み @2026-10-04', ''].join('\n');
    afterEach(closeEveryTimer);

    /**
     * Start a count-up on the completed row in self, as the menu does, answer
     * the question by `how`, and say what was asked and the mode of the timer
     * that started, if one did. The timer is closed again, unrecorded.
     */
    function startAndAnswer(how: string): { opened: AskState; mode: string | null } {
        return run(`
            const widget = plugin.getTimerWidget();
            const before = new Set(widget.board.values().map(t => t.id));
            widget.startTimer(rowOf('済み'), 'self', { kind: 'countup' });
            await until(() => firstFocused());
            const opened = askState();
            ${how};
            await closed();
            const started = widget.board.values().find(t => !before.has(t.id)) ?? null;
            const mode = started?.mode ?? null;
            if (started) {
                await until(() => started.tail && !started.opening);
                await widget.lifecycle.close(started);
                await sleep(500);
            }
            return JSON.stringify({ opened, mode });
        `);
    }

    it('opens on cancel, and starts nothing when cancelled or escaped', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const cancelled = startAndAnswer(`button(${JSON.stringify(tr('modal.cancel'))}).click()`);
        const escaped = startAndAnswer('escape()');
        for (const [way, step] of Object.entries({ cancelled, escaped })) {
            expect(step.opened, way).toEqual({
                open: true,
                title: tr('timer.startOnCompletedTitle'),
                buttons: [tr('modal.cancel'), tr('timer.overwriteStart'), tr('timer.continueSession')],
                focus: tr('modal.cancel'),
                says: null,
            });
            expect(step.mode, way).toBeNull();
        }
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
    });

    it('starts beside the record on continue, and over it on record over it', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const continued = startAndAnswer(`button(${JSON.stringify(tr('timer.continueSession'))}).click()`);
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const overwritten = startAndAnswer(`button(${JSON.stringify(tr('timer.overwriteStart'))}).click()`);
        expect(continued.mode).toBe('sibling');
        expect(overwritten.mode).toBe('self');
    });
});

describe('the timer\'s Custom... length', () => {
    const KEYS = ['pomodoroWorkMinutes'] as const;
    let had: Record<string, unknown> | null = null;

    afterEach(async () => {
        if (had) saveSettings(had, 100);
        had = null;
        await closeViews();
    });

    it('opens on its field, says what does not read and stays open, and closes on a length that does', async () => {
        had = readSettings(KEYS);
        saveSettings({ pomodoroWorkMinutes: 25 }, 100);
        openView('timer', 'timer-view', { timerViewMode: 'pomodoro' });
        const steps = run<Record<string, AskState & { selected?: boolean; value?: string }>>(`
            // The view's settings menu, read as a menu of items: Custom... of the work length.
            const items = [];
            const menu = {
                addItem(cb) {
                    const item = { title: '', setTitle(t) { this.title = t; return this; }, setIcon() { return this; }, setDisabled() { return this; }, setChecked() { return this; }, onClick(f) { this.click = f; return this; } };
                    cb(item); items.push(item); return menu;
                },
                addSeparator() { return menu; },
            };
            window.__tvE2E.timer.view.appendDurationItems(menu);
            const custom = items.find(i => i.title.includes(${JSON.stringify(tr('timer.custom'))}));
            custom.click();
            await until(() => firstFocused());
            const input = () => askPanel().querySelector('input');
            const type = text => { input().value = text; input().dispatchEvent(new Event('input', { bubbles: true })); };
            const out = {};
            out.opened = { ...askState(), value: input().value, selected: input().selectionStart === 0 && input().selectionEnd === input().value.length };
            type('0');
            enter(input());
            await sleep(200);
            out.zero = askState();
            type('abc');
            out.typing = askState();
            button(${JSON.stringify(tr('modal.ok'))}).click();
            await sleep(200);
            out.abc = askState();
            // No upper bound on the work's length.
            type('200');
            enter(input());
            out.long = await closed();
            return JSON.stringify(out);
        `);
        expect(steps.opened).toMatchObject({ open: true, title: tr('timer.workDuration'), focus: 'input', value: '25', selected: true, says: null });
        expect(steps.zero).toMatchObject({ open: true, says: tr('issue.rangeAtLeast', { min: 1 }) });
        expect(steps.typing).toMatchObject({ open: true, says: null });
        expect(steps.abc).toMatchObject({ open: true, says: tr('issue.shape.int') });
        expect(steps.long).toEqual({ open: false });
        expect(readSettings(KEYS)).toEqual({ pomodoroWorkMinutes: 200 });
    });
});

describe('the row that asks whether to throw a draft away, on the centered box', () => {
    const NOTE = ['# 見出し', '- [ ] 行 @2026-10-04', '    - [ ] 子', ''].join('\n');
    /** The window's inner widths: the desktop's, and an iPad's in portrait, where the box is as wide as it gets. */
    const WIDTHS = [1600, 656];

    interface Shape { width: number; ask: string; discard: string; act: string; askBottom: number; tops: number[]; fromStart: number; toEnd: number }

    /**
     * Open each of the three forms that ask, give it a draft and ask it to
     * close, in a window `width` wide, and read where the question and the
     * row's buttons stand: the question's bottom, the tops of discard, back
     * and the act, discard's left from the row's start and the act's right
     * from the row's end.
     */
    const shapes = (width: number) => run<Record<string, Shape>>(`
        const top = () => document.querySelector('.tv-overlay:not(.is-closing) .tv-overlay__panel');
        const shown = el => !!el && !el.hidden && getComputedStyle(el).display !== 'none';
        const asking = () => [...(top()?.querySelectorAll('.tv-form__buttons') ?? [])].find(r => shown(r.querySelector('.tv-form__ask')));
        const editorOf = el => el.cmTile?.view ?? el.cmView?.rootView?.view;
        const shape = async () => {
            await until(() => asking());
            await sleep(100);
            const row = asking();
            const at = sel => row.querySelector(sel).getBoundingClientRect();
            const box = row.getBoundingClientRect(), ask = at('.tv-form__ask'), discard = at('.tv-form__discard'), back = at('.tv-form__cancel'), act = at('.mod-cta');
            const out = {
                width: innerWidth,
                ask: row.querySelector('.tv-form__ask').textContent, discard: row.querySelector('.tv-form__discard').textContent, act: row.querySelector('.mod-cta').textContent,
                askBottom: ask.bottom - discard.top, tops: [back.top - discard.top, act.top - discard.top],
                fromStart: discard.left - box.left, toEnd: box.right - act.right,
            };
            row.querySelector('.tv-form__discard').click();
            await until(() => !document.querySelector('.tv-overlay'));
            return out;
        };
        const win = require('electron').remote.getCurrentWindow();
        const bounds = win.getBounds();
        const was = innerWidth;
        win.setBounds({ ...bounds, width: ${width} + (bounds.width - innerWidth) });
        await until(() => innerWidth === ${width}, 3000, () => 'the window is ' + innerWidth + ' wide');
        const out = {};
        try {
            const task = rowOf('行');

            plugin.openDraftHub({ kind: 'childOf', taskId: task.id }, {});
            await until(() => top()?.querySelector('.tv-form__name-section input'));
            const name = top().querySelector('.tv-form__name-section input');
            name.value = '捨てる子';
            name.dispatchEvent(new Event('input', { bubbles: true }));
            top().querySelector('.tv-overlay__close').click();
            out.hub = await shape();

            plugin.openTaskHub(task.id);
            await until(() => top()?.querySelector('.task-hub__mode-toggle button'));
            top().querySelectorAll('.task-hub__mode-toggle button')[1].click();
            await until(() => top().querySelector('.tv-source-editor__children .cm-content'));
            const children = editorOf(top().querySelector('.tv-source-editor__children .cm-content'));
            children.dispatch({ changes: { from: children.state.doc.length, insert: '2' } });
            top().querySelector('.tv-overlay__close').click();
            out.source = await shape();

            await plugin.taskHub.cards.menuHandler.showContextMenu(0, 0, task);
            menuItem(one => one.titleEl?.textContent === ${JSON.stringify(tr('menu.sendToNote'))});
            // The hub opens in the move of the row; a change of the name is held in its draft.
            await until(() => top()?.querySelectorAll('.task-hub__place input').length === 2 && top().querySelector('.tv-form__name-section input'));
            const moved = top().querySelector('.tv-form__name-section input');
            moved.focus();
            moved.value = '行2';
            moved.dispatchEvent(new Event('input', { bubbles: true }));
            top().querySelector('.tv-overlay__close').click();
            out.move = await shape();
        } finally {
            win.setBounds(bounds);
            await until(() => innerWidth === was);
        }
        return JSON.stringify(out);
    `);

    it.each(WIDTHS)('stands the question on a line of its own, discard at the start of the next and back and the act at its end, in the hub, its source mode and its move (window %ipx wide)', async (width) => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = shapes(width);
        expect(Object.keys(seen)).toEqual(['hub', 'source', 'move']);
        expect(seen.hub).toMatchObject({ width, ask: tr('modal.newTask.discardAsk'), discard: tr('modal.hub.unsavedDiscard'), act: tr('modal.create') });
        expect(seen.source).toMatchObject({ width, ask: tr('modal.draft.discardAsk'), discard: tr('modal.draft.discard') });
        expect(seen.move).toMatchObject({ width, ask: tr('modal.hub.move.discardAsk'), discard: tr('modal.hub.unsavedDiscard'), act: tr('modal.send.send') });
        for (const [form, shape] of Object.entries(seen)) {
            // The question ends above the line of buttons, discard first on that line, back and the act last.
            expect(shape.askBottom, form).toBeLessThanOrEqual(0);
            for (const top of shape.tops) expect(Math.abs(top), form).toBeLessThanOrEqual(0.5);
            expect(Math.abs(shape.fromStart), form).toBeLessThanOrEqual(0.5);
            expect(Math.abs(shape.toEnd), form).toBeLessThanOrEqual(0.5);
        }
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
    });
});
