/**
 * Where the hub on a task not written yet is opened from, in the running E2E
 * vault, each as a user opens it:
 *
 * - a Timeline's timed lane, its empty space's Create task: on the daily
 *   note of the column's day, the time pressed the start's time;
 * - a Timeline's all-day lane, the same: the day alone;
 * - a view's card, its menu's Add child task: under the card's row;
 * - the editor's line button, its menu's Add child task: under the line's
 *   row.
 *
 * Each opens the hub with the focus on its name and says where the line
 * goes. Closed with nothing given, it writes nothing and makes no daily
 * note. The day is far off (2031-01-21) and its daily note is not made.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open,
 *     its daily notes at the vault's root as YYYY-MM-DD, with no template
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/draft-entries.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { overrideSettings, tr, type HeldSettings } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';

const DAY = '2031-01-21';
const DAILY = `${DAY}.md`;
const TEST_FILE = 'test-int-draft-entries.md';

const NOTE = [
    '# 見出し',
    `- [ ] 親 @${DAY}`,
    '',
].join('\n');

const PRELUDE = `
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
const R = (window.__tvDraftEntriesE2E ??= {});
const shown = el => !!el && getComputedStyle(el).display !== 'none';
const overlays = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing)')];
const draft = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing) .task-hub')]
    .find(p => p.querySelector('.task-hub__form > .tv-form__buttons > .mod-cta')) ?? null;
const nameInput = () => draft()?.querySelector('.tv-form__name-section input') ?? null;
const rowOf = label => [...draft().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === label);
const start = which => rowOf(${JSON.stringify(tr('modal.start'))}).querySelector('.tv-form__field--' + which + ' input.tv-ctrl__text-input').value;
const formSays = () => [...draft().querySelector('.tv-form__says--form').children].map(c => c.className + ': ' + c.textContent);
const menuTitles = () => (plugin.menuPresenter.currentMenu?.items ?? []).map(i => i.titleEl?.textContent ?? '').filter(Boolean);
/** Pick the item titled so in the menu open now (on macOS the menu may be the native one, outside the DOM). */
const pick = async title => {
    await until(() => menuTitles().includes(title), 3000, () => menuTitles().join('|'));
    const item = plugin.menuPresenter.currentMenu.items.find(i => i.titleEl?.textContent === title);
    plugin.menuPresenter.dismiss();
    item.callback(new MouseEvent('click'));
};
/** Wait for the hub opened, its focus on the name and its place said; what it holds. */
const opened = async () => {
    await until(() => nameInput() && document.activeElement === nameInput());
    await until(() => formSays().length > 0);
    return { start: { date: start('date'), time: start('time') }, form: formSays() };
};
/** A Timeline on DAY, its leaf kept to be closed after. */
const timeline = async () => {
    const leaf = app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: 'timeline-view', state: { date: ${JSON.stringify(DAY)} }, active: true });
    R.tl = leaf;
    return leaf;
};
const press = el => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
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

interface Opened {
    start: { date: string; time: string };
    form: string[];
}

/**
 * Close the hub as a user would, with nothing given (it asks nothing), then
 * the menu and the leaves the test opened; whether the hub closed.
 */
function closeAll(): boolean {
    return run<boolean>(`
        const closed = !draft() || await (async () => {
            draft().closest('.tv-overlay').querySelector('.tv-overlay__close').click();
            await until(() => !draft());
            return true;
        })();
        for (let i = 0; i < 6 && overlays().length > 0; i++) {
            const top = overlays().pop();
            const discard = () => [...top.querySelectorAll('.tv-form__discard')].find(shown);
            if (discard()) discard().click();
            else top.querySelector('.tv-overlay__close').click();
            await until(() => !overlays().includes(top) || discard());
        }
        plugin.menuPresenter.dismiss();
        for (const name of Object.keys(R)) { R[name]?.detach(); delete R[name]; }
        return JSON.stringify(closed);
    `);
}

let held: HeldSettings<'editorMenuForTasks'> | undefined;

beforeAll(() => {
    // Focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
    const there = run<boolean>(`return JSON.stringify(!!app.vault.getAbstractFileByPath(${JSON.stringify(DAILY)}));`);
    if (there) throw new Error(`${DAILY} is in the E2E vault: the test makes none, and checks there is none after.`);
});

afterEach(() => {
    expect(closeAll()).toBe(true);
    expect(run<boolean>(`return JSON.stringify(!!app.vault.getAbstractFileByPath(${JSON.stringify(DAILY)}));`)).toBe(false);
});

afterAll(async () => {
    held?.restore();
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('the hub on a task not written yet opens from', () => {
    it('a Timeline\'s timed lane: the column\'s daily note, the time pressed', () => {
        const steps = run<Record<string, unknown>>(`
            const leaf = await timeline();
            let col = null;
            await until(() => (col = leaf.view.contentEl.querySelector('.timeline-scroll-area__day-column[data-date="${DAY}"]')));
            // Five hours after the lane's start, a pixel down: rounded to that hour.
            const hour = parseFloat(getComputedStyle(col).getPropertyValue('--hour-height'));
            const startHour = plugin.settings.startHour;
            const r = col.getBoundingClientRect();
            col.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + hour * 5 + 1 }));
            await pick(${JSON.stringify(tr('menu.createTaskForDailyNote'))});
            return JSON.stringify({ opened: await opened(), expected: String((startHour + 5) % 24).padStart(2, '0') + ':00' });
        `);
        expect(steps.opened).toEqual({
            start: { date: DAY, time: steps.expected },
            form: [`tv-form__info: ${tr('modal.newTask.toNew', { note: DAILY, heading: 'Tasks' })}`],
        });
    });

    it('a Timeline\'s all-day lane: the column\'s daily note, the day alone', () => {
        const steps = run<Opened>(`
            const leaf = await timeline();
            let cell = null;
            await until(() => (cell = leaf.view.contentEl.querySelector('.allday-section__cell[data-date="${DAY}"]')));
            press(cell);
            await pick(${JSON.stringify(tr('menu.createTaskForDailyNote'))});
            return JSON.stringify(await opened());
        `);
        expect(steps).toEqual({
            start: { date: DAY, time: '' },
            form: [`tv-form__info: ${tr('modal.newTask.toNew', { note: DAILY, heading: 'Tasks' })}`],
        });
    });

    it('a view\'s card, its menu\'s Add child task: under the card\'s row', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const steps = run<Opened>(`
            const leaf = await timeline();
            const card = () => [...leaf.view.contentEl.querySelectorAll('.task-card')].find(c => c.textContent.includes('親'));
            await until(() => card());
            press(card());
            await pick(${JSON.stringify(tr('menu.addChildTask'))});
            return JSON.stringify(await opened());
        `);
        expect(steps.form).toEqual([`tv-form__info: ${tr('modal.newTask.toChild', { parent: '親' })}`]);
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
    });

    it('the editor\'s line button, its menu\'s Add child task: under the line\'s row', async () => {
        held = overrideSettings({ editorMenuForTasks: true });
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const steps = run<Opened>(`
            const leaf = app.workspace.getLeaf('tab');
            await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(TEST_FILE)}), { state: { mode: 'source', source: true } });
            R.note = leaf;
            const button = () => [...leaf.view.contentEl.querySelectorAll('.cm-line')].find(l => l.textContent.includes('親'))?.querySelector('.tv-editor-menu-btn');
            await until(() => button());
            button().click();
            await pick(${JSON.stringify(tr('menu.addChildTask'))});
            return JSON.stringify(await opened());
        `);
        expect(steps.form).toEqual([`tv-form__info: ${tr('modal.newTask.toChild', { parent: '親' })}`]);
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
    });
});
