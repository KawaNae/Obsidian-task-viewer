/**
 * The tabs of the hub on a task not written yet, "Properties" and
 * "Location", under its card, in the running E2E vault.
 *
 * - On a daily note (a Timeline's all-day empty space, Create task for
 *   daily note): it opens on the properties, the focus on the name, the
 *   place tab's fields on the daily note's name and the settings' heading.
 *   The panel does not move nor change its size as the tab is changed.
 * - The keys: the arrows go from tab to tab, round at the ends, and Tab
 *   goes from the tab chosen into its pane, never into the pane not chosen.
 * - Its place changed in the place tab: to another note, to a note not
 *   there and back to the daily note, the line above the create saying each
 *   time where the task goes; the daily note not there is made of its
 *   day's template, as it is when the place is not changed.
 * - Closed: a place changed alone is asked about, a place changed back is
 *   not, nor is a hub given nothing.
 * - A create pressed on the place tab while a date of the properties does
 *   not read, or while a time with no date has lost the date the place gave
 *   it, writes nothing and goes to the properties tab, the focus on that
 *   field.
 * - An Escape while the note field's list is open closes the list alone;
 *   the next goes the way the hub closes.
 * - A create pressed while the note just typed is being read waits for it,
 *   and writes the name typed before the press in that note.
 * - Under a row (a card's menu, Add child task): the tabs are there, it
 *   opens on the properties, and the place tab shows the parent's note, the
 *   heading its row is under ("None" above the note's first heading) and
 *   the parent, with no field. The child goes first among the parent's
 *   children.
 *
 * Keys are sent as the keyboard sends them, through Electron, so the
 * browser's own Tab order and Obsidian's key scopes take them. A check that
 * something did not happen reads the state in the CLI call after the one
 * that pressed. The notes' bytes are read back from the disk. The daily
 * notes are of days far off (2031-02), made by the test or not at all, and
 * deleted after.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open,
 *     its daily notes at the vault's root as YYYY-MM-DD, with no template,
 *     and new notes made at the vault's root
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/draft-tabs.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile, writeTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { MENUS } from '../helpers/menus';
import { DIALOG_ROWS } from '../helpers/dialog-rows';
import { DRAFT_HUB } from '../helpers/draft-hub';

/** Daily notes not there: each test that makes one makes it of a day of its own. */
const DAYS = ['2031-02-03', '2031-02-04', '2031-02-05', '2031-02-06', '2031-02-07', '2031-02-08', '2031-02-09', '2031-02-10'];
const [OPEN_DAY, TEMPLATE_DAY, CLOSE_DAY, DATE_DAY, ESCAPE_DAY, WAIT_DAY, KEYS_DAY] = DAYS;

const OTHER_NAME = 'test-int-draft-tabs-other';
const OTHER_FILE = `${OTHER_NAME}.md`;
/** A note not there: named in the place tab, never made. */
const NEW_NAME = 'test-int-draft-tabs-new';
const INHERIT_NAME = 'test-int-draft-tabs-inherit';
const INHERIT_FILE = `${INHERIT_NAME}.md`;
const CHILD_FILE = 'test-int-draft-tabs-child.md';
const TEMPLATE_FILE = 'test-int-draft-tabs-template.md';

const OTHER_NOTE = [
    '# 別',
    '## Tasks',
    '- [ ] 既存',
    '',
].join('\n');

/** The section gives a start date, so a time alone is a start there. */
const INHERIT_NOTE = [
    '## Work',
    '- tv-start:: 2031-02-01',
    '- [ ] 既存',
    '',
].join('\n');

/** A parent above the note's first heading, and one under it with a child already. */
const CHILD_NOTE = [
    '- [ ] 上の親',
    '# 見出し',
    '- [ ] 親',
    '\t- [ ] 前からの子',
    '',
].join('\n');

const TEMPLATE = [
    '# テンプレート',
    '## Tasks',
    '',
].join('\n');

const INFO = 'tv-form__info';
const WARNING = 'tv-form__warning';
const ERROR = 'tv-form__error';

const PRELUDE = `
${UNTIL}
${DIALOG_ROWS}
${MENUS}
${DRAFT_HUB}
const ask = () => { const el = formRow(draft())?.querySelector('.tv-form__ask'); return shown(el) ? el.textContent : null; };
const button = text => [...formRow(draft()).querySelectorAll('button')].filter(shown).find(b => b.textContent === text);
const closeHub = () => draft().closest('.tv-overlay').querySelector('.tv-overlay__close').click();
const nextFrame = () => new Promise(r => requestAnimationFrame(r));
/** The hub on the daily note of \`day\`, as the views open it, the focus on its name and its place read. */
const openDaily = async day => {
    plugin.openDraftHub(plugin.getCreatePlaces().dailyNote(day), { startDate: day });
    await until(() => nameInput() && document.activeElement === nameInput() && lineSays().length > 0);
};
/** Choose the tab \`id\` by its button, and wait for it to be chosen. */
const choose = async id => {
    tab(id).click();
    await until(() => tabOn() === id);
};
const rect = el => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height }; };
/** Press \`name\` and wait for the focus to move from where it is. */
const moveBy = async name => {
    const from = document.activeElement;
    keys(name);
    await until(() => document.activeElement !== from, 2000, () => name + ' left the focus on ' + from?.outerHTML.slice(0, 80));
    return document.activeElement;
};
const rowTask = (file, name) => {
    const task = plugin.getIndex().getTasks().find(t => t.file === file && t.content === name);
    if (!task) throw new Error('no row ' + name);
    return task;
};
const exists = path => !!app.vault.getAbstractFileByPath(path);
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

const dailyOf = (day: string) => `${day}.md`;

beforeAll(() => {
    // Focus moves and keys need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
    const made = [...DAYS.map(dailyOf), `${NEW_NAME}.md`];
    const there = run<string[]>(`return JSON.stringify(${JSON.stringify(made)}.filter(exists));`);
    if (there.length > 0) throw new Error(`${there.join(', ')} in the E2E vault: the test makes and deletes them, so it does not run over one.`);
    const folder = run<string>(`return JSON.stringify(app.fileManager.getNewFileParent('').path);`);
    if (folder !== '/') throw new Error(`new notes are made in ${folder}: the test names a daily note at the root by its name alone.`);
});

afterEach(() => { run(`await cleanUpHubs(); return 'ok';`); });

afterAll(async () => {
    for (const file of [...DAYS.map(dailyOf), `${NEW_NAME}.md`, OTHER_FILE, INHERIT_FILE, CHILD_FILE, TEMPLATE_FILE]) {
        deleteTestFile(file);
        await waitForFileDeindexed(file);
    }
});

describe('the tabs of the hub on a daily note', () => {
    it('opens on the properties, the focus on the name, the place\'s fields on the daily note and the settings\' heading, the panel still as the tab changes', () => {
        const steps = run<Record<string, unknown>>(`
            await fromAllDay(${JSON.stringify(OPEN_DAY)}, ${JSON.stringify(tr('menu.createTaskForDailyNote'))});
            await until(() => nameInput() && document.activeElement === nameInput() && lineSays().length > 0);
            const panel = draft();
            const out = {
                opened: {
                    tabs: [...panel.querySelectorAll('button.tv-tabs__tab')].map(b => b.dataset.tab + ': ' + b.textContent),
                    tab: tabOn(),
                    onName: document.activeElement === nameInput(),
                    note: noteInput().value,
                    heading: headingInput().value,
                    line: lineSays(),
                },
                rects: [rect(panel)],
            };
            await choose('place');
            await nextFrame();
            out.rects.push(rect(panel));
            out.offPane = { inert: paneOf('properties').inert, visibility: getComputedStyle(paneOf('properties')).visibility };
            await choose('properties');
            await nextFrame();
            out.rects.push(rect(panel));
            return JSON.stringify(out);
        `);
        expect(steps.opened).toEqual({
            tabs: [`properties: ${tr('modal.hub.tabProperties')}`, `place: ${tr('modal.hub.tabPlace')}`],
            tab: 'properties',
            onName: true,
            note: OPEN_DAY,
            heading: 'Tasks',
            line: [`${INFO}: ${tr('modal.newTask.toNew', { note: dailyOf(OPEN_DAY), heading: 'Tasks' })}`],
        });
        const [first, ...rest] = steps.rects as { top: number; left: number; width: number; height: number }[];
        for (const r of rest) {
            expect(r.top).toBeCloseTo(first.top, 1);
            expect(r.left).toBeCloseTo(first.left, 1);
            expect(r.width).toBeCloseTo(first.width, 1);
            expect(r.height).toBeCloseTo(first.height, 1);
        }
        expect(steps.offPane).toEqual({ inert: true, visibility: 'hidden' });
    });

    it('goes from tab to tab by the arrows, round at the ends, and by Tab into the pane chosen alone', () => {
        const steps = run<Record<string, unknown>>(`
            await openDaily(${JSON.stringify(KEYS_DAY)});
            const out = {};
            tab('properties').focus();
            await moveBy('Right');
            out.right = { tab: tabOn(), onTab: document.activeElement === tab('place') };
            await moveBy('Tab');
            out.tabIntoPlace = { onNote: document.activeElement === noteInput() };
            tab('place').focus();
            await moveBy('Right');
            out.round = { tab: tabOn(), onTab: document.activeElement === tab('properties') };
            await moveBy('Left');
            out.left = { tab: tabOn(), onTab: document.activeElement === tab('place') };
            await moveBy('Left');
            // From the properties' tab, Tab after Tab until the focus leaves the hub.
            const visits = [];
            for (let i = 0; i < 60 && draft()?.contains(document.activeElement); i++) {
                const at = await moveBy('Tab');
                visits.push(paneOf('place').contains(at) ? 'place' : paneOf('properties').contains(at) ? 'properties' : 'other');
            }
            out.walk = { tab: tabOn(), first: visits[0], place: visits.filter(v => v === 'place').length, properties: visits.filter(v => v === 'properties').length, left: !draft()?.contains(document.activeElement) };
            return JSON.stringify(out);
        `);
        expect(steps.right).toEqual({ tab: 'place', onTab: true });
        expect(steps.tabIntoPlace).toEqual({ onNote: true });
        expect(steps.round).toEqual({ tab: 'properties', onTab: true });
        expect(steps.left).toEqual({ tab: 'place', onTab: true });
        const walk = steps.walk as { tab: string; first: string; place: number; properties: number; left: boolean };
        expect(walk).toMatchObject({ tab: 'properties', first: 'properties', place: 0, left: true });
        expect(walk.properties).toBeGreaterThan(1);
    });
});

describe('the place of the hub on a daily note, changed in its tab', () => {
    it('says where the task goes as the note is changed, and makes the daily note of its template once it is named again', async () => {
        await writeIndexedTestFile(OTHER_FILE, OTHER_NOTE);
        // A note with no task: the vault lists it, the index does not.
        writeTestFile(TEMPLATE_FILE, TEMPLATE);
        const steps = run<Record<string, unknown>>(`
            await until(() => exists(${JSON.stringify(TEMPLATE_FILE)}));
            const daily = app.internalPlugins.getPluginById('daily-notes').instance.options;
            const had = daily.template;
            daily.template = ${JSON.stringify(TEMPLATE_FILE.replace(/\.md$/, ''))};
            try {
                await fromAllDay(${JSON.stringify(TEMPLATE_DAY)}, ${JSON.stringify(tr('menu.createTaskForDailyNote'))});
                await until(() => nameInput() && document.activeElement === nameInput() && lineSays().length > 0);
                const out = { opened: lineSays() };
                type(nameInput(), '戻した');
                await choose('place');
                out.other = await retyped(noteInput(), ${JSON.stringify(OTHER_NAME)});
                out.made = await retyped(noteInput(), ${JSON.stringify(NEW_NAME)});
                out.madeUnder = says(noteInput());
                out.back = await retyped(noteInput(), ${JSON.stringify(TEMPLATE_DAY)});
                out.backUnder = says(noteInput());
                create();
                await until(() => !draft(), 5000, () => lineSays().join('|'));
                await until(() => exists(${JSON.stringify(dailyOf(TEMPLATE_DAY))}));
                out.disk = await disk(${JSON.stringify(dailyOf(TEMPLATE_DAY))});
                out.newMade = exists(${JSON.stringify(`${NEW_NAME}.md`)});
                return JSON.stringify(out);
            } finally {
                daily.template = had;
            }
        `);
        const toDaily = `${INFO}: ${tr('modal.newTask.toNew', { note: dailyOf(TEMPLATE_DAY), heading: 'Tasks' })}`;
        expect(steps.opened).toEqual([toDaily]);
        expect(steps.other).toEqual([`${INFO}: ${tr('modal.newTask.toHead', { note: OTHER_FILE, heading: 'Tasks' })}`]);
        expect(steps.made).toEqual([`${WARNING}: ${tr('modal.newTask.toNewNote', { note: `${NEW_NAME}.md`, heading: 'Tasks' })}`]);
        expect(steps.madeUnder).toEqual([`${WARNING}: ${tr('modal.newTask.noteNew')}`]);
        // Named again, it is the daily note, made of the day's template, not an empty note.
        expect(steps.back).toEqual([toDaily]);
        expect(steps.backUnder).toEqual([`${WARNING}: ${tr('modal.newTask.noteNew')}`]);
        const lines = (steps.disk as string).split('\n');
        expect(lines.slice(0, 2)).toEqual(['# テンプレート', '## Tasks']);
        expect(lines[2]).toMatch(/^- \[ \] 戻した/);
        expect(steps.newMade).toBe(false);
        expect(readTestFile(OTHER_FILE)).toBe(OTHER_NOTE);
    });

    it('asks on a close of a place changed alone, and not once it is changed back, nor of a hub given nothing', async () => {
        await writeIndexedTestFile(OTHER_FILE, OTHER_NOTE);
        const steps = run<Record<string, unknown>>(`
            const out = {};
            await openDaily(${JSON.stringify(CLOSE_DAY)});
            closeHub();
            await until(() => !draft());
            out.nothing = { open: !!draft() };

            await openDaily(${JSON.stringify(CLOSE_DAY)});
            await choose('place');
            await retyped(noteInput(), ${JSON.stringify(OTHER_NAME)});
            closeHub();
            await until(() => ask());
            out.changed = { open: !!draft(), ask: ask() };
            button(${JSON.stringify(tr('modal.draft.keep'))}).click();
            await until(() => !ask());
            await retyped(noteInput(), ${JSON.stringify(CLOSE_DAY)});
            closeHub();
            await until(() => !draft() || ask());
            out.back = { open: !!draft(), ask: ask() };
            return JSON.stringify(out);
        `);
        expect(steps).toEqual({
            nothing: { open: false },
            changed: { open: true, ask: tr('modal.newTask.discardAsk') },
            back: { open: false, ask: null },
        });
        expect(run<boolean>(`return JSON.stringify(exists(${JSON.stringify(dailyOf(CLOSE_DAY))}));`)).toBe(false);
        expect(readTestFile(OTHER_FILE)).toBe(OTHER_NOTE);
    });
});

describe('a create pressed on the place tab, over a value of the properties that cannot be written', () => {
    it('a date that does not read: goes to the properties tab, the focus on the date, and writes nothing', () => {
        run(`
            await openDaily(${JSON.stringify(DATE_DAY)});
            type(nameInput(), '日付');
            typeIn(dateInput(${JSON.stringify(tr('modal.start'))}, 'date'), 'あした');
            await choose('place');
            create();
            return 'ok';
        `);
        const after = run<Record<string, unknown>>(`
            const date = dateInput(${JSON.stringify(tr('modal.start'))}, 'date');
            return JSON.stringify({ open: !!draft(), tab: tabOn(), focused: document.activeElement === date, says: says(date).length, made: exists(${JSON.stringify(dailyOf(DATE_DAY))}) });
        `);
        expect(after).toEqual({ open: true, tab: 'properties', focused: true, says: 1, made: false });
    });

    it('a time whose date the place gave, the place changed to one that gives none: goes to the properties tab, the focus on the time, and writes nothing', async () => {
        await writeIndexedTestFile(INHERIT_FILE, INHERIT_NOTE);
        await writeIndexedTestFile(OTHER_FILE, OTHER_NOTE);
        const steps = run<Record<string, unknown>>(`
            plugin.openDraftHub(null, {});
            await until(() => draft() && document.activeElement === noteInput());
            await retyped(noteInput(), ${JSON.stringify(INHERIT_NAME)});
            await retyped(headingInput(), 'Work');
            await choose('properties');
            const time = () => dateInput(${JSON.stringify(tr('modal.start'))}, 'time');
            const date = () => dateInput(${JSON.stringify(tr('modal.start'))}, 'date');
            type(nameInput(), '時刻だけ');
            type(time(), '10:00');
            const out = { inherited: { placeholder: date().placeholder, says: says(time()) } };
            await choose('place');
            await retyped(noteInput(), ${JSON.stringify(OTHER_NAME)});
            await retyped(headingInput(), 'Tasks');
            create();
            return JSON.stringify(out);
        `);
        const after = run<Record<string, unknown>>(`
            const time = dateInput(${JSON.stringify(tr('modal.start'))}, 'time');
            return JSON.stringify({ open: !!draft(), tab: tabOn(), focused: document.activeElement === time, says: says(time) });
        `);
        expect(steps.inherited).toEqual({ placeholder: '2031-02-01', says: [] });
        expect(after).toEqual({ open: true, tab: 'properties', focused: true, says: [`${ERROR}: ${tr('validation.startRequiresDate')}`] });
        expect(readTestFile(INHERIT_FILE)).toBe(INHERIT_NOTE);
        expect(readTestFile(OTHER_FILE)).toBe(OTHER_NOTE);
    });
});

describe('the note field of the place tab', () => {
    it('closes its list alone on an Escape, and the next Escape goes the way the hub closes', async () => {
        await writeIndexedTestFile(OTHER_FILE, OTHER_NOTE);
        const steps = run<Record<string, unknown>>(`
            await openDaily(${JSON.stringify(ESCAPE_DAY)});
            await choose('place');
            const list = () => document.querySelector('.suggestion-container');
            const items = () => [...document.querySelectorAll('.suggestion-container .suggestion-item')].map(el => el.textContent);
            typeIn(noteInput(), ${JSON.stringify(OTHER_NAME.slice(0, -3))});
            await until(() => items().some(t => t.includes(${JSON.stringify(OTHER_NAME)})));
            const out = { listed: items().some(t => t.includes(${JSON.stringify(OTHER_NAME)})) };
            keys('Escape');
            await until(() => !list());
            await nextFrame();
            out.first = { list: !!list(), open: !!draft(), ask: ask(), onNote: document.activeElement === noteInput() };
            keys('Escape');
            await until(() => ask() || !draft());
            out.second = { open: !!draft(), ask: ask() };
            return JSON.stringify(out);
        `);
        expect(steps).toEqual({
            listed: true,
            first: { list: false, open: true, ask: null, onNote: true },
            // The note typed changed the place: the close asks.
            second: { open: true, ask: tr('modal.newTask.discardAsk') },
        });
    });
});

describe('a create pressed while the note just typed is read', () => {
    it('waits for the read and writes the name typed before the press in that note', async () => {
        await writeIndexedTestFile(OTHER_FILE, OTHER_NOTE);
        const steps = run<Record<string, unknown>>(`
            await openDaily(${JSON.stringify(WAIT_DAY)});
            type(nameInput(), '待った');
            await choose('place');
            holdReads();
            const out = {};
            try {
                typeIn(noteInput(), ${JSON.stringify(OTHER_NAME)});
                create();
                await until(() => R.held > 0 && createButton().textContent === ${JSON.stringify(tr('modal.newTask.creating'))});
                await nextFrame();
                out.waiting = {
                    open: !!draft(),
                    create: createButton().textContent,
                    offered: !createButton().disabled,
                    fields: placeInputs().map(i => i.disabled),
                    name: nameInput().disabled,
                    disk: await disk(${JSON.stringify(OTHER_FILE)}),
                };
                R.releaseReads();
                await until(() => !draft(), 5000, () => lineSays().join('|'));
            } finally {
                R.unhold?.();
            }
            out.disk = await disk(${JSON.stringify(OTHER_FILE)});
            out.daily = exists(${JSON.stringify(dailyOf(WAIT_DAY))});
            return JSON.stringify(out);
        `);
        expect(steps.waiting).toEqual({
            open: true,
            create: tr('modal.newTask.creating'),
            offered: false,
            fields: [true, true],
            name: true,
            disk: OTHER_NOTE,
        });
        expect(steps.disk).toMatch(/^# 別\n## Tasks\n- \[ \] 待った.*\n- \[ \] 既存\n$/);
        expect(steps.daily).toBe(false);
    });
});

describe('the tabs of the hub under a row (a card\'s menu, Add child task)', () => {
    /** The hub under the row named, opened from the card menu the hub's cards open. */
    const OPEN = (name: string) => `
        const task = rowTask(${JSON.stringify(CHILD_FILE)}, ${JSON.stringify(name)});
        if (!plugin.taskHub.cards) {
            plugin.openTaskHub(task.id);
            const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
            await until(() => hub());
            hub().closest('.tv-overlay').querySelector('.tv-overlay__close').click();
            await until(() => !hub());
        }
        await plugin.taskHub.cards.menuHandler.showContextMenu(0, 0, task);
        await pick(${JSON.stringify(tr('menu.addChildTask'))});
        await until(() => nameInput() && document.activeElement === nameInput() && lineSays().length > 0);
        const values = () => [...paneOf('place').querySelectorAll('.task-hub__shown-value')].map(v => v.textContent);
        const labels = () => [...paneOf('place').querySelectorAll('.tv-form__row .tv-form__label')].map(l => l.textContent);
    `;

    it('opens on the properties and shows the parent\'s note, heading and text with no field; the child goes first among its children', async () => {
        await writeIndexedTestFile(CHILD_FILE, CHILD_NOTE);
        const steps = run<Record<string, unknown>>(`
            ${OPEN('親')}
            const out = {
                tabs: [...draft().querySelectorAll('button.tv-tabs__tab')].map(b => b.dataset.tab),
                tab: tabOn(),
                onName: document.activeElement === nameInput(),
            };
            await choose('place');
            out.place = { labels: labels(), values: values(), fields: paneOf('place').querySelectorAll('input').length, says: [...paneOf('place').querySelectorAll('.tv-form__says > *')].map(c => c.className + ': ' + c.textContent) };
            await choose('properties');
            type(nameInput(), '新しい子');
            create();
            await until(() => !draft());
            out.disk = await disk(${JSON.stringify(CHILD_FILE)});
            return JSON.stringify(out);
        `);
        expect(steps).toMatchObject({ tabs: ['properties', 'place'], tab: 'properties', onName: true });
        expect(steps.place).toEqual({
            labels: [tr('modal.note'), tr('modal.heading'), tr('modal.parentTask')],
            values: [CHILD_FILE, '見出し', '親'],
            fields: 0,
            says: [`${INFO}: ${tr('modal.newTask.childFixed')}`],
        });
        expect(steps.disk).toBe(CHILD_NOTE.replace('- [ ] 親\n', '- [ ] 親\n\t- [ ] 新しい子\n'));
    });

    it('shows no heading for a parent above the note\'s first heading', async () => {
        await writeIndexedTestFile(CHILD_FILE, CHILD_NOTE);
        const values = run<string[]>(`
            ${OPEN('上の親')}
            await choose('place');
            return JSON.stringify(values());
        `);
        expect(values).toEqual([CHILD_FILE, tr('modal.newTask.noHeading'), '上の親']);
    });
});
