/**
 * The hub's custom properties, in the running Dev vault: a value is written
 * back as it is spelled. Editing one property rewrites that line alone, so
 * the other lines keep their spelling (`007`, `True`, `0x1F`, a quoted
 * `"123"`, a line with no value), and a value typed is written as typed. A
 * value is shown as its line spells it, a quoted text with its quotes, and
 * the values offered are spelled so.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/property-values.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';

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
const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const rowOf = label => [...hub().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === label);
const valueInput = key => rowOf(key).querySelector('input.tv-ctrl__text-input');
const nameInput = () => hub().querySelector('.tv-form__name-section input');
const type = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
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
        hub()?.querySelector('.task-hub__form .tv-form__discard')?.click();
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

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
});

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

    it('takes the line out when its value is emptied', () => {
        openHub('親');
        run(`type(valueInput('memo'), ''); await leave(valueInput('memo')); return 'ok';`);
        const lines = [...LINES];
        lines.splice(7, 1);
        expect(readTestFile(TEST_FILE)).toBe(lines.join('\n'));
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
        run(`const input = valueInput('area'); input.focus(); await leave(input); return 'ok';`);
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

    it('takes a list\'s line out with its items', () => {
        openHub('親');
        run(`rowOf('k').querySelector('.task-hub__prop-remove').click(); await sleep(600); return 'ok';`);
        const lines = [...BLOCK];
        lines.splice(3, 3);
        expect(readTestFile(TEST_FILE)).toBe(lines.join('\n'));
    });

    it('writes nothing over a key written twice, and says so at the form\'s end', () => {
        openHub('親');
        const said = run<string>(`
            const key = hub().querySelector('.task-hub__prop-add .tv-form__label input');
            type(key, 'dup');
            const value = hub().querySelector('.task-hub__prop-add input.tv-form__control');
            type(value, '3');
            await leave(value);
            return hub().textContent;
        `);
        expect(readTestFile(TEST_FILE)).toBe(BLOCK.join('\n'));
        expect(said).toContain('dup');
    });
});
