/**
 * Hiding an inherited value in the hub, in the running E2E vault. A
 * property's row that inherits a value shows it as the empty field's
 * placeholder in a dashed box, and hides it by its menu ("Set to no value"),
 * which writes its own line with no value (`- key::`); the row then shows an
 * empty field with the value hidden struck through, and its menu takes the
 * line out again ("Follow inherited value"), so the value above comes
 * through. Emptying an inherited field writes nothing, and emptying an own
 * value over an inherited one takes the row's line out. A style's row does
 * all of this by its menu as the property fields do, and shows a no value a
 * section above wrote as they do: an empty field that says so, with the
 * line it is written on to open from the menu. A value written above the
 * first heading is hidden so too, its source said to be the file's in the
 * menu's head. The value hidden is struck through where the field's text
 * starts.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/property-hide.test.ts
 */
import { describe, it, expect, afterAll, afterEach, beforeEach } from 'vitest';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { DIALOG_ROWS } from '../helpers/dialog-rows';
import { MENUS } from '../helpers/menus';

const TEST_FILE = 'test-int-hub-property-hide.md';

const LINES = [
    '# 見出し',
    '- area:: lab',
    '- tv-color:: red',
    '- [ ] 親 @2026-10-01',
    '\t- memo:: x',
    '- [ ] 隠した @2026-10-01',
    '\t- area::',
    '\t- tv-mask::',
    '- [ ] 次',
    '## 隠す節',
    '- tv-color::',
    '- tv-mask::',
    '- [ ] 節の下',
    '',
];

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
${DIALOG_ROWS}
${MENUS}
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const rowOf = label => [...hub().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent.trim() === label);
const nameInput = () => hub().querySelector('.tv-form__name-section input');
const shown = el => !!el && getComputedStyle(el).display !== 'none';
/** Choose the item titled \`title\` from the menu of the property's row \`key\`. */
const pickIn = (row, title) => { row.querySelector('button.tv-form__menu-button').click(); menuItem(i => i.titleEl?.textContent === title); };
const pickOf = (key, title) => pickIn(rowOf(key), title);
const colorRow = () => hub().querySelector('.tv-form__input-with-picker--color').closest('.tv-form__row');
const maskRow = () => rowOf(${JSON.stringify(tr('modal.hub.mask'))});
/** The titles of the menu of the row's … button, the menu closed again. */
const menuOfRow = row => { row.querySelector('button.tv-form__menu-button').click(); const titles = menuTitles(); closeMenus(); return titles; };
const noteView = () => app.workspace.getLeavesOfType('markdown').map(l => l.view).find(v => v.file?.path === ${JSON.stringify(TEST_FILE)});
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

function withLines(from: number, to: number, ...lines: string[]): string {
    const out = [...LINES];
    out.splice(from, to - from, ...lines);
    return out.join('\n');
}

beforeEach(async () => { await writeIndexedTestFile(TEST_FILE, LINES.join('\n')); });
afterEach(() => {
    closeHub();
    run(`app.workspace.getLeavesOfType('markdown').filter(l => l.view.file?.path === ${JSON.stringify(TEST_FILE)}).forEach(l => l.detach()); return 'ok';`);
});

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('the hub hides an inherited value', () => {
    it('shows an inherited property as the empty field\'s placeholder in a dashed box, with no ×, and hides it by its menu, then shows the row\'s no value with the value hidden struck through', () => {
        openHub('親');
        const before = run<Record<string, unknown>>(`
            const row = rowOf('area');
            const input = row.querySelector('input');
            return JSON.stringify({
                value: input.value,
                placeholder: input.placeholder,
                frame: getComputedStyle(input).borderTopStyle,
                dashed: row.querySelector('.task-hub__value-box').classList.contains('tv-form__control--inherited'),
                x: !!row.querySelector('.tv-form__clear-button'),
                hide: !!row.querySelector('.task-hub__hide'),
            });
        `);
        expect(before).toEqual({ value: '', placeholder: 'lab', frame: 'dashed', dashed: true, x: false, hide: false });
        run(`pickOf('area', ${JSON.stringify(tr('modal.hub.setNoValue'))}); await sleep(600); return 'ok';`);
        const after = run<Record<string, unknown>>(`
            const row = rowOf('area');
            const input = row.querySelector('input');
            const struck = row.querySelector('.tv-form__struck');
            return JSON.stringify({
                value: input.value,
                placeholder: input.placeholder,
                struck: [struck.textContent, shown(struck)],
                dashed: row.querySelector('.task-hub__value-box').classList.contains('tv-form__control--inherited'),
            });
        `);
        expect(readTestFile(TEST_FILE)).toBe(withLines(5, 5, '\t- area::'));
        expect(after).toEqual({ value: '', placeholder: 'lab', struck: ['lab', true], dashed: false });
    });

    it('writes nothing when an inherited property\'s empty field is left as it is, and the typed value as the row\'s own when it is typed, even equal to the inherited', () => {
        openHub('親');
        run(`const input = rowOf('area').querySelector('input'); chooseTabOf(input).focus(); input.value = ''; input.dispatchEvent(new InputEvent('input', { bubbles: true })); input.dispatchEvent(new FocusEvent('blur')); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(LINES.join('\n'));
        run(`const input = rowOf('area').querySelector('input'); chooseTabOf(input).focus(); input.value = 'lab'; input.dispatchEvent(new InputEvent('input', { bubbles: true })); input.dispatchEvent(new FocusEvent('blur')); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(5, 5, '\t- area:: lab'));
    });

    it('shows an inherited color as the empty field\'s placeholder in a dashed box with its menu, hides it by the menu, then shows the hidden value struck through', () => {
        openHub('親');
        const before = run<Record<string, unknown>>(`
            const input = colorRow().querySelector('input.tv-ctrl__text-input');
            return JSON.stringify({
                value: input.value,
                placeholder: input.placeholder,
                dashed: colorRow().querySelector('.tv-form__input-with-picker--color').classList.contains('tv-form__control--inherited'),
                menu: menuOfRow(colorRow()),
            });
        `);
        expect(before).toEqual({
            value: '',
            placeholder: 'red',
            dashed: true,
            menu: [tr('modal.hub.fromSection'), tr('modal.hub.openInheritedLine'), tr('modal.hub.writeInherited'), tr('modal.hub.setNoValue')],
        });
        run(`pickIn(colorRow(), ${JSON.stringify(tr('modal.hub.setNoValue'))}); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(5, 5, '\t- tv-color::'));
        const after = run<Record<string, unknown>>(`
            const box = colorRow().querySelector('.tv-form__input-with-picker--color');
            const input = box.querySelector('input.tv-ctrl__text-input');
            const struck = box.querySelector('.tv-form__struck');
            return JSON.stringify({
                value: input.value,
                placeholder: input.placeholder,
                struck: [struck.textContent, shown(struck)],
                dashed: box.classList.contains('tv-form__control--inherited'),
                menu: menuOfRow(colorRow()),
            });
        `);
        expect(after).toEqual({
            value: '',
            placeholder: 'red',
            struck: ['red', true],
            dashed: false,
            menu: [tr('modal.hub.fromSection'), tr('modal.hub.openInheritedLine'), tr('modal.hub.followInherited')],
        });
    });

    it('writes what the color\'s menu says to the note: the inherited value as its own line, no value over it, and the line out again, the value above coming through', () => {
        openHub('親');
        const step = (title: string) => run(`pickIn(colorRow(), ${JSON.stringify(title)}); await sleep(600); return 'ok';`);
        const menu = () => run<string[]>(`return JSON.stringify(menuOfRow(colorRow()));`);
        const look = () => run<Record<string, unknown>>(`
            const box = colorRow().querySelector('.tv-form__input-with-picker--color');
            const input = box.querySelector('input.tv-ctrl__text-input');
            return JSON.stringify({ value: input.value, placeholder: input.placeholder, struck: shown(box.querySelector('.tv-form__struck')) });
        `);

        step(tr('modal.hub.writeInherited'));
        expect(readTestFile(TEST_FILE)).toBe(withLines(5, 5, '\t- tv-color:: red'));
        expect(look()).toEqual({ value: 'red', placeholder: 'red', struck: false });
        expect(menu()).toEqual([tr('modal.hub.fromSection'), tr('modal.hub.openInheritedLine'), tr('modal.hub.setNoValue'), tr('modal.hub.clearToInherited')]);

        step(tr('modal.hub.setNoValue'));
        expect(readTestFile(TEST_FILE)).toBe(withLines(5, 5, '\t- tv-color::'));
        expect(look()).toEqual({ value: '', placeholder: 'red', struck: true });
        expect(menu()).toEqual([tr('modal.hub.fromSection'), tr('modal.hub.openInheritedLine'), tr('modal.hub.followInherited')]);

        step(tr('modal.hub.followInherited'));
        expect(readTestFile(TEST_FILE)).toBe(LINES.join('\n'));
        expect(look()).toEqual({ value: '', placeholder: 'red', struck: false });

        step(tr('modal.hub.writeInherited'));
        step(tr('modal.hub.clearToInherited'));
        expect(readTestFile(TEST_FILE)).toBe(LINES.join('\n'));
    });

    it('starts the line through a hidden value where the input\'s text starts, in the color\'s box and in a plain one', async () => {
        await writeIndexedTestFile(TEST_FILE, ['# 見出し', '- tv-color:: red', '- tv-mask:: ***', '- [ ] 親 @2026-10-01', '\t- tv-color::', '\t- tv-mask::', ''].join('\n'));
        openHub('親');
        const measured = run<Record<string, { text: string; start: number; line: number; textLeft: number; reach: number }>>(`
            chooseHubTab(hub(), 'detail');
            await until(() => hubTabOn(hub()) === 'detail' && shown(colorRow()));
            await sleep(200);
            const measure = box => {
                const input = box.querySelector('input.tv-ctrl__text-input');
                const text = box.querySelector('.tv-form__struck-text');
                const style = getComputedStyle(input);
                const reach = parseFloat(getComputedStyle(text).marginInlineStart);
                const textLeft = text.getBoundingClientRect().left;
                return {
                    text: text.textContent,
                    start: input.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
                    line: textLeft - reach,
                    textLeft,
                    reach,
                };
            };
            return JSON.stringify({
                color: measure(colorRow().querySelector('.tv-form__input-with-picker--color')),
                mask: measure(maskRow().querySelector('.tv-form__control')),
            });
        `);
        console.info('struck text, px:', JSON.stringify(measured));
        expect(measured.color.text).toBe('red');
        expect(measured.mask.text).toBe('***');
        for (const box of [measured.color, measured.mask]) {
            expect(box.reach).toBeGreaterThan(0);
            expect(Math.abs(box.line - box.start)).toBeLessThanOrEqual(0.5);
            expect(Math.abs(box.textLeft - (box.start + box.reach))).toBeLessThanOrEqual(0.5);
        }
    });

    it('takes the hidden value struck through away once the field holds any text, whichever way it came in, its placeholder drawn clear', async () => {
        await writeIndexedTestFile(TEST_FILE, ['# 見出し', '- tv-color:: red', '- area:: lab', '- [ ] 親 @2026-10-01', '\t- tv-color::', '\t- area::', ''].join('\n'));
        openHub('親');
        const seen = run<Record<string, unknown>>(`
            chooseHubTab(hub(), 'detail');
            await until(() => hubTabOn(hub()) === 'detail' && shown(colorRow()));
            const box = colorRow().querySelector('.tv-form__input-with-picker--color');
            const input = box.querySelector('input.tv-ctrl__text-input');
            const picker = box.querySelector('input[type="color"]');
            const struck = () => shown(box.querySelector('.tv-form__struck'));
            const area = rowOf('area').querySelector('input.task-hub__value');
            const areaStruck = () => shown(rowOf('area').querySelector('.tv-form__struck'));
            const out = { empty: struck(), clear: getComputedStyle(input, '::placeholder').color };
            // Put in by script, no event: as a value picked from the list is.
            input.value = 'blue';
            out.put = struck();
            input.value = '';
            out.emptied = struck();
            // The picker dragged: its input event puts its value in the text.
            picker.value = '#00ff00';
            picker.dispatchEvent(new Event('input', { bubbles: true }));
            out.dragged = [input.value, struck()];
            out.area = [areaStruck(), (area.value = 'x', areaStruck())];
            return JSON.stringify(out);
        `);
        expect(seen).toEqual({ empty: true, clear: 'rgba(0, 0, 0, 0)', put: false, emptied: true, dragged: ['00ff00', false], area: [true, false] });
    });

    it('takes a row\'s own no value out by its menu, a property\'s following the value above and a style\'s with nothing above deleting its key', () => {
        openHub('隠した');
        const before = run<Record<string, unknown>>(`
            const area = rowOf('area').querySelector('input');
            const mask = maskRow();
            return JSON.stringify({
                area: [area.value, area.placeholder, rowOf('area').querySelector('.tv-form__struck-text').textContent],
                menu: menuOfRow(rowOf('area')),
                mask: [mask.querySelector('input').placeholder, menuOfRow(mask)],
            });
        `);
        expect(before).toEqual({
            area: ['', 'lab', 'lab'],
            menu: [tr('modal.hub.fromSection'), tr('modal.hub.openInheritedLine'), tr('modal.hub.followInherited')],
            mask: [tr('modal.hub.noValue'), [tr('modal.hub.deleteKey')]],
        });
        run(`pickOf('area', ${JSON.stringify(tr('modal.hub.followInherited'))}); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(6, 7));
        run(`pickIn(maskRow(), ${JSON.stringify(tr('modal.hub.deleteKey'))}); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(6, 8));
    });

    it('hides a value inherited from above the first heading, its source and an inherited no value from there said to be the file\'s in the menu\'s head', async () => {
        const lines = ['- 時給:: 1450', '- tv-mask::', '', '# 見出し', '- [ ] 根の下 @2026-10-01', ''];
        await writeIndexedTestFile(TEST_FILE, lines.join('\n'));
        openHub('根の下');
        const before = run<Record<string, unknown>>(`
            const wage = rowOf('時給');
            const mask = maskRow();
            return JSON.stringify({
                wage: [wage.querySelector('input').value, wage.querySelector('input').placeholder, !!wage.querySelector('.tv-form__clear-button'), menuOfRow(wage)],
                mask: [mask.querySelector('input[type=text]').placeholder, menuOfRow(mask)],
            });
        `);
        expect(before).toEqual({
            wage: ['', '1450', false, [tr('modal.hub.typeNumber'), tr('modal.hub.fromFile'), tr('modal.hub.openInheritedLine'), tr('modal.hub.writeInherited'), tr('modal.hub.setNoValue')]],
            mask: [tr('modal.hub.noValue'), [tr('modal.hub.fromFile'), tr('modal.hub.openInheritedLine')]],
        });
        run(`pickOf('時給', ${JSON.stringify(tr('modal.hub.setNoValue'))}); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(['- 時給:: 1450', '- tv-mask::', '', '# 見出し', '- [ ] 根の下 @2026-10-01', '\t- 時給::', ''].join('\n'));
    });

    it('shows a style\'s inherited no value as the property fields do, its source in the menu\'s head and its line to open from the menu', () => {
        openHub('節の下');
        const shownRows = run<Record<string, unknown>>(`
            const look = row => ({
                placeholder: row.querySelector('input[type=text]').placeholder,
                dashed: !!row.querySelector('.tv-form__control--inherited'),
                struck: !!row.querySelector('.tv-form__struck') && shown(row.querySelector('.tv-form__struck')),
                menu: menuOfRow(row),
            });
            return JSON.stringify({ color: look(colorRow()), mask: look(maskRow()) });
        `);
        const inheritedNone = {
            placeholder: tr('modal.hub.noValue'),
            dashed: true,
            struck: false,
            menu: [tr('modal.hub.fromSection'), tr('modal.hub.openInheritedLine')],
        };
        expect(shownRows).toEqual({ color: inheritedNone, mask: inheritedNone });

        const line = run<number>(`
            pickIn(colorRow(), ${JSON.stringify(tr('modal.hub.openInheritedLine'))});
            await until(() => noteView() && !hub());
            await sleep(300);
            return noteView().editor.getCursor().line;
        `);
        expect(line).toBe(10);
    });

    it('writes a value typed in a style\'s inherited no value as the row\'s own', () => {
        openHub('節の下');
        run(`
            const input = chooseTabOf(rowOf(${JSON.stringify(tr('modal.hub.mask'))}).querySelector('input'));
            input.focus();
            input.value = '***';
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            input.dispatchEvent(new FocusEvent('blur'));
            await sleep(600);
            return 'ok';
        `);
        expect(readTestFile(TEST_FILE)).toBe(withLines(13, 13, '\t- tv-mask:: ***'));
    });
});

describe('the hub empties an own text over an inherited value', () => {
    const OVER = ['# 見出し', '- team:: A', '- [ ] 親 @2026-10-01', '\t- team:: B', '- [ ] 次', ''];

    beforeEach(async () => { await writeIndexedTestFile(TEST_FILE, OVER.join('\n')); });

    it('takes the row\'s own line out of the note, and shows the inherited value as the placeholder in a dashed box', () => {
        openHub('親');
        run(`
            const input = rowOf('team').querySelector('input');
            chooseTabOf(input).focus();
            input.value = '';
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            input.dispatchEvent(new FocusEvent('blur'));
            await sleep(600);
            return 'ok';
        `);
        expect(readTestFile(TEST_FILE)).toBe(['# 見出し', '- team:: A', '- [ ] 親 @2026-10-01', '- [ ] 次', ''].join('\n'));
        const shown = run<Record<string, unknown>>(`
            const row = rowOf('team');
            const input = row.querySelector('input');
            return JSON.stringify({
                value: input.value,
                placeholder: input.placeholder,
                dashed: row.querySelector('.task-hub__value-box').classList.contains('tv-form__control--inherited'),
            });
        `);
        expect(shown).toEqual({ value: '', placeholder: 'A', dashed: true });
    });
});
