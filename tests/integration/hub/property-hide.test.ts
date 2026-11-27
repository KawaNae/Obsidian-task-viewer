/**
 * Hiding an inherited value in the hub, in the running E2E vault. A
 * property's row that inherits a value shows it as the empty field's
 * placeholder in a dashed box, and hides it by its menu ("Set to no value"),
 * which writes its own line with no value (`- key::`); the row then shows an
 * empty field with the value hidden struck through, and its menu takes the
 * line out again ("Follow inherited value"), so the value above comes
 * through. Emptying an inherited field writes nothing, and emptying an own
 * value over an inherited one takes the row's line out. A style's row hides
 * its value by its icon, and its own no value's × takes the line out. A
 * style shows a no value a section above wrote as the property fields do:
 * an empty field that says so, with the line it is written on to open. A
 * value written above the first heading is hidden so too, its source said
 * to be the file's.
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
const pickOf = (key, title) => { rowOf(key).querySelector('button.tv-form__menu-button').click(); menuItem(i => i.titleEl?.textContent === title); };
const colorRow = () => hub().querySelector('.tv-form__input-with-picker--color').closest('.tv-form__row');
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
                struck: [struck.textContent, shown(struck) && !struck.classList.contains('is-hidden')],
                dashed: row.querySelector('.task-hub__value-box').classList.contains('tv-form__control--inherited'),
            });
        `);
        expect(readTestFile(TEST_FILE)).toBe(withLines(5, 5, '\t- area::'));
        expect(after).toEqual({ value: '', placeholder: '', struck: ['lab', true], dashed: false });
    });

    it('writes nothing when an inherited property\'s empty field is left as it is, and the typed value as the row\'s own when it is typed, even equal to the inherited', () => {
        openHub('親');
        run(`const input = rowOf('area').querySelector('input'); chooseTabOf(input).focus(); input.value = ''; input.dispatchEvent(new InputEvent('input', { bubbles: true })); input.dispatchEvent(new FocusEvent('blur')); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(LINES.join('\n'));
        run(`const input = rowOf('area').querySelector('input'); chooseTabOf(input).focus(); input.value = 'lab'; input.dispatchEvent(new InputEvent('input', { bubbles: true })); input.dispatchEvent(new FocusEvent('blur')); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(5, 5, '\t- area:: lab'));
    });

    it('hides an inherited color', () => {
        openHub('親');
        run(`
            const row = hub().querySelector('.tv-form__input-with-picker--color').closest('.tv-form__row');
            row.querySelector('.task-hub__hide').click();
            await sleep(600);
            return 'ok';
        `);
        expect(readTestFile(TEST_FILE)).toBe(withLines(5, 5, '\t- tv-color::'));
    });

    it('takes a row\'s own no value out, a property\'s by its menu and a style\'s by its ×, and the value above comes through', () => {
        openHub('隠した');
        const before = run<Record<string, unknown>>(`
            const area = rowOf('area').querySelector('input');
            const mask = rowOf(${JSON.stringify(tr('modal.hub.mask'))});
            rowOf('area').querySelector('button.tv-form__menu-button').click();
            const menu = menuTitles();
            closeMenus();
            return JSON.stringify({
                area: [area.value, area.placeholder, rowOf('area').querySelector('.tv-form__struck-text').textContent],
                menu,
                mask: [mask.querySelector('input').placeholder, shown(mask.querySelector('.task-hub__prop-remove')), shown(mask.querySelector('.task-hub__hide'))],
            });
        `);
        expect(before).toEqual({
            area: ['', '', 'lab'],
            menu: [tr('modal.hub.fromSection'), tr('modal.hub.openInheritedLine'), tr('modal.hub.followInherited')],
            mask: [tr('modal.hub.noValue'), true, false],
        });
        run(`pickOf('area', ${JSON.stringify(tr('modal.hub.followInherited'))}); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(6, 7));
        run(`
            const mask = rowOf(${JSON.stringify(tr('modal.hub.mask'))});
            mask.querySelector('.task-hub__prop-remove').click();
            await sleep(600);
            return 'ok';
        `);
        expect(readTestFile(TEST_FILE)).toBe(withLines(6, 8));
    });

    it('hides a value inherited from above the first heading, its source and an inherited no value from there said to be the file\'s', async () => {
        const lines = ['- 時給:: 1450', '- tv-mask::', '', '# 見出し', '- [ ] 根の下 @2026-10-01', ''];
        await writeIndexedTestFile(TEST_FILE, lines.join('\n'));
        openHub('根の下');
        const before = run<Record<string, unknown>>(`
            const wage = rowOf('時給');
            const mask = rowOf(${JSON.stringify(tr('modal.hub.mask'))});
            return JSON.stringify({
                wage: [wage.querySelector('input').value, wage.querySelector('input').placeholder, !!wage.querySelector('.tv-form__clear-button')],
                mask: [mask.querySelector('input[type=text]').placeholder, mask.querySelector('.task-hub__source').textContent],
            });
        `);
        expect(before).toEqual({
            wage: ['', '1450', false],
            mask: [tr('modal.hub.noValue'), tr('modal.hub.inheritedFromFile')],
        });
        run(`pickOf('時給', ${JSON.stringify(tr('modal.hub.setNoValue'))}); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(['- 時給:: 1450', '- tv-mask::', '', '# 見出し', '- [ ] 根の下 @2026-10-01', '\t- 時給::', ''].join('\n'));
    });

    it('shows a style\'s inherited no value as the property fields do, its source to open and no ×', () => {
        openHub('節の下');
        const shownRows = run<Record<string, unknown>>(`
            const look = row => ({
                placeholder: row.querySelector('input[type=text]').placeholder,
                source: shown(row.querySelector('.task-hub__source')) ? row.querySelector('.task-hub__source').textContent : null,
                remove: shown(row.querySelector('.task-hub__prop-remove')),
                hide: shown(row.querySelector('.task-hub__hide')),
            });
            return JSON.stringify({ color: look(colorRow()), mask: look(rowOf(${JSON.stringify(tr('modal.hub.mask'))})) });
        `);
        const inheritedNone = { placeholder: tr('modal.hub.noValue'), source: tr('modal.hub.inheritedFromSection'), remove: false, hide: false };
        expect(shownRows).toEqual({ color: inheritedNone, mask: inheritedNone });

        const line = run<number>(`
            colorRow().querySelector('.task-hub__source').click();
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
