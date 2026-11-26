/**
 * The hub's custom properties, in the running E2E vault: a value is written
 * back as it is spelled. Editing one property rewrites that line alone, so
 * the other lines keep their spelling (`007`, `True`, `0x1F`, a quoted
 * `"123"`, a line with no value), and a value typed is written as typed. A
 * value is shown as its line spells it, a quoted text with its quotes, and
 * the values offered are spelled so.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/property-values.test.ts
 */
import { describe, it, expect, afterAll, afterEach, beforeEach } from 'vitest';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { DIALOG_ROWS } from '../helpers/dialog-rows';
import { tr } from '../helpers/view-helper';

const TEST_FILE = 'test-int-hub-property-values.md';

const LINES = [
    '# 見出し',
    '- [ ] 親 @2026-10-01',
    '\t- n:: 007',
    '\t- flag:: True',
    '\t- hex:: 0x1F',
    '\t- id:: "123"',
    '\t- e::',
    '\t- memo:: a',
    '- [ ] 次',
    '',
];

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
${DIALOG_ROWS}
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const rowOf = label => [...hub().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === label);
const valueInput = key => rowOf(key).querySelector('input.tv-ctrl__text-input');
const nameInput = () => hub().querySelector('.tv-form__name-section input');
const type = (input, text) => { chooseTabOf(input).focus(); input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
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

/** The note with line `at` (0-indexed) put in place of what it was. */
function withLine(at: number, line: string): string {
    const lines = [...LINES];
    lines[at] = line;
    return lines.join('\n');
}

beforeEach(async () => { await writeIndexedTestFile(TEST_FILE, LINES.join('\n')); });
afterEach(() => { closeHub(); });

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('the hub writes a custom property back as it is spelled', () => {
    it('shows a number, a boolean and a quoted text as written', () => {
        openHub('親');
        const shown = run<Record<string, string>>(`
            return JSON.stringify(Object.fromEntries(['n', 'flag', 'hex', 'id', 'e', 'memo'].map(k => [k, valueInput(k).value])));
        `);
        expect(shown).toEqual({ n: '007', flag: 'True', hex: '0x1F', id: '"123"', e: '', memo: 'a' });
    });

    it('offers the values as spelled: a quoted text apart from the number', () => {
        openHub('次');
        const offered = run<string[]>(`
            const key = hub().querySelector('.task-hub__prop-add .tv-form__label input');
            type(key, 'id');
            const value = hub().querySelector('.task-hub__prop-add input.tv-form__control');
            type(value, '12');
            await sleep(300);
            return JSON.stringify([...document.querySelectorAll('.suggestion-container .suggestion-item')].map(el => el.textContent));
        `);
        expect(offered).toEqual(expect.arrayContaining(['"123"']));
        expect(offered).not.toContain('123');
    });

    it('edits one property, leaving every other line as written', () => {
        openHub('親');
        run(`type(valueInput('memo'), 'b'); await leave(valueInput('memo')); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLine(7, '\t- memo:: b'));
    });

    it('writes nothing when a value is left as it is shown', () => {
        openHub('親');
        run(`
            for (const k of ['n', 'flag', 'hex', 'id']) { const input = valueInput(k); type(input, input.value); await leave(input); }
            return 'ok';
        `);
        expect(readTestFile(TEST_FILE)).toBe(LINES.join('\n'));
    });

    it('writes a value as typed', () => {
        openHub('親');
        run(`type(valueInput('flag'), 'true'); await leave(valueInput('flag')); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLine(3, '\t- flag:: true'));
    });

    it('adds a property, leaving the lines there as written', () => {
        openHub('親');
        run(`
            const key = hub().querySelector('.task-hub__prop-add .tv-form__label input');
            type(key, '場所');
            await leave(key);
            return 'ok';
        `);
        // A key with no value is a property with none: it hides the value above.
        const lines = [...LINES];
        lines.splice(8, 0, '\t- 場所::');
        expect(readTestFile(TEST_FILE)).toBe(lines.join('\n'));
    });

    it('keeps the line with no value when its value is emptied, and writes nothing for a field touched and left as it was', () => {
        openHub('親');
        run(`type(valueInput('memo'), ''); await leave(valueInput('memo')); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLine(7, '\t- memo::'));
        run(`chooseTabOf(valueInput('memo')).focus(); await leave(valueInput('memo')); chooseTabOf(valueInput('e')).focus(); await leave(valueInput('e')); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLine(7, '\t- memo::'));
    });

    it('writes no value at once as the × in a value\'s field is pressed, the row kept and the focus not put in the field', () => {
        openHub('親');
        const before = run<Record<string, unknown>>(`
            const shown = el => !!el && getComputedStyle(el).display !== 'none';
            return JSON.stringify({ memo: shown(rowOf('memo').querySelector('.tv-form__clear-button')), e: shown(rowOf('e').querySelector('.tv-form__clear-button')) });
        `);
        // A field with no value has no ×.
        expect(before).toEqual({ memo: true, e: false });
        const after = run<Record<string, unknown>>(`
            rowOf('memo').querySelector('.tv-form__clear-button').click();
            await sleep(600);
            return JSON.stringify({ value: valueInput('memo').value, placeholder: valueInput('memo').placeholder, focused: document.activeElement === valueInput('memo') });
        `);
        expect(readTestFile(TEST_FILE)).toBe(withLine(7, '\t- memo::'));
        expect(after).toEqual({ value: '', placeholder: tr('modal.hub.noValue'), focused: false });
    });
});

describe('the hub writes a property as its block', () => {
    const BLOCK = [
        '# 見出し',
        '- area:: lab',
        '- [ ] 親 @2026-10-01',
        '\t- k::',
        '\t\t- a',
        '\t\t- b',
        '\t- dup:: 1',
        '\t- DUP:: 2',
        '- [ ] 次',
        '',
    ];

    beforeEach(async () => { await writeIndexedTestFile(TEST_FILE, BLOCK.join('\n')); });

    it('writes an inherited value typed again as the row\'s own, and nothing when it is left alone', () => {
        openHub('親');
        run(`const input = chooseTabOf(valueInput('area')); input.focus(); await leave(input); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(BLOCK.join('\n'));
        run(`type(valueInput('area'), 'lab'); await leave(valueInput('area')); return 'ok';`);
        const lines = [...BLOCK];
        lines.splice(8, 0, '\t- area:: lab');
        expect(readTestFile(TEST_FILE)).toBe(lines.join('\n'));
    });

    it('writes an inherited value typed again when the hub closes with no blur', () => {
        openHub('親');
        run(`
            type(valueInput('area'), 'lab');
            document.querySelector('.tv-overlay:not(.is-closing) .tv-overlay__close').click();
            await until(() => !hub());
            await sleep(300);
            return 'ok';
        `);
        const lines = [...BLOCK];
        lines.splice(8, 0, '\t- area:: lab');
        expect(readTestFile(TEST_FILE)).toBe(lines.join('\n'));
    });

    it('refuses a key written twice as it is read: writes nothing, says under the key that its row stands, and keeps what was typed in the add row', () => {
        openHub('親');
        const after = run<{ said: string[]; form: string; key: string; value: string }>(`
            const key = hub().querySelector('.task-hub__prop-add .tv-form__label input');
            type(key, 'dup');
            const value = hub().querySelector('.task-hub__prop-add input.tv-form__control');
            type(value, '3');
            await leave(value);
            const row = hub().querySelector('.task-hub__prop-add');
            const said = [...(row.nextElementSibling?.querySelectorAll('.tv-form__error') ?? [])].map(one => one.textContent);
            const kept = { said, form: hub().querySelector('.task-hub__form > .tv-form__says--form')?.textContent ?? '', key: row.querySelector('.tv-form__label input').value, value: row.querySelector('input.tv-form__control').value };
            // Emptied as a person would, so that the hub closes.
            type(row.querySelector('.tv-form__label input'), '');
            type(row.querySelector('input.tv-form__control'), '');
            return JSON.stringify(kept);
        `);
        expect(readTestFile(TEST_FILE)).toBe(BLOCK.join('\n'));
        expect(after.said).toEqual([tr('issue.keyHasRow', { key: 'dup' })]);
        expect(after.form).not.toContain('dup');
        expect([after.key, after.value]).toEqual(['dup', '3']);
    });

    it('asks on a close while the add row holds a key that has a row, and closes once what was typed is thrown away, writing nothing', () => {
        openHub('親');
        const after = run<{ open: boolean; ask: string; key: string; closed: boolean }>(`
            const key = hub().querySelector('.task-hub__prop-add .tv-form__label input');
            type(key, 'dup');
            const value = hub().querySelector('.task-hub__prop-add input.tv-form__control');
            type(value, '3');
            await leave(value);
            const close = () => document.querySelector('.tv-overlay:not(.is-closing) .tv-overlay__close').click();
            close();
            await sleep(600);
            const row = hub()?.querySelector('.task-hub__prop-add');
            const asked = { open: !!hub(), ask: formRow(hub())?.querySelector('.tv-form__ask')?.textContent ?? '', key: row?.querySelector('.tv-form__label input').value ?? '' };
            formRow(hub()).querySelector('.tv-form__discard').click();
            await until(() => !hub());
            return JSON.stringify({ ...asked, closed: !hub() });
        `);
        expect(after.open).toBe(true);
        expect(after.ask).toContain(tr('modal.hub.unsavedAsk', { fields: tr('modal.hub.propertyKeyField') }));
        expect(after.key).toBe('dup');
        expect(after.closed).toBe(true);
        expect(readTestFile(TEST_FILE)).toBe(BLOCK.join('\n'));
    });
});
