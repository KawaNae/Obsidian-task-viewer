/**
 * Hiding an inherited value in the hub, in the running E2E vault. A
 * property's row that inherits a value hides it by the × in its field,
 * which writes its own line with no value (`- key::`) at once; the row then
 * shows an empty field with the value hidden struck through, and its menu
 * takes the line out again ("Revert to inherited value"), so the value
 * above comes through. A style's row hides it by its icon, and its own no
 * value's × takes the line out. A style shows a no value a section above
 * wrote as the property fields do: an empty field that says so, with the
 * line it is written on to open. A value written above the first heading
 * is hidden so too, its source said to be the file's.
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
const pickOf = (key, title) => { rowOf(key).querySelector('.task-hub__prop-more').click(); menuItem(i => i.titleEl?.textContent === title); };
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
    it('hides an inherited property by the × in its field, and then shows the row\'s no value with the value hidden struck through', () => {
        openHub('親');
        const before = run<Record<string, unknown>>(`
            const row = rowOf('area');
            const mark = row.querySelector('.task-hub__prop-mark');
            return JSON.stringify({
                mark: [!!mark.querySelector('svg.lucide-link-2'), mark.getAttribute('aria-label')],
                frame: getComputedStyle(row.querySelector('input')).borderTopStyle,
                x: shown(row.querySelector('.tv-form__clear-button')),
                hide: !!row.querySelector('.task-hub__hide'),
            });
        `);
        expect(before).toEqual({ mark: [true, tr('modal.hub.markInherited')], frame: 'dashed', x: true, hide: false });
        const after = run<Record<string, unknown>>(`
            rowOf('area').querySelector('.tv-form__clear-button').click();
            await sleep(600);
            const row = rowOf('area');
            const input = row.querySelector('input');
            const mark = row.querySelector('.task-hub__prop-mark');
            return JSON.stringify({
                value: input.value,
                placeholder: input.placeholder,
                struck: getComputedStyle(input, '::placeholder').textDecorationLine,
                mark: [!!mark.querySelector('svg.lucide-link-2off'), mark.getAttribute('aria-label')],
                focused: document.activeElement === input,
            });
        `);
        expect(readTestFile(TEST_FILE)).toBe(withLines(5, 5, '\t- area::'));
        expect(after).toEqual({ value: '', placeholder: 'lab', struck: 'line-through', mark: [true, tr('modal.hub.markHiding')], focused: false });
    });

    it('hides an inherited property by emptying its field, as its × does', () => {
        openHub('親');
        run(`const input = rowOf('area').querySelector('input'); chooseTabOf(input).focus(); input.value = ''; input.dispatchEvent(new InputEvent('input', { bubbles: true })); input.dispatchEvent(new FocusEvent('blur')); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(5, 5, '\t- area::'));
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
            rowOf('area').querySelector('.task-hub__prop-more').click();
            const menu = menuTitles();
            closeMenus();
            return JSON.stringify({
                area: [area.value, area.placeholder],
                menu,
                mask: [mask.querySelector('input').placeholder, shown(mask.querySelector('.task-hub__prop-remove')), shown(mask.querySelector('.task-hub__hide'))],
            });
        `);
        expect(before).toEqual({
            area: ['', 'lab'],
            menu: [tr('modal.hub.fromSection'), tr('modal.hub.openInheritedLine'), tr('modal.hub.revertToInherited')],
            mask: [tr('modal.hub.noValue'), true, false],
        });
        run(`pickOf('area', ${JSON.stringify(tr('modal.hub.revertToInherited'))}); await sleep(600); return 'ok';`);
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
                wage: [wage.querySelector('input').value, shown(wage.querySelector('.tv-form__clear-button'))],
                mask: [mask.querySelector('input[type=text]').placeholder, mask.querySelector('.task-hub__source').textContent],
            });
        `);
        expect(before).toEqual({
            wage: ['1450', true],
            mask: [tr('modal.hub.noValue'), tr('modal.hub.inheritedFromFile')],
        });
        run(`rowOf('時給').querySelector('.tv-form__clear-button').click(); await sleep(600); return 'ok';`);
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
