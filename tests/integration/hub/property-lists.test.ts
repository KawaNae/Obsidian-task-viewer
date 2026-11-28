/**
 * The hub's lists, in the running E2E vault: a custom property's list is
 * shown an item a line, each item edited, taken out, added and moved, and
 * every edit writes the list as its block of the note. An item that would
 * not read back as one is said under the row and not written. An inherited
 * list is shown as chips and not edited, and written as the row's own, its
 * items copied, by its menu at once. A list, the row's own over an
 * inherited one or inherited, is made no value by its menu, and the row's
 * own is taken out by "Clear and follow inherited value". A text value is
 * converted to a list of it, and a list of one item to its text, by the
 * row's menu, whose head says the value's type greyed. A value an Enter
 * wrote, the field keeping the focus, is drawn and offered by the menu as
 * the row is now.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/property-lists.test.ts
 */
import { describe, it, expect, afterAll, afterEach, beforeEach } from 'vitest';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { DIALOG_ROWS } from '../helpers/dialog-rows';
import { MENUS } from '../helpers/menus';
import { tr } from '../helpers/view-helper';

const TEST_FILE = 'test-int-hub-property-lists.md';

const LINES = [
    '# 見出し',
    '- area::',
    '\t- lab',
    '\t- home',
    '- [ ] 親 @2026-10-01',
    '\t- k::',
    '\t\t- a',
    '\t\t- b',
    '\t- memo:: x',
    '- [ ] 次',
    '',
];

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
${DIALOG_ROWS}
${MENUS}
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const rowOf = label => [...hub().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === label);
const items = key => [...rowOf(key).querySelectorAll('.task-hub__list-items .task-hub__list-item input')];
const addItem = key => rowOf(key).querySelector('.task-hub__list-add');
/** The titles of the menu of the property's row \`key\`, the menu closed again. */
const menuOf = key => { rowOf(key).querySelector('button.tv-form__menu-button').click(); const titles = menuTitles(); closeMenus(); return titles; };
/** Choose the item titled \`title\` from the menu of the property's row \`key\`. */
const pickOf = (key, title) => { rowOf(key).querySelector('button.tv-form__menu-button').click(); menuItem(i => i.titleEl?.textContent === title); };
const nameInput = () => hub().querySelector('.tv-form__name-section input');
const says = row => [...row.nextElementSibling.children].map(c => c.className + ': ' + c.firstChild.textContent);
const type = (input, text) => { chooseTabOf(input).focus(); input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
const enter = async input => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(600); };
const leave = async input => { input.dispatchEvent(new FocusEvent('blur')); await sleep(600); };
`;

function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

function openHub(name: string): void {
    run(`
        const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(${JSON.stringify(name)}));
        if (!task) throw new Error('no row ' + ${JSON.stringify(name)});
        plugin.openTaskHub(task.id);
        await until(() => hub() && nameInput());
        return 'ok';
    `);
}

function closeHub(): void {
    run(`
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
        await sleep(100);
        formRow(hub())?.querySelector('.tv-form__discard')?.click();
        await until(() => !hub());
        return 'ok';
    `);
}

/** The note with lines `from` up to `to` (0-indexed) put in place of what they were. */
function withLines(from: number, to: number, ...lines: string[]): string {
    const out = [...LINES];
    out.splice(from, to - from, ...lines);
    return out.join('\n');
}

beforeEach(async () => { await writeIndexedTestFile(TEST_FILE, LINES.join('\n')); });
afterEach(() => { closeHub(); });

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('the hub edits a list item by item', () => {
    it('shows the row\'s own list an item an input, and an inherited one as items not edited', () => {
        openHub('親');
        const shown = run<Record<string, unknown>>(`
            return JSON.stringify({
                own: items('k').map(i => i.value),
                add: !!addItem('k'),
                inherited: [...rowOf('area').querySelectorAll('.task-hub__list-chip')].map(c => c.textContent),
                inheritedInputs: rowOf('area').querySelectorAll('input').length,
                inheritedMenu: menuOf('area'),
            });
        `);
        expect(shown).toEqual({
            own: ['a', 'b'], add: true, inherited: ['lab', 'home'], inheritedInputs: 0,
            inheritedMenu: [
                tr('modal.hub.typeList'), tr('modal.hub.fromSection'), tr('modal.hub.inheritedValue', { value: ['lab', 'home'].join(tr('modal.hub.itemJoin')) }),
                tr('modal.hub.openInheritedLine'), tr('modal.hub.writeInherited'), tr('modal.hub.setNoValue'),
            ],
        });
    });

    it('shows a × in each item\'s field and none for the list whole, the row\'s menu button in the add field\'s box, and the inherited chips on the key\'s line with the menu button at their end', () => {
        openHub('親');
        const shown = run<Record<string, unknown>>(`
            const top = el => Math.round(el.getBoundingClientRect().top);
            const own = rowOf('k');
            const more = own.querySelector('button.tv-form__menu-button');
            const inherited = rowOf('area');
            const label = inherited.querySelector('.tv-form__label').getBoundingClientRect();
            const chips = inherited.querySelector('.task-hub__list-chips').getBoundingClientRect();
            return JSON.stringify({
                itemXs: [...own.querySelectorAll('.task-hub__list-item .tv-form__clear-button')].map(x => x.getAttribute('aria-label')),
                addX: !!own.querySelector('.task-hub__list-item--add .tv-form__clear-button'),
                ownMenu: menuOf('k'),
                moreInAddBox: more.parentElement === own.querySelector('.task-hub__list-add').parentElement && more.parentElement.classList.contains('task-hub__list-item-box'),
                moreLabel: more.getAttribute('aria-label'),
                chipsBesideKey: chips.left >= label.right && Math.abs(top(inherited.querySelector('.task-hub__list-chip')) - top(inherited)) < 12,
                inheritedMore: !!inherited.querySelector('.task-hub__list-chips .tv-form__menu-button--inline'),
                inheritedXs: inherited.querySelectorAll('.tv-form__clear-button').length,
            });
        `);
        expect(shown).toEqual({
            itemXs: [tr('modal.hub.removeItem', { item: 'a' }), tr('modal.hub.removeItem', { item: 'b' })],
            addX: false,
            ownMenu: [tr('modal.hub.typeList'), tr('modal.hub.deleteKey')],
            moreInAddBox: true,
            moreLabel: tr('modal.hub.fieldMenu', { field: 'k' }),
            chipsBesideKey: true,
            inheritedMore: true,
            inheritedXs: 0,
        });
    });

    it('makes the inherited list no value from its menu, and the row\'s own list taken out from its menu', () => {
        openHub('親');
        run(`pickOf('area', ${JSON.stringify(tr('modal.hub.setNoValue'))}); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(9, 9, '\t- area::'));
        run(`pickOf('k', ${JSON.stringify(tr('modal.hub.deleteKey'))}); await sleep(600); return 'ok';`);
        const out = [...LINES];
        out.splice(9, 0, '\t- area::');
        out.splice(5, 3);
        expect(readTestFile(TEST_FILE)).toBe(out.join('\n'));
    });

    it('writes an item typed over in its place', () => {
        openHub('親');
        run(`type(items('k')[0], 'c'); await leave(items('k')[0]); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(6, 7, '\t\t- c'));
    });

    it('adds an item at the end, keeping the focus to add another', () => {
        openHub('親');
        const focused = run<boolean>(`type(addItem('k'), '"123"'); await enter(addItem('k')); return document.activeElement === addItem('k');`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(8, 8, '\t\t- "123"'));
        expect(focused).toBe(true);
    });

    it('takes an item out by its ×, and with the last one leaves the line with no value', () => {
        openHub('親');
        run(`items('k')[1].closest('.task-hub__list-item').querySelector('.tv-form__clear-button').click(); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(7, 8));
        run(`items('k')[0].closest('.task-hub__list-item').querySelector('.tv-form__clear-button').click(); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(6, 8));
    });

    it('converts a text value to a list of it from its menu, its type said greyed at the head, the focus put in no input', () => {
        openHub('親');
        const shown = run<Record<string, unknown>>(`
            rowOf('memo').querySelector('button.tv-form__menu-button').click();
            const head = menuItems().slice(0, 1).map(i => [i.titleEl?.textContent, !!i.disabled]);
            const menu = menuTitles();
            closeMenus();
            pickOf('memo', ${JSON.stringify(tr('modal.hub.toList'))});
            await sleep(600);
            return JSON.stringify({ head, menu, items: items('memo').map(i => i.value), inInput: document.activeElement instanceof HTMLInputElement });
        `);
        expect(shown).toEqual({
            head: [[tr('modal.hub.typeText'), true]],
            menu: [tr('modal.hub.typeText'), tr('modal.hub.toList'), tr('modal.hub.deleteKey')],
            items: ['x'],
            inInput: false,
        });
        expect(readTestFile(TEST_FILE)).toBe(withLines(8, 9, '\t- memo::', '\t\t- x'));
    });

    it('converts a list of one item to the item as its text value from its menu', () => {
        openHub('親');
        run(`items('k')[1].closest('.task-hub__list-item').querySelector('.tv-form__clear-button').click(); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(7, 8));
        const shown = run<Record<string, unknown>>(`
            const menu = menuOf('k');
            pickOf('k', ${JSON.stringify(tr('modal.hub.toSingleValue'))});
            await sleep(600);
            return JSON.stringify({ menu, value: rowOf('k').querySelector('input.task-hub__value')?.value ?? null });
        `);
        expect(shown).toEqual({
            menu: [tr('modal.hub.typeList'), tr('modal.hub.toSingleValue'), tr('modal.hub.deleteKey')],
            value: 'a',
        });
        expect(readTestFile(TEST_FILE)).toBe(withLines(5, 8, '\t- k:: a'));
    });

    it('leaves the focus where it was when an item is taken out', () => {
        openHub('親');
        const removeOf = `i => items('k')[i].closest('.task-hub__list-item').querySelector('.tv-form__clear-button')`;
        const focus = run<Record<string, unknown>>(`
            const removeAt = ${removeOf};
            document.activeElement?.blur();
            removeAt(1).click();
            await sleep(600);
            const outside = !rowOf('k').contains(document.activeElement);
            type(addItem('k'), 'c');
            await enter(addItem('k'));
            removeAt(0).click();
            await sleep(600);
            return JSON.stringify({ outside, add: document.activeElement === addItem('k') });
        `);
        expect(focus).toEqual({ outside: true, add: true });
        expect(readTestFile(TEST_FILE)).toBe(withLines(6, 8, '\t\t- c'));
    });

    it('puts the focus in the add field when an item emptied is written by Enter, and leaves it where it goes on leaving the item', () => {
        openHub('親');
        const entered = run<boolean>(`type(items('k')[0], ''); await enter(items('k')[0]); return document.activeElement === addItem('k');`);
        expect(entered).toBe(true);
        expect(readTestFile(TEST_FILE)).toBe(withLines(6, 7));
        const left = run<boolean>(`type(items('k')[0], ''); chooseTabOf(nameInput()).focus(); await sleep(600); return document.activeElement === nameInput();`);
        expect(left).toBe(true);
        // The last item emptied leaves the line with no value.
        expect(readTestFile(TEST_FILE)).toBe(withLines(6, 8));
    });

    it('follows the focus to the next item when an item typed over is written on leaving it', () => {
        openHub('親');
        const next = run<boolean>(`type(items('k')[0], 'c'); chooseTabOf(items('k')[1]).focus(); await sleep(600); return document.activeElement === items('k')[1];`);
        expect(next).toBe(true);
        expect(readTestFile(TEST_FILE)).toBe(withLines(6, 7, '\t\t- c'));
    });

    it('moves an item by Alt+Down, and by dragging its handle', () => {
        openHub('親');
        run(`
            chooseTabOf(items('k')[0]).focus();
            items('k')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
            await sleep(600);
            return 'ok';
        `);
        expect(readTestFile(TEST_FILE)).toBe(withLines(6, 8, '\t\t- b', '\t\t- a'));
        run(`
            const handle = items('k')[1].closest('.task-hub__list-item').querySelector('.task-hub__list-handle');
            const first = items('k')[0].closest('.task-hub__list-item').getBoundingClientRect();
            handle.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, clientY: first.bottom + 10 }));
            document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: first.top + 1 }));
            document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: first.top + 1 }));
            await sleep(600);
            return 'ok';
        `);
        expect(readTestFile(TEST_FILE)).toBe(LINES.join('\n'));
    });

    it('says an item a line would not read back as one under the row, and writes nothing', () => {
        openHub('親');
        const said = run<string[]>(`type(addItem('k'), 'null'); await enter(addItem('k')); return JSON.stringify(says(rowOf('k')));`);
        expect(readTestFile(TEST_FILE)).toBe(LINES.join('\n'));
        expect(said).toHaveLength(1);
        expect(said[0]).toMatch(/^tv-form__error/);
    });

    it('writes an inherited list as the row\'s own from its menu at once, leaving the focus out of its inputs', () => {
        openHub('親');
        const inInput = run<boolean>(`pickOf('area', ${JSON.stringify(tr('modal.hub.writeInherited'))}); await sleep(600); return document.activeElement instanceof HTMLInputElement;`);
        expect(inInput).toBe(false);
        expect(readTestFile(TEST_FILE)).toBe(withLines(9, 9, '\t- area::', '\t\t- lab', '\t\t- home'));
        const shown = run<string[]>(`return JSON.stringify(items('area').map(i => i.value));`);
        expect(shown).toEqual(['lab', 'home']);
        run(`type(addItem('area'), 'desk'); await enter(addItem('area')); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(9, 9, '\t- area::', '\t\t- lab', '\t\t- home', '\t\t- desk'));
    });

    it('takes the line out of a list written from the inherited one by "Clear and follow inherited value", the chips back', () => {
        openHub('親');
        run(`pickOf('area', ${JSON.stringify(tr('modal.hub.writeInherited'))}); await sleep(600); return 'ok';`);
        const shown = run<Record<string, unknown>>(`
            const menu = menuOf('area');
            pickOf('area', ${JSON.stringify(tr('modal.hub.clearToInherited'))});
            await sleep(600);
            return JSON.stringify({ menu, inputs: rowOf('area').querySelectorAll('input').length, chips: rowOf('area').querySelectorAll('.task-hub__list-chip').length });
        `);
        expect(shown).toEqual({
            menu: [
                tr('modal.hub.typeList'), tr('modal.hub.fromSection'), tr('modal.hub.inheritedValue', { value: ['lab', 'home'].join(tr('modal.hub.itemJoin')) }), tr('modal.hub.inheritedOverridden'),
                tr('modal.hub.openInheritedLine'), tr('modal.hub.setNoValue'), tr('modal.hub.clearToInherited'),
            ],
            inputs: 0,
            chips: 2,
        });
        expect(readTestFile(TEST_FILE)).toBe(LINES.join('\n'));
    });

    it('converts the value an Enter wrote, the field keeping the focus, from the menu opened once the focus has gone to another field', () => {
        openHub('親');
        const kept = run<boolean>(`
            const input = rowOf('memo').querySelector('input.task-hub__value');
            type(input, 'zq7');
            await enter(input);
            return document.activeElement === input && rowOf('memo').querySelector('input.task-hub__value') === input;
        `);
        expect(kept).toBe(true);
        expect(readTestFile(TEST_FILE)).toBe(withLines(8, 9, '\t- memo:: zq7'));
        run(`chooseTabOf(nameInput()).focus(); await sleep(600); pickOf('memo', ${JSON.stringify(tr('modal.hub.toList'))}); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(8, 9, '\t- memo::', '\t\t- zq7'));
    });
});

describe('an inherited text an Enter makes the row\'s own', () => {
    const INHERITED = ['# 見出し', '- place:: home', '- [ ] 親 @2026-10-01', '- [ ] 次', ''];

    beforeEach(async () => { await writeIndexedTestFile(TEST_FILE, INHERITED.join('\n')); });

    it('is drawn as the row\'s own at once, the field keeping the focus, and its menu offers to clear it and follow the inherited value', () => {
        openHub('親');
        const shown = run<Record<string, unknown>>(`
            const input = rowOf('place').querySelector('input.task-hub__value');
            type(input, 'zq8');
            await enter(input);
            const row = rowOf('place');
            const look = { focused: document.activeElement === input, dashed: row.querySelector('.task-hub__value-box').classList.contains('tv-form__control--inherited') };
            chooseTabOf(nameInput()).focus();
            await sleep(600);
            return JSON.stringify({ ...look, menu: menuOf('place') });
        `);
        expect(shown).toEqual({
            focused: true,
            dashed: false,
            menu: [
                tr('modal.hub.typeText'), tr('modal.hub.fromSection'), tr('modal.hub.inheritedValue', { value: 'home' }), tr('modal.hub.inheritedOverridden'),
                tr('modal.hub.openInheritedLine'), tr('modal.hub.toList'), tr('modal.hub.setNoValue'), tr('modal.hub.clearToInherited'),
            ],
        });
        const lines = [...INHERITED];
        lines.splice(3, 0, '\t- place:: zq8');
        expect(readTestFile(TEST_FILE)).toBe(lines.join('\n'));
    });
});
