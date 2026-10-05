/**
 * The create dialog and the editor's line menu (段10e), in the running Dev
 * vault.
 *
 * - The dialog is opened as a user opens it: from a Timeline's all-day empty
 *   space ("Create task", on the daily note of that day) and from a card's
 *   menu ("Add child task"). It says where the line goes, its placeholders
 *   show what a line there inherits and nothing else, a time with no date
 *   is said to want a date where the place gives none (論点1), and a write
 *   refused keeps it open with why above its buttons and no notice.
 * - The editor's line button: a tv-inline task has the task's menu, a Tasks
 *   task none, and a checkbox in a note the views do not read the checkbox's
 *   menu, which has no Convert to Inline.
 *
 * The notes' bytes are read back from the disk. The daily note is of a day
 * far off (2031-01-15), made by the test and deleted after.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open,
 *     its daily notes at the vault's root as YYYY-MM-DD, with no template
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/forms/create-dialog.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import { overrideSettings, tr, type HeldSettings } from '../helpers/view-helper';

const DAY = '2031-01-15';
const DAILY = `${DAY}.md`;
const CHILD_FILE = 'test-int-create.md';
const MENU_FILE = 'test-int-linemenu.md';
const IGNORED_FILE = 'test-int-linemenu-ignored.md';

/** The daily note: the frontmatter gives a due, the section a start time. */
const DAILY_NOTE = [
    '---',
    'tv-due: "2031-01-20"',
    '---',
    '## Tasks',
    '- tv-start:: 09:00',
    '- [ ] 既存',
    '',
].join('\n');

/** The parent's section gives a start date. */
const CHILD_NOTE = [
    '## Work',
    '- tv-start:: 2031-02-01',
    '- [ ] 親',
    '',
].join('\n');

const MENU_NOTE = [
    '- [ ] インライン @2031-01-15',
    '- [ ] タスクス 📅 2031-01-15',
    '',
].join('\n');

const IGNORED_NOTE = [
    '---',
    'tv-ignore: true',
    '---',
    '- [ ] 範囲外',
    '',
].join('\n');

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
const R = (window.__tvCreateE2E ??= {});
const shown = el => !!el && getComputedStyle(el).display !== 'none';
/** The create dialog's panel: a dialog with a name section that is not the hub's. */
const panel = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__panel--dialog')]
    .find(p => !p.classList.contains('task-hub') && p.querySelector('.tv-form__name-section')) ?? null;
const nameInput = () => panel()?.querySelector('.tv-form__name-section input') ?? null;
const rowOf = label => [...panel().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === label);
const dateInput = (label, which) => rowOf(label).querySelector('.tv-form__field--' + which + ' input.tv-ctrl__text-input');
const says = input => [...input.closest('.tv-form__row').nextElementSibling.children].map(c => c.className + ': ' + c.textContent);
const type = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true })); input.dispatchEvent(new FocusEvent('blur')); };
const dialog = () => {
    const p = panel();
    if (!p) return null;
    const field = (label, which) => ({ value: dateInput(label, which).value, placeholder: dateInput(label, which).placeholder });
    return {
        start: { date: field(${JSON.stringify(tr('modal.start'))}, 'date'), time: field(${JSON.stringify(tr('modal.start'))}, 'time') },
        due: { date: field(${JSON.stringify(tr('modal.due'))}, 'date'), time: field(${JSON.stringify(tr('modal.due'))}, 'time') },
        form: [...p.querySelector('.tv-form__says--form').children].map(c => c.className + ': ' + c.textContent),
        buttons: [...p.querySelectorAll('.tv-form__buttons button')].filter(shown).map(b => b.textContent),
    };
};
const create = () => [...panel().querySelectorAll('.tv-form__buttons button')].find(b => b.classList.contains('mod-cta')).click();
const notices = () => document.querySelectorAll('.notice').length;
const disk = path => app.vault.adapter.read(path);
const menuTitles = () => (plugin.menuPresenter.currentMenu?.items ?? []).map(i => i.titleEl?.textContent ?? '').filter(Boolean);
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

interface DialogView {
    start: { date: { value: string; placeholder: string }; time: { value: string; placeholder: string } };
    due: { date: { value: string; placeholder: string }; time: { value: string; placeholder: string } };
    form: string[];
    buttons: string[];
}

/** Close every overlay and menu, and the leaves the tests opened. */
function cleanUp(): void {
    run(`
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
        plugin.menuPresenter.dismiss();
        for (const name of Object.keys(R)) { R[name]?.detach(); delete R[name]; }
        await sleep(250);
        return 'ok';
    `);
}

const INFO = 'tv-form__info';
const WARNING = 'tv-form__warning';
const ERROR = 'tv-form__error';

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    // Focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
    const there = run<boolean>(`return JSON.stringify(!!app.vault.getAbstractFileByPath(${JSON.stringify(DAILY)}));`);
    if (there) throw new Error(`${DAILY} is in the Dev vault: the test makes and deletes it, so it does not run over one.`);
});

afterEach(() => { cleanUp(); });

afterAll(async () => {
    for (const file of [DAILY, CHILD_FILE, MENU_FILE, IGNORED_FILE]) {
        deleteTestFile(file);
        await waitForFileDeindexed(file);
    }
});

describe('the create dialog on a daily note (a Timeline\'s all-day empty space)', () => {
    /** Open a Timeline on DAY and choose Create task in its all-day empty space. */
    const OPEN = `
        const leaf = app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: 'timeline-view', state: { date: ${JSON.stringify(DAY)} }, active: true });
        R.tl = leaf;
        let cell = null;
        await until(() => (cell = leaf.view.contentEl.querySelector('.allday-section__cell[data-date="${DAY}"]')));
        cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
        await until(() => menuTitles().length > 0);
        const item = plugin.menuPresenter.currentMenu.items.find(i => i.titleEl?.textContent === ${JSON.stringify(tr('menu.createTaskForDailyNote'))});
        if (!item) throw new Error('no create in ' + menuTitles().join('|'));
        plugin.menuPresenter.dismiss();
        item.callback(new MouseEvent('click'));
        await until(() => nameInput() && document.activeElement === nameInput());
        await until(() => dialog().form.length > 0);
    `;

    it('shows what a line there inherits, wants a date for a time where none is given, and says a refused write inside', async () => {
        await writeIndexedTestFile(DAILY, DAILY_NOTE);
        const steps = run<Record<string, unknown>>(`
            ${OPEN}
            const out = { opened: dialog() };
            const before = notices();

            // The start's date taken away, a time left: the note's day is no start (論点1).
            type(nameInput(), '電話');
            type(dateInput(${JSON.stringify(tr('modal.start'))}, 'date'), '');
            type(dateInput(${JSON.stringify(tr('modal.start'))}, 'time'), '10:00');
            create();
            await sleep(500);
            out.timeOnly = { open: !!panel(), says: says(dateInput(${JSON.stringify(tr('modal.start'))}, 'time')), disk: await disk(${JSON.stringify(DAILY)}) };

            // The date back, and the disk refusing the next write once.
            type(dateInput(${JSON.stringify(tr('modal.start'))}, 'date'), ${JSON.stringify(DAY)});
            const real = app.vault.process;
            app.vault.process = async function () { app.vault.process = real; throw new Error('e2e: the disk refused'); };
            try {
                create();
                await sleep(800);
                out.refused = { open: !!panel(), name: nameInput()?.value, view: dialog(), notices: notices() - before, disk: await disk(${JSON.stringify(DAILY)}) };
                create();
                await until(() => !panel());
                await sleep(300);
                out.written = { open: !!panel(), notices: notices() - before, disk: await disk(${JSON.stringify(DAILY)}) };
            } finally {
                app.vault.process = real;
            }
            return JSON.stringify(out);
        `);

        const placed = `${INFO}: ${tr('modal.newTask.toHead', { note: DAILY, heading: 'Tasks' })}`;
        // The day clicked is the start's date; the section's time and the frontmatter's due are placeholders.
        expect(steps.opened).toEqual({
            start: { date: { value: DAY, placeholder: 'YYYY-MM-DD' }, time: { value: '', placeholder: '09:00' } },
            due: { date: { value: '', placeholder: '2031-01-20' }, time: { value: '', placeholder: 'HH:mm' } },
            form: [placed],
            buttons: [tr('modal.cancel'), tr('modal.create')],
        });
        expect(steps.timeOnly).toEqual({ open: true, says: [`${ERROR}: ${tr('validation.startRequiresDate')}`], disk: DAILY_NOTE });
        const refused = steps.refused as { open: boolean; name: string; view: DialogView; notices: number; disk: string };
        expect(refused).toMatchObject({ open: true, name: '電話', notices: 0, disk: DAILY_NOTE });
        expect(refused.view.form).toEqual([placed, `${ERROR}: ${tr('notice.notWritten', { reason: tr('notice.refusedFailed'), subject: `- [ ] 電話 @${DAY}T10:00` })}`]);
        expect(steps.written).toEqual({
            open: false,
            notices: 0,
            disk: DAILY_NOTE.replace('- tv-start:: 09:00\n', `- tv-start:: 09:00\n- [ ] 電話 @${DAY}T10:00\n`),
        });
    });
});

describe('the create dialog under a row (a card\'s menu, Add child task)', () => {
    it('shows the start date the parent\'s section gives, and takes a time with no date there', async () => {
        await writeIndexedTestFile(CHILD_FILE, CHILD_NOTE);
        const steps = run<Record<string, unknown>>(`
            const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(CHILD_FILE)} && t.content === '親');
            if (!task) throw new Error('no row 親');
            // The card menu the hub's cards open, made as a hub first opens.
            if (!plugin.taskHub.cards) {
                plugin.openTaskHub(task.id);
                await until(() => document.querySelector('.tv-overlay:not(.is-closing) .task-hub'));
                document.querySelector('.tv-overlay:not(.is-closing) .task-hub').closest('.tv-overlay__panel').querySelector('.tv-overlay__close').click();
                await until(() => !document.querySelector('.tv-overlay:not(.is-closing) .task-hub'));
            }
            await plugin.taskHub.cards.menuHandler.showContextMenu(0, 0, task);
            const item = plugin.menuPresenter.currentMenu.items.find(i => i.titleEl?.textContent === ${JSON.stringify(tr('menu.addChildTask'))});
            plugin.menuPresenter.dismiss();
            item.callback(new MouseEvent('click'));
            await until(() => nameInput() && document.activeElement === nameInput());
            await until(() => dialog().form.length > 0);
            const out = { opened: dialog() };
            type(nameInput(), '子');
            type(dateInput(${JSON.stringify(tr('modal.start'))}, 'time'), '10:00');
            create();
            await until(() => !panel());
            await sleep(300);
            out.disk = await disk(${JSON.stringify(CHILD_FILE)});
            return JSON.stringify(out);
        `);
        expect(steps.opened).toMatchObject({
            start: { date: { value: '', placeholder: '2031-02-01' } },
            form: [`${INFO}: ${tr('modal.newTask.toChild', { parent: '親' })}`],
        });
        // Indented as Obsidian's settings say (a tab in the Dev vault).
        expect(steps.disk).toMatch(/^## Work\n- tv-start:: 2031-02-01\n- \[ \] 親\n(\t| {4})- \[ \] 子 @10:00\n$/);
    });
});

describe('the editor\'s line button', () => {
    let held: HeldSettings<'enableTasksPlugin' | 'editorMenuForTasks' | 'editorMenuForCheckboxes'> | undefined;
    afterAll(() => { held?.restore(); });

    it('a tv-inline task has the task\'s menu, a Tasks task none, a checkbox out of the read range the checkbox\'s', async () => {
        held = overrideSettings({ enableTasksPlugin: true, editorMenuForTasks: true, editorMenuForCheckboxes: true });
        await writeIndexedTestFile(MENU_FILE, MENU_NOTE);
        await writeIndexedTestFile(IGNORED_FILE, IGNORED_NOTE);
        const steps = run<Record<string, unknown>>(`
            const open = async (path, name) => {
                const leaf = app.workspace.getLeaf('tab');
                await leaf.openFile(app.vault.getAbstractFileByPath(path), { state: { mode: 'source', source: true } });
                R[name] = leaf;
                await sleep(800);
                return leaf;
            };
            /** Each line's text, and whether a button stands at its end. */
            const lines = leaf => [...leaf.view.contentEl.querySelectorAll('.cm-line')]
                .filter(l => l.textContent.includes('[ ]') || l.querySelector('.task-list-item-checkbox') || l.textContent.trim())
                .map(l => ({ text: l.textContent.replace(/\\s+$/, ''), button: !!l.querySelector('.tv-editor-menu-btn') }));
            const press = async (leaf, text) => {
                const line = [...leaf.view.contentEl.querySelectorAll('.cm-line')].find(l => l.textContent.includes(text));
                line.querySelector('.tv-editor-menu-btn').click();
                await until(() => menuTitles().length > 0);
                const titles = menuTitles();
                plugin.menuPresenter.dismiss();
                await sleep(100);
                return titles;
            };
            const read = await open(${JSON.stringify(MENU_FILE)}, 'menu');
            const ignored = await open(${JSON.stringify(IGNORED_FILE)}, 'ignored');
            return JSON.stringify({
                read: lines(read),
                ignored: lines(ignored),
                taskMenu: await press(read, 'インライン'),
                checkboxMenu: await press(ignored, '範囲外'),
                parsers: plugin.getIndex().getTasks().filter(t => t.file === ${JSON.stringify(MENU_FILE)}).map(t => t.parserId),
            });
        `);
        const buttonOf = (rows: unknown, text: string) => (rows as { text: string; button: boolean }[]).find(row => row.text.includes(text))?.button;
        expect(steps.parsers).toEqual(['tv-inline', 'tasks-plugin']);
        expect(buttonOf(steps.read, 'インライン')).toBe(true);
        expect(buttonOf(steps.read, 'タスクス')).toBe(false);
        expect(buttonOf(steps.ignored, '範囲外')).toBe(true);
        expect(steps.taskMenu).toContain(tr('menu.addChildTask'));
        expect(steps.checkboxMenu).toEqual([
            expect.stringContaining('[ ]'),
            tr('menu.duplicate'),
            tr('menu.deleteTask'),
        ]);
    });
});
