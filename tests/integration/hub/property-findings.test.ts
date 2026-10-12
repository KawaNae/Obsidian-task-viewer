/**
 * The hub's fields and what the row's own property lines hold that is
 * wrong, in the running Dev vault: a field whose block has a finding takes
 * no edit and says the editor's sentence under its row, with the line to
 * open; the other fields are written as before. A date key under the task
 * is said of the form and locks nothing.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/property-findings.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';

const TEST_FILE = 'test-int-hub-property-findings.md';

const LINES = [
    '# 見出し',
    '- area:: lab',
    '- [ ] 親 @2026-10-01',
    '\t- tv-color:: rde',
    '\t- area:: x',
    '\t- AREA:: y',
    '\t- dup:: 1',
    '\t- Dup:: 2',
    '\t- memo:: a',
    '\t\t- under',
    '\t- tv-start:: 2026-10-02',
    '\t- ok:: 1',
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
const says = row => [...row.nextElementSibling.children].map(c => c.className + ': ' + c.firstChild.textContent);
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

describe('the hub locks a field whose block has a finding', () => {
    it('locks the fields with findings, says why under each, and leaves the others', () => {
        openHub('親');
        const state = run<Record<string, unknown>>(`
            const color = hub().querySelector('.tv-form__input-with-picker--color input.tv-ctrl__text-input');
            return JSON.stringify({
                color: color.disabled,
                colorSays: says(color.closest('.tv-form__row')).length,
                area: valueInput('area').disabled,
                areaSays: says(rowOf('area')),
                dup: valueInput('dup').disabled,
                memo: valueInput('memo').disabled,
                ok: valueInput('ok').disabled,
                okSays: says(rowOf('ok')),
                actions: hub().querySelectorAll('.tv-form__issue-action').length,
                form: [...hub().querySelectorAll('.tv-form__says--form > div')].map(d => d.className),
            });
        `);
        expect(state).toMatchObject({
            color: true, colorSays: 1,
            area: true,
            dup: true, memo: true,
            ok: false, okSays: [],
        });
        // The key written twice: one finding a line, each said (their keys differ in case).
        expect((state.areaSays as string[]).length).toBe(2);
        expect((state.areaSays as string[]).every(line => line.startsWith('tv-form__error'))).toBe(true);
        // The date key under the task is said of the form, as a warning.
        expect(state.form).toEqual(['tv-form__warning']);
        expect(state.actions).toBe(7);
    });

    it('writes a field with no finding', () => {
        openHub('親');
        run(`type(valueInput('ok'), '2'); await leave(valueInput('ok')); return 'ok';`);
        const lines = [...LINES];
        lines[11] = '\t- ok:: 2';
        expect(readTestFile(TEST_FILE)).toBe(lines.join('\n'));
    });
});
