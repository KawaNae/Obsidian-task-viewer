/**
 * A button of another part of the hub than the field typed in, pressed with
 * the mouse while the field holds the focus, in the running E2E vault. The
 * field's commit draws the hub again at a time that depends on its host,
 * and the button acts once, as it is drawn then, on the value typed:
 *
 * - The switch to the source, on a row: a name or a property's value typed
 *   is written once and the source opens on it; what the source writes is
 *   not written over once the hub is closed. A date that does not read is
 *   not written and stays typed: the source opens on the row as it is, and
 *   back on the card the date holds it, why said under it, and a close asks.
 * - On a task not written yet, whose host draws a commit in a microtask, run
 *   as the field's commit is done before the button is looked for: the
 *   status, a date's ×, a tab, the button that shows or hides the line
 *   above the create, a property's menu button, a value's ×, a list's
 *   item ×, the color's hide and a tag's ×. The field keeps the focus but
 *   for the tab, which takes it.
 * - On a row, whose fields are drawn again once the note's write comes back
 *   from the index: a property's menu stays open, and a list's item × takes
 *   its item out of the list as the color's write left it.
 * - In a move, whose draft draws the commit at once: a property's menu.
 *
 * The name, the status and the dates are in the basic tab; the tags, the
 * style and the properties in the details tab: a field of one tab and a
 * button of the other are never on the screen together.
 *
 * Every press is the mouse's, through Electron (`REAL_INPUT`). Nothing is
 * typed by keys before a press and the field is never left, so no Enter,
 * Tab or blur writes what is typed. The writes the hub asks of the note are
 * counted at `app.vault.process`, and the menus at the plugin's presenter.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/press-typed-parts.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { DIALOG_ROWS } from '../helpers/dialog-rows';
import { MENUS } from '../helpers/menus';
import { REAL_INPUT } from '../helpers/real-input';

const TEST_FILE = 'test-int-hub-press-typed-parts.md';

/** The section gives a color: a task under it shows the button that hides it. */
const LINES = [
    '## Work',
    '- tv-color:: red',
    '- [ ] 親 @2026-10-01>2026-10-03',
    '\t- links::',
    '\t\t- 企画書',
    '\t\t- 議事録',
    '\t- memo:: 短い',
    '\t- summary:: 資料',
    '- [ ] 次',
    '',
];

const PRELUDE = `
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const FILE = ${JSON.stringify(TEST_FILE)};
const R = (window.__tvPressPartsE2E ??= {});
${UNTIL}
${DIALOG_ROWS}
${MENUS}
${REAL_INPUT}
const nextFrame = () => new Promise(r => requestAnimationFrame(r));
const shown = el => !!el && getComputedStyle(el).display !== 'none';
const overlays = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing)')];
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
/** Whether \`test\` comes true within \`ms\`: a wait whose not coming is what is seen. */
const saw = (test, ms = 3000) => until(test, ms).then(() => true, () => false);
const rowOf = label => [...hub().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === label);
const valueInput = key => rowOf(key).querySelector('input.task-hub__value');
const valueClear = key => rowOf(key).querySelector('.task-hub__value-box .tv-form__clear-button');
const moreOf = key => rowOf(key).querySelector('.task-hub__prop-more');
const items = key => [...rowOf(key).querySelectorAll('.task-hub__list-items .task-hub__list-item input')].map(i => i.value);
const itemClear = (key, item) => [...rowOf(key).querySelectorAll('.task-hub__list-items .task-hub__list-item')]
    .find(el => el.querySelector('input')?.value === item).querySelector('.tv-form__clear-button');
const nameInput = () => hub()?.querySelector('.tv-form__name-section input') ?? null;
const tagInput = () => hub().querySelector('.task-hub__tag-add-wrap input');
const tagChips = () => [...hub().querySelectorAll('.task-hub__tag-chip')].map(c => c.textContent);
const tagRemove = tag => [...hub().querySelectorAll('.task-hub__tag-chip')].find(c => c.textContent === '#' + tag)?.querySelector('.tv-ctrl__pill-remove') ?? null;
const colorInput = () => hub().querySelector('.tv-form__input-with-picker--color input.tv-ctrl__text-input');
const colorRow = () => colorInput().closest('.tv-form__row');
const hideColor = () => colorRow().querySelector('.task-hub__hide');
const colorHidden = () => !colorRow().querySelector('.task-hub__prop-remove').classList.contains('is-hidden');
const statusPill = () => hub().querySelector('.task-hub__status-pill');
const dateInput = (label, which) => rowOf(label).querySelector('.tv-form__field--' + which + ' input.tv-ctrl__text-input');
const dateClear = (label, which) => rowOf(label).querySelector('.tv-form__field--' + which + ' .tv-form__clear-button');
const START = ${JSON.stringify(tr('modal.start'))};
const createToggle = () => hub().querySelector('.task-hub__create-toggle');
const card = () => hub()?.querySelector('.task-hub__preview .task-card') ?? null;
const modeButtons = () => [...hub().querySelectorAll('.task-hub__mode-toggle .task-hub__mode-button')];
const editorOf = which => {
    const el = hub()?.querySelector('.tv-source-editor__' + which + ' .cm-content');
    return el ? (el.cmTile?.view ?? el.cmView?.rootView?.view ?? null) : null;
};
const editorText = which => editorOf(which)?.state.doc.toString() ?? null;
const says = input => [...input.closest('.tv-form__row').nextElementSibling.children].map(c => c.className.split(' ')[0]);
const focusIn = input => { chooseTabOf(input).focus(); return input; };
/** Typed as a person types, the text and then its input event, the field not left. */
const typeIn = (input, text) => { focusIn(input); input.value = text; input.setSelectionRange(text.length, text.length); input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
const disk = () => app.vault.adapter.read(FILE);
/** Which field or button holds the focus, by what it stands for in the hub. */
const focusNow = () => {
    const a = document.activeElement;
    const p = hub();
    if (!a || a === document.body) return 'body';
    if (!p || !p.contains(a)) return 'outside: ' + a.tagName + '.' + a.className;
    if (a === nameInput()) return 'name';
    if (a === tagInput()) return 'tag add';
    if (a === colorInput()) return 'color';
    const row = a.closest('.tv-form__row');
    const label = row?.querySelector('.tv-form__label')?.textContent;
    if (a.matches('input.task-hub__value')) return 'value ' + label;
    if (a.matches('.task-hub__list-add')) return 'item add ' + label;
    if (a.matches('.task-hub__list-item input')) return 'item ' + label + ' ' + a.value;
    if (a.matches('button.tv-tabs__tab')) return 'tab ' + a.dataset.tab;
    if (a.matches('input.tv-ctrl__text-input')) return 'text ' + (label ?? '') + ' ' + a.getAttribute('aria-label');
    return a.tagName + '.' + a.className;
};
/** Wait for the hub's first focus, on its name: until the panel has come in, it takes the focus from a field typed in too. */
const opened = () => until(() => nameInput() && document.activeElement === nameInput());
const rowTask = name => {
    const task = plugin.getIndex().getTasks().find(t => t.file === FILE && t.content.startsWith(name));
    if (!task) throw new Error('no row ' + name);
    return task;
};
/** The row's hub, opened and on the tab \`tab\`. */
const openRow = async (name, tab = 'basic') => {
    plugin.openTaskHub(rowTask(name).id, { focusField: 'name' });
    await opened();
    if (hubTabOn(hub()) !== tab) chooseHubTab(hub(), tab);
    await until(() => hubTabOn(hub()) === tab);
};
const text = t => ({ type: 'text', text: t, spelling: t });
/** A task not written yet under 次, with its own tag, a list and a text value, and a start; the place answered. */
const openDraft = async () => {
    const properties = {
        docs: { key: 'docs', value: { type: 'list', items: [text('a'), text('b')] } },
        note1: { key: 'note1', value: text('m') },
    };
    plugin.openDraftHub({ kind: 'childOf', taskId: rowTask('次').id }, { startDate: '2031-04-07', tags: ['tg'], properties });
    await opened();
    await until(() => (hub().querySelector('.task-hub__create-says')?.children.length ?? 0) > 0);
};
/** A move begun on the row by its pencil, the place's fields drawn. */
const openMove = async name => {
    plugin.openTaskHub(rowTask(name).id, { focusField: 'name' });
    await opened();
    hub().querySelector('.task-hub__move').click();
    await until(() => hub().querySelectorAll('.task-hub__place input').length === 2 && formRow(hub())?.querySelector('.mod-cta'));
};
/** Count the writes asked of the note, and the menus the plugin presents, from now on. */
const watch = () => {
    const real = app.vault.process;
    const present = plugin.menuPresenter.present;
    R.writes = [];
    R.menus = 0;
    R.unwatch = () => { app.vault.process = real; plugin.menuPresenter.present = present; delete R.unwatch; };
    app.vault.process = function (file, ...rest) {
        const done = real.call(this, file, ...rest);
        if (file?.path === FILE) R.writes.push(done);
        return done;
    };
    plugin.menuPresenter.present = function (...args) { R.menus++; return present.apply(this, args); };
};
/** What \`read\` reads once the writes asked so far are done and the hub is drawn from them, with the writes and the menus. */
const settled = async (read = () => ({})) => {
    await nextFrame();
    await nextFrame();
    await Promise.allSettled(R.writes);
    await nextFrame();
    return { ...read(), writes: R.writes.length, menus: R.menus, disk: await disk() };
};
/** Close every overlay, throwing away what a hub asks about, and the menu. */
const cleanUp = async () => {
    R.unwatch?.();
    plugin.menuPresenter.dismiss();
    for (let i = 0; i < 6 && overlays().length > 0; i++) {
        const top = overlays().pop();
        const discard = () => [...top.querySelectorAll('.tv-form__discard')].find(shown);
        if (discard()) discard().click();
        else top.querySelector('.tv-overlay__close').click();
        await until(() => !overlays().includes(top) || discard());
    }
    plugin.menuPresenter.dismiss();
};
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude; a failure is told with `label`. */
function run<T>(label: string, body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`${label}: eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

/** The note with lines `from` up to `to` (0-indexed) put in place of what they were. */
function withLines(from: number, to: number, ...lines: string[]): string {
    const out = [...LINES];
    out.splice(from, to - from, ...lines);
    return out.join('\n');
}

beforeAll(() => {
    // Presses and focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
});

beforeEach(async () => { await writeIndexedTestFile(TEST_FILE, LINES.join('\n')); });
afterEach(() => { obsidianEval(`(async () => { ${PRELUDE}\nawait cleanUp(); return 'ok';\n})()`); });

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('the switch to the source pressed with a field typed in, on a row', () => {
    it('the name typed: written once, the source opened on it; what the source writes is not written over once it is closed', () => {
        const out = run<Record<string, Record<string, unknown>>>('source, name', `
            await openRow('親');
            typeIn(nameInput(), '親X');
            watch();
            press(modeButtons()[1]);
            const open = await saw(() => editorOf('parent'));
            const entered = await settled(() => ({ open, parent: editorText('parent'), name: nameInput().value, nameShut: nameInput().disabled, focus: focusNow() }));
            if (!open) return JSON.stringify({ entered });
            const view = editorOf('parent');
            const doc = view.state.doc.toString();
            view.dispatch({ changes: { from: 0, to: doc.length, insert: doc.replace(/親X?/, '親S') } });
            hub().querySelector('.task-hub__source-actions .mod-cta').click();
            const back = await saw(() => !editorOf('parent'));
            await until(() => rowTask('親S'), 3000, () => 'no row 親S').catch(() => null);
            const applied = await settled(() => ({ back, name: nameInput().value, nameShut: nameInput().disabled, focus: focusNow() }));
            hub().closest('.tv-overlay').querySelector('.tv-overlay__close').click();
            const asked = () => [...hub()?.querySelectorAll('.tv-form__discard') ?? []].find(shown);
            await saw(() => !hub() || asked());
            const closed = await settled(() => ({ closed: !hub(), asked: !!asked() }));
            return JSON.stringify({ entered, applied, closed });
        `);
        expect(out.entered).toMatchObject({ open: true, writes: 1, disk: withLines(2, 3, '- [ ] 親X @2026-10-01>2026-10-03') });
        expect(String(out.entered.parent)).toContain('親X');
        const sourced = withLines(2, 3, '- [ ] 親S @2026-10-01>2026-10-03');
        expect(out.applied).toMatchObject({ back: true, disk: sourced });
        expect(out.closed).toMatchObject({ closed: true, disk: sourced });
    });

    it('a property\'s value typed: written once, the source opened on it', () => {
        const out = run<Record<string, unknown>>('source, value', `
            await openRow('親', 'detail');
            typeIn(valueInput('summary'), '資料XX');
            watch();
            press(modeButtons()[1]);
            const open = await saw(() => editorOf('children'));
            return JSON.stringify(await settled(() => ({ open, children: editorText('children'), value: valueInput('summary').value, focus: focusNow() })));
        `);
        expect(out).toMatchObject({ open: true, writes: 1, disk: withLines(7, 8, '\t- summary:: 資料XX') });
        expect(String(out.children)).toContain('資料XX');
    });

    it('a date that does not read typed: nothing written, the source opened on the row as it is; back on the card the date is kept typed, why said under it, and a close asks', () => {
        const out = run<Record<string, Record<string, unknown>>>('source, date unread', `
            await openRow('親');
            typeIn(dateInput(START, 'date'), 'あした');
            watch();
            press(modeButtons()[1]);
            const open = await saw(() => editorOf('parent'));
            const entered = await settled(() => ({ open, parent: editorText('parent'), focus: focusNow() }));
            if (!open) return JSON.stringify({ entered });
            press(modeButtons()[0]);
            const back = await saw(() => !editorOf('parent'));
            const viewed = await settled(() => ({ back, says: says(dateInput(START, 'date')), date: dateInput(START, 'date').value, shut: dateInput(START, 'date').disabled, focus: focusNow() }));
            hub().closest('.tv-overlay').querySelector('.tv-overlay__close').click();
            const asked = () => [...hub()?.querySelectorAll('.tv-form__discard') ?? []].find(shown);
            await saw(() => !hub() || asked());
            const closing = await settled(() => ({ open: !!hub(), asked: !!asked() }));
            return JSON.stringify({ entered, viewed, closing });
        `);
        expect(out.entered).toMatchObject({ open: true, writes: 0, disk: LINES.join('\n') });
        expect(String(out.entered.parent)).toContain('親 @2026-10-01>2026-10-03');
        expect(out.viewed).toMatchObject({ back: true, says: ['tv-form__error'], date: 'あした', shut: false, writes: 0 });
        expect(out.closing).toMatchObject({ open: true, asked: true, writes: 0, disk: LINES.join('\n') });
    });
});

describe('a button of another part pressed with a field typed in, on a task not written yet', () => {
    /** The draft opened, `typed` typed in the field `field()` names, and `button()` pressed. */
    const pressed = (label: string, field: string, typed: string, button: string, done: string, read: string) => run<Record<string, unknown>>(label, `
        await openDraft();
        typeIn(${field}, ${JSON.stringify(typed)});
        watch();
        press(${button});
        const acted = await saw(() => ${done});
        await nextFrame();
        const seen = await settled(() => (${read}));
        closeMenus();
        return JSON.stringify({ acted, ...seen, focus: focusNow(), card: card()?.textContent ?? null });
    `);

    it('the name typed, the status: the menu open once, the name in the draft, the focus in the name', () => {
        const out = pressed('draft name, status', 'nameInput()', '新しい名前', 'statusPill()', 'R.menus > 0', '{}');
        expect(out).toMatchObject({ acted: true, menus: 1, focus: 'name' });
        expect(String(out.card)).toContain('新しい名前');
    });

    it('the name typed, the start date\'s ×: the date made none, the name in the draft, the focus in the name', () => {
        const out = pressed('draft name, date ×', 'nameInput()', '新しい名前', 'dateClear(START, \'date\')', 'dateInput(START, \'date\').value === \'\'', '{}');
        expect(out).toMatchObject({ acted: true, focus: 'name' });
        expect(String(out.card)).toContain('新しい名前');
    });

    it('the name typed, the details tab: the tab chosen, the name in the draft', () => {
        const out = pressed('draft name, tab', 'nameInput()', '新しい名前', 'hubTab(hub(), \'detail\')', 'hubTabOn(hub()) === \'detail\'', '{}');
        expect(out).toMatchObject({ acted: true, focus: 'tab detail' });
        expect(String(out.card)).toContain('新しい名前');
    });

    it('the name typed, the button that shows or hides the line above the create: it flips, the name in the draft, the focus in the name', () => {
        const out = run<Record<string, unknown>>('draft name, create toggle', `
            await openDraft();
            const before = createToggle().getAttribute('aria-expanded');
            typeIn(nameInput(), '新しい名前');
            watch();
            press(createToggle());
            const acted = await saw(() => createToggle().getAttribute('aria-expanded') !== before);
            return JSON.stringify({ acted, ...(await settled()), focus: focusNow(), card: card()?.textContent ?? null });
        `);
        expect(out).toMatchObject({ acted: true, focus: 'name' });
        expect(String(out.card)).toContain('新しい名前');
    });

    it('a tag typed, a property\'s menu button: the menu open once, the tag added', () => {
        const out = pressed('draft tag, …', 'tagInput()', 'zz', 'moreOf(\'note1\')', 'R.menus > 0', '{ tags: tagChips() }');
        expect(out).toMatchObject({ acted: true, menus: 1, tags: ['#tg', '#zz'] });
    });

    it('a tag typed, a property\'s value ×: the value made none, the tag added', () => {
        const out = pressed('draft tag, value ×', 'tagInput()', 'zz', 'valueClear(\'note1\')', 'valueInput(\'note1\').value === \'\'', '{ tags: tagChips(), note1: valueInput(\'note1\').value }');
        expect(out).toMatchObject({ acted: true, tags: ['#tg', '#zz'], note1: '' });
    });

    it('a tag typed, a list\'s item ×: the item out, the tag added', () => {
        const out = pressed('draft tag, item ×', 'tagInput()', 'zz', 'itemClear(\'docs\', \'b\')', '!items(\'docs\').includes(\'b\')', '{ tags: tagChips(), docs: items(\'docs\') }');
        expect(out).toMatchObject({ acted: true, tags: ['#tg', '#zz'], docs: ['a'] });
    });

    it('a tag typed, the color\'s hide: the color hidden, the tag added', () => {
        const out = pressed('draft tag, hide', 'tagInput()', 'zz', 'hideColor()', 'colorHidden()', '{ tags: tagChips() }');
        expect(out).toMatchObject({ acted: true, tags: ['#tg', '#zz'] });
    });

    it('a color typed, a tag\'s ×: the tag out, the color put in', () => {
        const out = pressed('draft color, tag ×', 'colorInput()', 'blue', 'tagRemove(\'tg\')', '!tagChips().includes(\'#tg\')', '{ tags: tagChips(), color: colorInput().value }');
        expect(out).toMatchObject({ acted: true, tags: [], color: 'blue', focus: 'color' });
    });

    it('a property\'s value typed, a tag\'s ×: the tag out, the value put in', () => {
        const out = pressed('draft value, tag ×', 'valueInput(\'note1\')', 'mm', 'tagRemove(\'tg\')', '!tagChips().includes(\'#tg\')', '{ tags: tagChips(), note1: valueInput(\'note1\').value }');
        expect(out).toMatchObject({ acted: true, tags: [], note1: 'mm', focus: 'value note1' });
    });

    it('a property\'s value typed, the color\'s hide: the color hidden, the value put in', () => {
        const out = pressed('draft value, hide', 'valueInput(\'note1\')', 'mm', 'hideColor()', 'colorHidden()', '{ note1: valueInput(\'note1\').value }');
        expect(out).toMatchObject({ acted: true, note1: 'mm', focus: 'value note1' });
    });
});

describe('a button of another part pressed with a field typed in, on a row', () => {
    it('a tag typed, a property\'s menu button: the menu open once, and open still once the write came back', () => {
        const out = run<Record<string, unknown>>('row tag, …', `
            await openRow('親', 'detail');
            typeIn(tagInput(), 'zz');
            watch();
            press(moreOf('memo'));
            const acted = await saw(() => R.menus > 0);
            await saw(() => rowTask('親').tags.includes('zz'));
            const seen = await settled(() => ({ tags: tagChips(), menu: menuTitles() }));
            closeMenus();
            return JSON.stringify({ acted, ...seen, focus: focusNow() });
        `);
        expect(out).toMatchObject({ acted: true, menus: 1, tags: ['#zz'], menu: [tr('modal.hub.typeText'), tr('modal.hub.toList'), tr('modal.hub.deleteProperty')], writes: 1 });
    });

    it('a color typed, a list\'s item ×: both written, the item out of the list as it is once the color came back', () => {
        const out = run<Record<string, unknown>>('row color, item ×', `
            await openRow('親', 'detail');
            typeIn(colorInput(), 'blue');
            watch();
            press(itemClear('links', '議事録'));
            const acted = await saw(() => !items('links').includes('議事録'));
            await saw(() => rowTask('親').color === 'blue');
            return JSON.stringify({ acted, ...(await settled(() => ({ links: items('links'), color: colorInput().value }))), focus: focusNow() });
        `);
        expect(out).toMatchObject({ acted: true, links: ['企画書'], color: 'blue', writes: 2, focus: 'color' });
        expect(String(out.disk)).toContain('\t\t- 企画書\n\t- memo');
        expect(String(out.disk)).toContain('tv-color:: blue');
    });
});

describe('a button of another part pressed with a field typed in, in a move', () => {
    it('a tag typed, a property\'s menu button: the menu open once, the tag in the move\'s draft', () => {
        const out = run<Record<string, unknown>>('move tag, …', `
            await openMove('親');
            typeIn(tagInput(), 'zz');
            watch();
            press(moreOf('memo'));
            const acted = await saw(() => R.menus > 0);
            const seen = await settled(() => ({ tags: tagChips() }));
            closeMenus();
            return JSON.stringify({ acted, ...seen, focus: focusNow() });
        `);
        expect(out).toMatchObject({ acted: true, menus: 1, tags: ['#zz'], writes: 0 });
    });
});
