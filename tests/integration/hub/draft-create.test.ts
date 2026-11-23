/**
 * The hub on a task not written yet, and its create, in the running E2E
 * vault.
 *
 * - On a daily note, opened as a user opens it from a Timeline's all-day
 *   empty space ("Create task", on the daily note of that day): the day is
 *   the start's date, its placeholders show what a line there inherits, it
 *   says where the line goes at the form's end, it is titled as the task it
 *   creates, and its buttons are cancel and the create. A time with no date is said to want a date where the place gives
 *   none, and a write refused keeps it open with why at the form's end and
 *   no notice. It warns of a note the views do not read, and offers no
 *   create where the note's heading is written twice.
 * - Under a row, opened from a card's menu ("Add child task"): it says
 *   whose child the task is, shows what the parent's section gives (the
 *   start date, a tag, a color, a property) with where it is from, a label
 *   that opens nothing; a time with no date is taken there, and the child
 *   goes first among the parent's children, indented as Obsidian's settings
 *   say.
 * - The create: nothing is written while the fields are edited; the create
 *   writes the task's line and its property lines with one write, and the
 *   index reads back the values given. A task with no name is written as
 *   `- [ ] `, its card showing the link to its note before it is made. A
 *   value typed that does not read keeps it from being made, and takes the
 *   focus.
 * - Its card is one nothing is done on: a press on it, its checkbox or its
 *   link opens no menu, changes no status and opens no note.
 * - The name's list offers the vault's notes on a daily note not made yet.
 *
 * A check that something did not happen reads the state in the CLI call
 * after the one that pressed, so what the press would have set going has
 * had that time to come. The notes' bytes are read back from the disk.
 * The daily notes are of days far off (2031-01), made by the test or not
 * at all, and deleted after.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open,
 *     its daily notes at the vault's root as YYYY-MM-DD, with no template
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/draft-create.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile, writeTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { DIALOG_ROWS } from '../helpers/dialog-rows';

const DAY = '2031-01-15';
const DAILY = `${DAY}.md`;
/** A daily note not made: the test makes nothing there. */
const NEW_DAY = '2031-01-16';
const IGNORED_DAILY = '2031-01-17.md';
const TWICE_DAILY = '2031-01-18.md';
const CHILD_FILE = 'test-int-draft-child.md';
const MAKE_FILE = 'test-int-draft-make.md';

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

const IGNORED_NOTE = [
    '---',
    'tv-ignore: true',
    '---',
    '## Tasks',
    '',
].join('\n');

const TWICE_NOTE = [
    '## Tasks',
    '- [ ] 一',
    '## Tasks',
    '- [ ] 二',
    '',
].join('\n');

/** The parent's section gives a start date, a tag, a color and a property. */
const CHILD_NOTE = [
    '## Work',
    '- tv-start:: 2031-02-01',
    '- tv-color:: red',
    '- tags:: #sec',
    '- area:: lab',
    '- [ ] 親',
    '',
].join('\n');

/** A parent whose section gives nothing. */
const MAKE_NOTE = [
    '# 見出し',
    '- [ ] 親',
    '- [ ] 次',
    '',
].join('\n');

const PRELUDE = `
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
${DIALOG_ROWS}
const R = (window.__tvDraftE2E ??= { leaves: {} });
const shown = el => !!el && getComputedStyle(el).display !== 'none';
const overlays = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing)')];
/** The hub on a task not written yet: the hub that offers a create. */
const draft = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing) .task-hub')]
    .find(p => formRow(p)?.querySelector(':scope > .mod-cta')) ?? null;
const nameInput = () => draft()?.querySelector('.tv-form__name-section input') ?? null;
const rowOf = label => [...draft().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === label);
const dateInput = (label, which) => rowOf(label).querySelector('.tv-form__field--' + which + ' input.tv-ctrl__text-input');
const colorInput = () => draft().querySelector('.tv-form__input-with-picker--color input.tv-ctrl__text-input');
const tagInput = () => draft().querySelector('.task-hub__tag-add-wrap input');
const keyInput = () => draft().querySelector('.task-hub__prop-add .tv-form__label input');
const valueInput = () => draft().querySelector('.task-hub__prop-add input.tv-form__control');
const says = input => [...input.closest('.tv-form__row').nextElementSibling.children].map(c => c.className + ': ' + c.textContent);
/** Typed as a person types: the text, then its input event. Not left. */
const typeIn = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
/** Typed and left: the field commits. */
const type = (input, text) => { typeIn(input, text); input.dispatchEvent(new FocusEvent('blur')); };
const formSays = () => [...draft().querySelector('.tv-form__says--form').children].map(c => c.className + ': ' + c.textContent);
const view = () => {
    const p = draft();
    if (!p) return null;
    const field = (label, which) => ({ value: dateInput(label, which).value, placeholder: dateInput(label, which).placeholder });
    return {
        start: { date: field(${JSON.stringify(tr('modal.start'))}, 'date'), time: field(${JSON.stringify(tr('modal.start'))}, 'time') },
        due: { date: field(${JSON.stringify(tr('modal.due'))}, 'date'), time: field(${JSON.stringify(tr('modal.due'))}, 'time') },
        form: formSays(),
        buttons: [...formRow(p).querySelectorAll('button')].filter(shown).map(b => b.textContent),
        titles: [...p.querySelectorAll('h2')].map(h => h.textContent),
    };
};
const createButton = () => formRow(draft()).querySelector(':scope > .mod-cta');
const create = () => createButton().click();
const card = () => draft()?.querySelector('.task-hub__preview .task-card') ?? null;
const notices = () => document.querySelectorAll('.notice').length;
const disk = path => app.vault.adapter.read(path);
const menuTitles = () => (plugin.menuPresenter.currentMenu?.items ?? []).map(i => i.titleEl?.textContent ?? '').filter(Boolean);
/** Pick the item titled so in the menu open now (on macOS the menu may be the native one, outside the DOM). */
const pick = async title => {
    await until(() => menuTitles().includes(title), 3000, () => menuTitles().join('|'));
    const item = plugin.menuPresenter.currentMenu.items.find(i => i.titleEl?.textContent === title);
    plugin.menuPresenter.dismiss();
    item.callback(new MouseEvent('click'));
};
const rowTask = (file, name) => {
    const task = plugin.getIndex().getTasks().find(t => t.file === file && t.content === name);
    if (!task) throw new Error('no row ' + name);
    return task;
};
/** Open the hub on a task not written yet, as the child of the row named, and wait for the place to answer. */
const openChild = async (file, name) => {
    plugin.openDraftHub({ kind: 'childOf', taskId: rowTask(file, name).id }, {});
    await until(() => nameInput() && document.activeElement === nameInput());
    await until(() => formSays().length > 0);
};
/**
 * Record each write to the note at \`path\`: what each \`vault.process\` made of
 * it, and how many times the vault said it was modified.
 */
const watchWrites = path => {
    const real = app.vault.process;
    const seen = { written: [], modified: 0 };
    app.vault.process = function (file, fn, options) {
        return real.call(this, file, data => {
            const out = fn(data);
            if (file.path === path) seen.written.push(out);
            return out;
        }, options);
    };
    const ref = app.vault.on('modify', file => { if (file.path === path) seen.modified++; });
    R.unwatch = () => { app.vault.process = real; app.vault.offref(ref); delete R.unwatch; };
    R.seen = seen;
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

interface DialogView {
    start: { date: { value: string; placeholder: string }; time: { value: string; placeholder: string } };
    due: { date: { value: string; placeholder: string }; time: { value: string; placeholder: string } };
    form: string[];
    buttons: string[];
    titles: string[];
}

/**
 * Close every overlay, throwing away what a hub asks about, then the menu,
 * the leaves the tests opened, and the watch on the writes.
 */
function cleanUp(): void {
    run(`
        R.unwatch?.();
        for (let i = 0; i < 6 && overlays().length > 0; i++) {
            const top = overlays().pop();
            const discard = () => [...top.querySelectorAll('.tv-form__discard')].find(shown);
            if (discard()) discard().click();
            else top.querySelector('.tv-overlay__close').click();
            await until(() => !overlays().includes(top) || discard());
        }
        plugin.menuPresenter.dismiss();
        for (const name of Object.keys(R.leaves)) { R.leaves[name]?.detach(); delete R.leaves[name]; }
        return 'ok';
    `);
}

const INFO = 'tv-form__info';
const WARNING = 'tv-form__warning';
const ERROR = 'tv-form__error';

beforeAll(() => {
    // Focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
    const days = [DAILY, `${NEW_DAY}.md`, IGNORED_DAILY, TWICE_DAILY];
    const there = run<string[]>(`return JSON.stringify(${JSON.stringify(days)}.filter(p => app.vault.getAbstractFileByPath(p)));`);
    if (there.length > 0) throw new Error(`${there.join(', ')} in the E2E vault: the test makes and deletes them, so it does not run over one.`);
});

afterEach(() => { cleanUp(); });

afterAll(async () => {
    for (const file of [DAILY, `${NEW_DAY}.md`, IGNORED_DAILY, TWICE_DAILY, CHILD_FILE, MAKE_FILE]) {
        deleteTestFile(file);
        await waitForFileDeindexed(file);
    }
});

describe('the hub on a task not written yet, on a daily note (a Timeline\'s all-day empty space)', () => {
    /** Open a Timeline on DAY and choose Create task in its all-day empty space. */
    const OPEN = `
        const leaf = app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: 'timeline-view', state: { date: ${JSON.stringify(DAY)} }, active: true });
        R.leaves.tl = leaf;
        let cell = null;
        await until(() => (cell = leaf.view.contentEl.querySelector('.allday-section__cell[data-date="${DAY}"]')));
        cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
        await pick(${JSON.stringify(tr('menu.createTaskForDailyNote'))});
        await until(() => nameInput() && document.activeElement === nameInput());
        await until(() => formSays().length > 0);
    `;

    it('shows what a line there inherits, wants a date for a time where none is given, and says a refused write inside', async () => {
        await writeIndexedTestFile(DAILY, DAILY_NOTE);
        const steps = run<Record<string, unknown>>(`
            ${OPEN}
            const out = { opened: view() };
            const before = notices();
            const startTime = () => dateInput(${JSON.stringify(tr('modal.start'))}, 'time');

            // The start's date taken away, a time left: the note's day is no start.
            type(nameInput(), '電話');
            type(dateInput(${JSON.stringify(tr('modal.start'))}, 'date'), '');
            type(startTime(), '10:00');
            create();
            await until(() => says(startTime()).length > 0);
            out.timeOnly = { open: !!draft(), says: says(startTime()), focused: document.activeElement === startTime(), disk: await disk(${JSON.stringify(DAILY)}) };

            // The date back, and the disk refusing the next write once.
            type(dateInput(${JSON.stringify(tr('modal.start'))}, 'date'), ${JSON.stringify(DAY)});
            const real = app.vault.process;
            app.vault.process = async function () { app.vault.process = real; throw new Error('e2e: the disk refused'); };
            try {
                create();
                await until(() => formSays().some(s => s.startsWith(${JSON.stringify(ERROR)})) && !createButton().disabled);
                out.refused = { open: !!draft(), name: nameInput()?.value, view: view(), notices: notices() - before, disk: await disk(${JSON.stringify(DAILY)}) };
                create();
                await until(() => !draft());
                out.written = { open: !!draft(), notices: notices() - before, disk: await disk(${JSON.stringify(DAILY)}) };
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
            titles: [tr('modal.newTask.title')],
        });
        expect(steps.timeOnly).toEqual({ open: true, says: [`${ERROR}: ${tr('validation.startRequiresDate')}`], focused: true, disk: DAILY_NOTE });
        const refused = steps.refused as { open: boolean; name: string; view: DialogView; notices: number; disk: string };
        expect(refused).toMatchObject({ open: true, name: '電話', notices: 0, disk: DAILY_NOTE });
        expect(refused.view.form).toEqual([placed, `${ERROR}: ${tr('notice.notWritten', { reason: tr('notice.refusedFailed'), subject: `- [ ] 電話 @${DAY}T10:00` })}`]);
        expect(steps.written).toEqual({
            open: false,
            notices: 0,
            disk: DAILY_NOTE.replace('- tv-start:: 09:00\n', `- tv-start:: 09:00\n- [ ] 電話 @${DAY}T10:00\n`),
        });
    });

    it('warns of a note the views do not read, and offers no create where the note has its heading twice', async () => {
        writeTestFile(IGNORED_DAILY, IGNORED_NOTE);
        await writeIndexedTestFile(TWICE_DAILY, TWICE_NOTE);
        const steps = run<Record<string, unknown>>(`
            const open = async day => {
                plugin.openDraftHub({ kind: 'dailyNote', date: day }, { startDate: day });
                await until(() => nameInput() && formSays().length > 0);
            };
            const close = async () => {
                const p = draft();
                p.closest('.tv-overlay').querySelector('.tv-overlay__close').click();
                await until(() => !draft());
            };
            await until(() => app.vault.getAbstractFileByPath(${JSON.stringify(IGNORED_DAILY)}));
            await open(${JSON.stringify(IGNORED_DAILY.replace(/\.md$/, ''))});
            const ignored = { form: formSays(), offered: !createButton().disabled };
            await close();
            await open(${JSON.stringify(TWICE_DAILY.replace(/\.md$/, ''))});
            type(nameInput(), '三');
            create();
            return JSON.stringify({ ignored, twice: { form: formSays(), offered: !createButton().disabled } });
        `);
        const later = run<Record<string, unknown>>(`return JSON.stringify({ open: !!draft(), disk: await disk(${JSON.stringify(TWICE_DAILY)}) });`);
        expect(steps.ignored).toEqual({
            form: [
                `${INFO}: ${tr('modal.newTask.toHead', { note: IGNORED_DAILY, heading: 'Tasks' })}`,
                `${WARNING}: ${tr('modal.newTask.ignored', { note: IGNORED_DAILY })}`,
            ],
            offered: true,
        });
        expect(steps.twice).toEqual({
            form: [`${ERROR}: ${tr('modal.newTask.headings', { note: TWICE_DAILY, heading: 'Tasks', count: '2' })}`],
            offered: false,
        });
        expect(later).toEqual({ open: true, disk: TWICE_NOTE });
    });

    it('offers the vault\'s notes in the name\'s list on a daily note not made yet, and makes no note when it is thrown away', async () => {
        await writeIndexedTestFile(MAKE_FILE, MAKE_NOTE);
        const base = MAKE_FILE.replace(/\.md$/, '');
        const steps = run<Record<string, unknown>>(`
            plugin.openDraftHub({ kind: 'dailyNote', date: ${JSON.stringify(NEW_DAY)} }, { startDate: ${JSON.stringify(NEW_DAY)} });
            await until(() => nameInput() && document.activeElement === nameInput() && formSays().length > 0);
            const form = formSays();
            const input = nameInput();
            typeIn(input, '見る [[' + ${JSON.stringify(base.slice(0, -3))});
            input.setSelectionRange(input.value.length, input.value.length);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await until(() => [...document.querySelectorAll('.suggestion-container .suggestion-item')].some(el => el.textContent.includes(${JSON.stringify(base)})));
            const offered = [...document.querySelectorAll('.suggestion-container .suggestion-item')].some(el => el.textContent.includes(${JSON.stringify(base)}));
            return JSON.stringify({ form, offered });
        `);
        expect(steps).toEqual({
            form: [`${INFO}: ${tr('modal.newTask.toNew', { note: `${NEW_DAY}.md`, heading: 'Tasks' })}`],
            offered: true,
        });
        cleanUp();
        expect(run<boolean>(`return JSON.stringify(!app.vault.getAbstractFileByPath(${JSON.stringify(`${NEW_DAY}.md`)}));`)).toBe(true);
    });
});

describe('the hub on a task not written yet, under a row (a card\'s menu, Add child task)', () => {
    it('says whose child it is, shows what the parent\'s section gives with where it is from, and takes a time with no date there', async () => {
        await writeIndexedTestFile(CHILD_FILE, CHILD_NOTE);
        const steps = run<Record<string, unknown>>(`
            const task = rowTask(${JSON.stringify(CHILD_FILE)}, '親');
            // The card menu the hub's cards open, made as a hub first opens.
            if (!plugin.taskHub.cards) {
                plugin.openTaskHub(task.id);
                const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
                await until(() => hub());
                hub().closest('.tv-overlay').querySelector('.tv-overlay__close').click();
                await until(() => !hub());
            }
            await plugin.taskHub.cards.menuHandler.showContextMenu(0, 0, task);
            await pick(${JSON.stringify(tr('menu.addChildTask'))});
            await until(() => nameInput() && document.activeElement === nameInput());
            await until(() => formSays().length > 0);
            const propRow = rowOf('area');
            const chip = draft().querySelector('.task-hub__tag-chip--cascade');
            const out = {
                opened: view(),
                color: { placeholder: colorInput().placeholder, from: colorInput().closest('.tv-form__row').querySelector('.task-hub__source').textContent },
                property: { value: propRow.querySelector('input.tv-ctrl__text-input')?.value ?? null, from: propRow.querySelector('.task-hub__source').textContent },
                tag: { text: chip.textContent, label: chip.getAttribute('aria-label') },
            };
            // Each label pressed: none has a line to open.
            R.leafCount = app.workspace.getLeavesOfType('markdown').length;
            R.activeFile = app.workspace.getActiveFile()?.path ?? null;
            colorInput().closest('.tv-form__row').querySelector('.task-hub__source').click();
            propRow.querySelector('.task-hub__source').click();
            chip.click();
            return JSON.stringify(out);
        `);
        const pressed = run<Record<string, unknown>>(`
            const out = {
                open: !!draft(),
                leaves: app.workspace.getLeavesOfType('markdown').length - R.leafCount,
                activeFile: (app.workspace.getActiveFile()?.path ?? null) === R.activeFile,
            };
            type(nameInput(), '子');
            type(dateInput(${JSON.stringify(tr('modal.start'))}, 'time'), '10:00');
            create();
            await until(() => !draft());
            out.disk = await disk(${JSON.stringify(CHILD_FILE)});
            return JSON.stringify(out);
        `);
        const section = tr('modal.hub.inheritedFromSection');
        expect(steps.opened).toMatchObject({
            start: { date: { value: '', placeholder: '2031-02-01' } },
            form: [`${INFO}: ${tr('modal.newTask.toChild', { parent: '親' })}`],
            buttons: [tr('modal.cancel'), tr('modal.create')],
            titles: [tr('modal.newTask.title')],
        });
        expect(steps.color).toEqual({ placeholder: 'red', from: section });
        // The inherited value is shown in the field, as a row's inherited property is.
        expect(steps.property).toEqual({ value: 'lab', from: section });
        expect(steps.tag).toEqual({ text: '#sec', label: tr('modal.hub.cascadeTagLocked', { source: section }) });
        expect(pressed).toMatchObject({ open: true, leaves: 0, activeFile: true });
        // Indented as Obsidian's settings say (a tab, Obsidian's default).
        expect(pressed.disk).toMatch(/^## Work\n- tv-start:: 2031-02-01\n- tv-color:: red\n- tags:: #sec\n- area:: lab\n- \[ \] 親\n(\t| {4})- \[ \] 子 @10:00\n$/);
    });
});

describe('the create', () => {
    it('writes nothing while the fields are edited, then the line and its property lines with one write, read back as given', async () => {
        await writeIndexedTestFile(MAKE_FILE, MAKE_NOTE);
        const steps = run<Record<string, unknown>>(`
            await openChild(${JSON.stringify(MAKE_FILE)}, '親');
            watchWrites(${JSON.stringify(MAKE_FILE)});
            type(nameInput(), '作る');
            await until(() => card().textContent.includes('作る'));
            draft().querySelector('.task-hub__status-pill').click();
            const doing = plugin.settings.statusDefinitions.find(d => d.char === '/');
            await pick(doing.label);
            await until(() => draft().querySelector('.task-hub__status-pill').textContent === doing.label);
            type(tagInput(), 'proj');
            await until(() => draft().querySelector('.task-hub__tag-chip')?.textContent.includes('proj'));
            type(colorInput(), 'blue');
            typeIn(keyInput(), 'area');
            typeIn(valueInput(), 'lab');
            valueInput().dispatchEvent(new FocusEvent('blur'));
            await until(() => rowOf('area'));
            return JSON.stringify({ card: card().textContent });
        `);
        const edited = run<Record<string, unknown>>(`
            const out = { open: !!draft(), seen: { ...R.seen, written: R.seen.written.length }, disk: await disk(${JSON.stringify(MAKE_FILE)}) };
            create();
            await until(() => !draft());
            await until(() => plugin.getIndex().getTasks().some(t => t.file === ${JSON.stringify(MAKE_FILE)} && t.content === '作る'));
            const task = rowTask(${JSON.stringify(MAKE_FILE)}, '作る');
            out.made = { seen: R.seen, disk: await disk(${JSON.stringify(MAKE_FILE)}) };
            out.read = { status: task.statusChar, tags: task.tags, color: task.color, area: task.properties.area?.value ?? null, parent: plugin.getIndex().getTask(task.parentId)?.content };
            return JSON.stringify(out);
        `);
        expect(steps.card).toContain('作る');
        expect(edited).toMatchObject({ open: true, seen: { written: 0, modified: 0 }, disk: MAKE_NOTE });
        const made = edited.made as { seen: { written: string[]; modified: number }; disk: string };
        // One write, which the note holds as it is: no state between came to the note.
        expect(made.seen.written).toEqual([made.disk]);
        expect(made.seen.modified).toBe(1);
        expect(made.disk).toBe([
            '# 見出し',
            '- [ ] 親',
            '\t- [/] 作る',
            '\t\t- tv-color:: blue',
            '\t\t- tags:: #proj',
            '\t\t- area:: lab',
            '- [ ] 次',
            '',
        ].join('\n'));
        expect(edited.read).toEqual({ status: '/', tags: ['proj'], color: 'blue', area: { type: 'text', text: 'lab', spelling: 'lab' }, parent: '親' });
    });

    it('writes a task with no name as `- [ ] `, its card showing the link to its note before it is made', async () => {
        await writeIndexedTestFile(MAKE_FILE, MAKE_NOTE);
        const steps = run<Record<string, unknown>>(`
            await openChild(${JSON.stringify(MAKE_FILE)}, '次');
            const link = card().querySelector('.task-card__file-link');
            const item = card().querySelector('.task-card__content li');
            const before = { link: link?.textContent ?? null, href: link?.querySelector('a.internal-link')?.getAttribute('data-href') ?? null, item: item.textContent.trim(), checkbox: !!item.querySelector('input.task-list-item-checkbox') };
            create();
            await until(() => !draft());
            return JSON.stringify({ before, disk: await disk(${JSON.stringify(MAKE_FILE)}) });
        `);
        const base = MAKE_FILE.replace(/\.md$/, '');
        expect(steps.before).toEqual({ link: base, href: base, item: base, checkbox: true });
        expect(steps.disk).toBe(MAKE_NOTE.replace('- [ ] 次\n', '- [ ] 次\n\t- [ ] \n'));
    });

    it('puts in what is typed and not left before it creates, on a press that takes no focus', async () => {
        await writeIndexedTestFile(MAKE_FILE, MAKE_NOTE);
        const written = run<string>(`
            await openChild(${JSON.stringify(MAKE_FILE)}, '親');
            typeIn(dateInput(${JSON.stringify(tr('modal.due'))}, 'date'), '2031-03-01');
            typeIn(nameInput(), '打ちかけ');
            create();
            await until(() => !draft());
            return JSON.stringify(await disk(${JSON.stringify(MAKE_FILE)}));
        `);
        expect(written).toBe(MAKE_NOTE.replace('- [ ] 親\n', '- [ ] 親\n\t- [ ] 打ちかけ @>>2031-03-01\n'));
    });

    it('makes nothing while a value typed does not read, and takes the focus to it', async () => {
        await writeIndexedTestFile(MAKE_FILE, MAKE_NOTE);
        run(`
            await openChild(${JSON.stringify(MAKE_FILE)}, '親');
            watchWrites(${JSON.stringify(MAKE_FILE)});
            type(nameInput(), '日付');
            typeIn(dateInput(${JSON.stringify(tr('modal.start'))}, 'date'), 'あした');
            nameInput().focus();
            create();
            return 'ok';
        `);
        const after = run<Record<string, unknown>>(`
            const start = dateInput(${JSON.stringify(tr('modal.start'))}, 'date');
            return JSON.stringify({ open: !!draft(), focused: document.activeElement === start, says: says(start).length, written: R.seen.written.length, disk: await disk(${JSON.stringify(MAKE_FILE)}) });
        `);
        expect(after).toEqual({ open: true, focused: true, says: 1, written: 0, disk: MAKE_NOTE });
    });
});

describe('the card of a task not written yet', () => {
    it('opens no menu, changes no status and opens no note on a press on it, its checkbox or its link', async () => {
        await writeIndexedTestFile(MAKE_FILE, MAKE_NOTE);
        const steps = run<Record<string, unknown>>(`
            await openChild(${JSON.stringify(MAKE_FILE)}, '親');
            type(nameInput(), '押す');
            await until(() => card().textContent.includes('押す'));
            plugin.menuPresenter.dismiss();
            R.leafCount = app.workspace.getLeavesOfType('markdown').length;
            R.activeFile = app.workspace.getActiveFile()?.path ?? null;
            R.status = draft().querySelector('.task-hub__status-pill').textContent;
            R.notices = notices();
            const checkbox = card().querySelector('input.task-list-item-checkbox');
            const link = card().querySelector('a.internal-link');
            /** What a press at the middle of \`el\` lands on, as a pointer would. */
            const under = el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); };
            const out = {
                pointer: { checkbox: getComputedStyle(checkbox).pointerEvents, link: getComputedStyle(link).pointerEvents },
                hit: { checkbox: under(checkbox) === checkbox, link: under(link) === link },
            };
            card().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
            under(checkbox).click();
            under(link).click();
            // Pressed whatever a pointer cannot reach: the status is the draft's, not the box's.
            checkbox.click();
            return JSON.stringify(out);
        `);
        const after = run<Record<string, unknown>>(`
            return JSON.stringify({
                open: !!draft(),
                menu: menuTitles(),
                status: draft()?.querySelector('.task-hub__status-pill').textContent === R.status,
                cardStatus: card()?.querySelector('.task-card__content li')?.getAttribute('data-task') ?? null,
                leaves: app.workspace.getLeavesOfType('markdown').length - R.leafCount,
                activeFile: (app.workspace.getActiveFile()?.path ?? null) === R.activeFile,
                notices: notices() - R.notices,
            });
        `);
        expect(after).toEqual({ open: true, menu: [], status: true, cardStatus: '', leaves: 0, activeFile: true, notices: 0 });
        // A pointer does not reach the checkbox or the link.
        expect(steps).toEqual({ pointer: { checkbox: 'none', link: 'none' }, hit: { checkbox: false, link: false } });
        expect(readTestFile(MAKE_FILE)).toBe(MAKE_NOTE);
    });
});
