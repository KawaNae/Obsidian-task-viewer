/**
 * The questions put to the user (段10b), in the running Dev vault: the
 * delete's confirmation, a flow's three ways to delete, and a timer's three
 * ways to start on a completed task stand on OverlayShell (`askChoice`),
 * open with the focus on cancel, and answer once: the button pressed, or
 * cancel however else they close (Escape, the close button, a press
 * outside). The timer's Custom... length (`askText`) says under its field
 * what does not read, stays open, and closes on a value that does.
 *
 * The delete is chosen from a card's menu, as a user chooses it; the timer
 * is started on the completed row as its menu starts it. The note's bytes
 * are read back from the disk.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open,
 *     with a build that has the questions of modals/ask
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/forms/ask-dialogs.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import { closeViews, openView, readSettings, saveSettings, tr } from '../helpers/view-helper';

const TEST_FILE = 'test-int-ask-dialogs.md';

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
const rowOf = name => {
    const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(name));
    if (!task) throw new Error('no row ' + name);
    return task;
};
const askPanel = () => document.querySelector('.tv-overlay:not(.is-closing) .tv-overlay__panel.tv-ask');
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
    const menu = plugin.menuPresenter.currentMenu;
    const item = menu?.items.find(one => one.titleEl?.textContent === title);
    if (!item) throw new Error('no ' + title + ' in the menu');
    menu.hide();
    item.callback(new MouseEvent('click'));
    await until(() => askPanel() && askPanel().contains(document.activeElement));
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
            await until(() => askPanel() && askPanel().contains(document.activeElement));
            const opened = askState();
            ${how};
            await closed();
            const started = widget.board.values().find(t => !before.has(t.id)) ?? null;
            const mode = started?.mode ?? null;
            if (started) {
                await until(() => started.tail && !started.opening);
                widget.lifecycle.close(started, true);
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
            await until(() => askPanel() && askPanel().contains(document.activeElement));
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
            type('30');
            enter(input());
            out.thirty = await closed();
            return JSON.stringify(out);
        `);
        expect(steps.opened).toMatchObject({ open: true, title: tr('timer.workDuration'), focus: 'input', value: '25', selected: true, says: null });
        expect(steps.zero).toMatchObject({ open: true, says: tr('issue.rangeBetween', { min: 1, max: 120 }) });
        expect(steps.typing).toMatchObject({ open: true, says: null });
        expect(steps.abc).toMatchObject({ open: true, says: tr('issue.shape.int') });
        expect(steps.thirty).toEqual({ open: false });
        expect(readSettings(KEYS)).toEqual({ pomodoroWorkMinutes: 30 });
    });
});
