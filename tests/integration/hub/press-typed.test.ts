/**
 * A button of the hub pressed with the mouse while a text field holds the
 * focus, in the running E2E vault: the button takes no focus, what the field
 * holds typed is written first as its Enter writes it, and the button acts
 * as it is drawn once the write has built it anew. The field keeps the
 * focus.
 *
 * - A list's item × pressed with an item typed in the list's add field: the
 *   item typed is added and the item pressed taken out, the add field empty
 *   and in focus. On a task not written yet too, its draft holding them.
 * - A text value's × pressed with a key and a value typed in the add row:
 *   the property added, the value pressed made none, the focus in the add
 *   row's key.
 * - A text value's × pressed with another text value typed over: both
 *   written, the focus in the field typed in; nothing typed, the focus
 *   stays all the same.
 * - The close pressed near its lower edge with a key typed in the add row:
 *   the hub closes, the key written once. The row the commit of a blur
 *   would add makes the panel taller and moves the close from under the
 *   mouse.
 * - A row's menu button pressed with its value typed over: the value
 *   written, the menu open.
 * - A date that does not read, typed: another date's × does not act, the
 *   focus and why staying with the date. A tab is chosen all the same.
 * - The add row's Enter: the property added, the focus in its key.
 * - A text being converted by the IME (driven through the DevTools
 *   protocol): written once as the field's value, the conversion going on
 *   in a text value, and its end writing nothing more. A list's add field is
 *   built anew empty, the conversion going with the field it was in; the
 *   field left writes nothing more.
 *
 * The hub is opened on its name and the focus waited for there: until the
 * panel has come in, it takes the focus itself, from a field typed in too.
 *
 * Every press is the mouse's, through Electron (`REAL_INPUT`): its
 * mousedown is what took the focus from the field, and the blur that wrote
 * before the click. Nothing is typed by keys before a press, and the field
 * is never left, so no Enter, Tab or blur writes what is typed. The writes
 * the hub asks of the note are counted at `app.vault.process`.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/press-typed.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { DIALOG_ROWS } from '../helpers/dialog-rows';
import { MENUS } from '../helpers/menus';
import { REAL_INPUT } from '../helpers/real-input';

const TEST_FILE = 'test-int-hub-press-typed.md';

const LINES = [
    '# 見出し',
    '- [ ] 親 @2026-10-01>2026-10-03',
    '\t- links::',
    '\t\t- 企画書',
    '\t\t- 議事録',
    '\t- memo:: 短い',
    '\t- summary:: 資料',
    '- [ ] 次',
    '',
];

/** A day far off, whose daily note is never made: the draft is not created. */
const DRAFT_DAY = '2031-04-07';

const PRELUDE = `
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const FILE = ${JSON.stringify(TEST_FILE)};
const R = (window.__tvPressTypedE2E ??= {});
${UNTIL}
${DIALOG_ROWS}
${MENUS}
${REAL_INPUT}
const nextFrame = () => new Promise(r => requestAnimationFrame(r));
const shown = el => !!el && getComputedStyle(el).display !== 'none';
const overlays = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing)')];
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const rowOf = label => [...hub().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === label);
const valueInput = key => rowOf(key).querySelector('input.task-hub__value');
const valueClear = key => rowOf(key).querySelector('.task-hub__value-box .tv-form__clear-button');
const items = key => [...rowOf(key).querySelectorAll('.task-hub__list-items .task-hub__list-item input')].map(i => i.value);
const itemClear = (key, item) => [...rowOf(key).querySelectorAll('.task-hub__list-items .task-hub__list-item')]
    .find(el => el.querySelector('input')?.value === item).querySelector('.tv-form__clear-button');
const addItem = key => rowOf(key).querySelector('.task-hub__list-add');
const addKey = () => hub().querySelector('.task-hub__prop-add .tv-form__label input');
const addValue = () => hub().querySelector('.task-hub__prop-add input.tv-form__control');
const dateInput = (label, which) => rowOf(label).querySelector('.tv-form__field--' + which + ' input.tv-ctrl__text-input');
const dateClear = (label, which) => rowOf(label).querySelector('.tv-form__field--' + which + ' .tv-form__clear-button');
const says = input => [...input.closest('.tv-form__row').nextElementSibling.children].map(c => c.className.split(' ')[0]);
const focusIn = input =>{ chooseTabOf(input).focus(); return input; };
/** Typed as a person types, the text and then its input event, the field not left. */
const typeIn = (input, text) => { focusIn(input); input.value = text; input.setSelectionRange(text.length, text.length); input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
const disk = () => app.vault.adapter.read(FILE);
const nameInput = () => hub()?.querySelector('.tv-form__name-section input') ?? null;
/**
 * Wait for the hub's first focus, on its name: until the panel has come in,
 * the panel takes the focus from wherever it is, a field typed in too.
 */
const opened = () => until(() => nameInput() && document.activeElement === nameInput());
/** The row's hub, opened and on the tab \`tab\`. */
const openRow = async (name, tab = 'basic') => {
    const task = plugin.getIndex().getTasks().find(t => t.file === FILE && t.content.startsWith(name));
    if (!task) throw new Error('no row ' + name);
    plugin.openTaskHub(task.id, { focusField: 'name' });
    await opened();
    if (hubTabOn(hub()) !== tab) chooseHubTab(hub(), tab);
    await until(() => hubTabOn(hub()) === tab);
};
/** Count the writes asked of the note from now on. */
const watchWrites = () => {
    const real = app.vault.process;
    R.writes = [];
    R.unwatch = () => { app.vault.process = real; delete R.unwatch; };
    app.vault.process = function (file, ...rest) {
        const done = real.call(this, file, ...rest);
        if (file?.path === FILE) R.writes.push(done);
        return done;
    };
};
/** The writes asked so far, once they are done, and the note as they left it. */
const written = async () => {
    await nextFrame();
    await nextFrame();
    await Promise.allSettled(R.writes);
    return { writes: R.writes.length, disk: await disk() };
};
/** What \`read\` reads once the writes asked so far are done and the hub is drawn from them, with the writes. */
const settled = async read => {
    const done = await written();
    await nextFrame();
    return { ...read(), ...done };
};
/**
 * The IME, driven through the DevTools protocol in the field in focus:
 * \`convert(text)\` puts \`text\` in it as being converted, underlined;
 * \`finish(text)\` ends the conversion on \`text\`, as a person's choice does,
 * or puts it in as typed when nothing is being converted. The data of the
 * compositionend events the window hears go to \`R.ends\`.
 */
const ime = () => {
    const debug = require('electron').remote.getCurrentWebContents().debugger;
    if (!debug.isAttached()) debug.attach('1.3');
    R.ends = [];
    const onEnd = e => R.ends.push(e.data);
    window.addEventListener('compositionend', onEnd, true);
    R.undebug = () => { window.removeEventListener('compositionend', onEnd, true); if (debug.isAttached()) debug.detach(); delete R.undebug; };
    return {
        convert: text => debug.sendCommand('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length }),
        finish: text => debug.sendCommand('Input.insertText', { text }),
    };
};
/** Close every overlay, throwing away what a hub asks about, and the menu. */
const cleanUp = async () => {
    R.unwatch?.();
    R.undebug?.();
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

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
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
afterEach(() => { run(`await cleanUp(); return 'ok';`); });

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('a button pressed with another field typed in', () => {
    it('a list\'s item ×, an item typed in the list\'s add field: the item typed added, the item pressed out, the add field empty and in focus', () => {
        const out = run<Record<string, unknown>>(`
            await openRow('親', 'detail');
            typeIn(addItem('links'), 'zz');
            watchWrites();
            press(itemClear('links', '議事録'));
            await until(() => !items('links').includes('議事録'), 3000, () => items('links').join('|'));
            return JSON.stringify(await settled(() => ({ items: items('links'), add: addItem('links').value, focused: document.activeElement === addItem('links') })));
        `);
        expect(out).toEqual({ items: ['企画書', 'zz'], add: '', focused: true, writes: 2, disk: withLines(3, 5, '\t\t- 企画書', '\t\t- zz') });
    });

    it('a text value\'s ×, a key and a value typed in the add row: the property added, the value pressed made none, the focus in the add row\'s key', () => {
        const out = run<Record<string, unknown>>(`
            await openRow('親', 'detail');
            typeIn(addKey(), 'newkey');
            typeIn(addValue(), 'v');
            watchWrites();
            press(valueClear('memo'));
            await until(() => rowOf('newkey') && valueInput('memo').value === '', 3000, () => 'memo ' + valueInput('memo').value);
            return JSON.stringify(await settled(() => ({ added: valueInput('newkey').value, add: [addKey().value, addValue().value], focused: document.activeElement === addKey() })));
        `);
        expect(out).toEqual({ added: 'v', add: ['', ''], focused: true, writes: 2, disk: withLines(5, 7, '\t- memo::', '\t- summary:: 資料', '\t- newkey:: v') });
    });

    it('a text value\'s ×, another text value typed over: both written, the focus in the field typed in', () => {
        const out = run<Record<string, unknown>>(`
            await openRow('親', 'detail');
            typeIn(valueInput('summary'), '資料XX');
            watchWrites();
            press(valueClear('memo'));
            await until(() => valueInput('memo').value === '', 3000, () => 'memo ' + valueInput('memo').value);
            return JSON.stringify(await settled(() => ({ summary: valueInput('summary').value, focused: document.activeElement === valueInput('summary') })));
        `);
        expect(out).toEqual({ summary: '資料XX', focused: true, writes: 2, disk: withLines(5, 7, '\t- memo::', '\t- summary:: 資料XX') });
    });

    it('a text value\'s ×, another field in focus with nothing typed: the focus stays in the field', () => {
        const out = run<Record<string, unknown>>(`
            await openRow('親', 'detail');
            focusIn(valueInput('memo'));
            watchWrites();
            press(valueClear('summary'));
            await until(() => valueInput('summary').value === '', 3000, () => 'summary ' + valueInput('summary').value);
            return JSON.stringify(await settled(() => ({ focused: document.activeElement === valueInput('memo') })));
        `);
        expect(out).toEqual({ focused: true, writes: 1, disk: withLines(6, 7, '\t- summary::') });
    });

    it('the close pressed near its lower edge, a key typed in the add row: the hub closes, the key written once', () => {
        const out = run<Record<string, unknown>>(`
            await openRow('次', 'detail');
            typeIn(addKey(), 'k2');
            const close = hub().closest('.tv-overlay').querySelector('.tv-overlay__close');
            watchWrites();
            // 4px above its lower edge, held as a person holds a click: a row added while the button
            // is down moves that part of the close out from under the mouse before it goes up.
            await press(close, { dy: close.getBoundingClientRect().height / 2 - 4, holdMs: 100 });
            await until(() => !hub(), 3000, () => 'open, the focus on ' + document.activeElement?.className);
            return JSON.stringify(await written());
        `);
        expect(out).toEqual({ writes: 1, disk: withLines(8, 8, '\t- k2::') });
    });

    it('a row\'s menu button, its value typed over: the value written, the menu open', () => {
        const out = run<Record<string, unknown>>(`
            await openRow('親', 'detail');
            typeIn(valueInput('summary'), '資料XX');
            watchWrites();
            press(rowOf('summary').querySelector('.task-hub__prop-more'));
            await until(() => menuTitles().length > 0, 3000, () => 'no menu');
            const menu = menuTitles();
            closeMenus();
            return JSON.stringify(await settled(() => ({ menu })));
        `);
        expect(out).toEqual({
            menu: [tr('modal.hub.typeText'), tr('modal.hub.toList'), tr('modal.hub.deleteProperty')],
            writes: 1,
            disk: withLines(6, 7, '\t- summary:: 資料XX'),
        });
    });

    it('a date\'s ×, a date that does not read typed: the × does not act, the focus and why staying with the date; a tab chosen all the same', () => {
        const out = run<Record<string, unknown>>(`
            await openRow('親');
            const start = () => dateInput(${JSON.stringify(tr('modal.start'))}, 'date');
            const end = () => dateInput(${JSON.stringify(tr('modal.end'))}, 'date');
            typeIn(start(), 'あした');
            watchWrites();
            press(dateClear(${JSON.stringify(tr('modal.end'))}, 'date'));
            await until(() => says(start()).length > 0, 3000, () => 'nothing said, the focus on ' + document.activeElement?.className);
            const refused = await settled(() => ({ end: end().value, start: start().value, focused: document.activeElement === start(), says: says(start()) }));
            press(hubTab(hub(), 'detail'));
            await until(() => hubTabOn(hub()) === 'detail', 3000, () => 'on ' + hubTabOn(hub()));
            const tab = await settled(() => ({ focused: document.activeElement === hubTab(hub(), 'detail'), start: start().value }));
            return JSON.stringify({ refused, tab });
        `);
        expect(out.refused).toEqual({ end: '2026-10-03', start: 'あした', focused: true, says: ['tv-form__error'], writes: 0, disk: LINES.join('\n') });
        expect(out.tab).toEqual({ focused: true, start: 'あした', writes: 0, disk: LINES.join('\n') });
    });
});

describe('the add row\'s Enter', () => {
    it('adds the property, the focus in the add row\'s key', () => {
        const out = run<Record<string, unknown>>(`
            await openRow('親', 'detail');
            typeIn(addKey(), 'k3');
            typeIn(addValue(), 'v3');
            watchWrites();
            keys('Enter');
            await until(() => rowOf('k3'), 3000, () => 'no row k3');
            return JSON.stringify(await settled(() => ({ add: [addKey().value, addValue().value], focused: document.activeElement === addKey() })));
        `);
        expect(out).toEqual({ add: ['', ''], focused: true, writes: 1, disk: withLines(7, 7, '\t- k3:: v3') });
    });
});

describe('a button pressed on a task not written yet', () => {
    it('a list\'s item ×, an item typed in the list\'s add field: the draft holds the item typed and not the item pressed, the add field empty and in focus', () => {
        const out = run<Record<string, unknown>>(`
            const text = t => ({ type: 'text', text: t, spelling: t });
            const properties = { links: { key: 'links', value: { type: 'list', items: [text('企画書'), text('議事録')] } } };
            plugin.openDraftHub(plugin.getCreatePlaces().dailyNote(${JSON.stringify(DRAFT_DAY)}), { startDate: ${JSON.stringify(DRAFT_DAY)}, properties });
            await opened();
            typeIn(addItem('links'), 'zz');
            press(itemClear('links', '議事録'));
            await until(() => !items('links').includes('議事録'), 3000, () => items('links').join('|'));
            return JSON.stringify({ items: items('links'), add: addItem('links').value, focused: document.activeElement === addItem('links') });
        `);
        expect(out).toEqual({ items: ['企画書', 'zz'], add: '', focused: true });
    });
});

describe('a button pressed as the IME converts', () => {
    it('in a text value, the value with the text being converted written once, the conversion going on; its end and the field left write nothing more', () => {
        const out = run<Record<string, unknown>>(`
            await openRow('親', 'detail');
            focusIn(valueInput('summary')).setSelectionRange(2, 2);
            const { convert, finish } = ime();
            await convert('かい');
            await until(() => valueInput('summary').value === '資料かい', 3000, () => 'value ' + valueInput('summary').value);
            watchWrites();
            press(valueClear('memo'));
            await until(() => valueInput('memo').value === '', 3000, () => 'memo ' + valueInput('memo').value);
            const pressed = await settled(() => ({ summary: valueInput('summary').value, focused: document.activeElement === valueInput('summary'), ends: [...R.ends] }));
            await finish('かい');
            await until(() => R.ends.length > 0, 3000, () => 'no compositionend');
            const ended = await settled(() => ({ summary: valueInput('summary').value, ends: [...R.ends] }));
            valueInput('summary').blur();
            const left = await settled(() => ({}));
            return JSON.stringify({ pressed, ended, left });
        `);
        const disk = withLines(5, 7, '\t- memo::', '\t- summary:: 資料かい');
        expect(out.pressed).toEqual({ summary: '資料かい', focused: true, ends: [], writes: 2, disk });
        expect(out.ended).toEqual({ summary: '資料かい', ends: ['かい'], writes: 2, disk });
        expect(out.left).toEqual({ writes: 2, disk });
    });

    it('in a list\'s add field, the item being converted added once, the field built anew empty and in focus; the field left writes nothing more', () => {
        const out = run<Record<string, unknown>>(`
            await openRow('親', 'detail');
            focusIn(addItem('links'));
            const { convert } = ime();
            await convert('かい');
            await until(() => addItem('links').value === 'かい', 3000, () => 'value ' + addItem('links').value);
            watchWrites();
            press(itemClear('links', '議事録'));
            await until(() => !items('links').includes('議事録'), 3000, () => items('links').join('|'));
            const pressed = await settled(() => ({ items: items('links'), add: addItem('links').value, focused: document.activeElement === addItem('links') }));
            addItem('links').blur();
            const left = await settled(() => ({ items: items('links') }));
            return JSON.stringify({ pressed, left });
        `);
        const disk = withLines(3, 5, '\t\t- 企画書', '\t\t- かい');
        expect(out.pressed).toEqual({ items: ['企画書', 'かい'], add: '', focused: true, writes: 2, disk });
        expect(out.left).toEqual({ items: ['企画書', 'かい'], writes: 2, disk });
    });
});
