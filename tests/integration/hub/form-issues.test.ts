/**
 * The hub's form and what it says (段10c), in the running Dev vault: each
 * field reads what is typed, shows it in the form the note writes once it
 * is committed, says what does not read under its row and saves none of
 * it, and one field's issue is not taken back by another's.
 *
 * The hub is opened on a row as a card opens it; the fields are typed in as
 * a person types (the text, then its `input` event) and left with a blur.
 * The note's bytes are read back from the disk.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open,
 *     with a build that has IssueBoard and bindField
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/form-issues.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';

const TEST_FILE = 'test-int-hub-issues.md';

const NOTE = [
    '# 見出し',
    '- [ ] 親 @2026-10-01',
    '- [ ] 次',
    '',
].join('\n');

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
/** The form row whose label reads label. */
const rowOf = label => [...hub().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === label);
const dateInput = (label, which) => rowOf(label).querySelector('.tv-form__field--' + which + ' input.tv-ctrl__text-input');
const nameInput = () => hub().querySelector('.tv-form__name-section input');
const keyInput = () => hub().querySelector('.task-hub__prop-add .tv-form__label input');
/** What is said under the field's row (or under the name), a line each. */
const says = input => {
    const el = input.closest('.tv-form__name-section')?.querySelector('.tv-form__says') ?? input.closest('.tv-form__row').nextElementSibling;
    return [...el.children].map(c => c.className + ': ' + c.textContent);
};
const invalid = input => input.classList.contains('tv-ctrl__text-input--invalid');
/** Type text in a field as a person does: the text, then its input event. */
const type = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
/** Leave the field: its commit, then the time a write and its echo take. */
const leave = async input => { input.dispatchEvent(new FocusEvent('blur')); await sleep(600); };
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

/** Open the hub on the row whose name starts with `name`. */
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
        await until(() => !hub());
        return 'ok';
    `);
}

const START = () => tr('modal.start');
const ERROR = 'tv-form__error';

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
});

beforeEach(async () => { await writeIndexedTestFile(TEST_FILE, NOTE); });
afterEach(() => { closeHub(); });

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('the hub\'s form', () => {
    it('says a reserved key under the new property\'s row, keeps it while a date is fixed, and takes it back once the key is', async () => {
        openHub('親');
        const steps = run<Record<string, unknown>>(`
            const out = {};
            const start = () => dateInput(${JSON.stringify(START())}, 'date');
            type(keyInput(), 'tv-start');
            await leave(keyInput());
            out.reserved = { says: says(keyInput()), invalid: invalid(keyInput()) };

            // A date that does not read is said under its own row, the key's kept.
            type(start(), '2026-02-30');
            await leave(start());
            out.badDate = { date: says(start()), key: says(keyInput()) };

            // The date fixed and written: the hub reads its echo, the key's issue and text still there.
            type(start(), '2026-10-06');
            await leave(start());
            out.fixedDate = { date: says(start()), key: says(keyInput()), keyText: keyInput().value, keyInvalid: invalid(keyInput()) };

            // The key fixed as it is typed: its issue goes; left, the property is added.
            type(keyInput(), '場所');
            out.fixedKey = { key: says(keyInput()), invalid: invalid(keyInput()) };
            await leave(keyInput());
            return JSON.stringify(out);
        `);
        const reserved = `${ERROR}: ${tr('issue.reserved')}`;
        expect(steps.reserved).toEqual({ says: [reserved], invalid: true });
        expect(steps.badDate).toEqual({ date: [`${ERROR}: ${tr('issue.noSuchDay')}`], key: [reserved] });
        expect(steps.fixedDate).toEqual({ date: [], key: [reserved], keyText: 'tv-start', keyInvalid: true });
        expect(steps.fixedKey).toEqual({ key: [], invalid: false });
        expect(readTestFile(TEST_FILE)).toBe([
            '# 見出し',
            '- [ ] 親 @2026-10-06',
            // The vault indents with a tab; an empty value is written after its space.
            '\t- 場所:: ',
            '- [ ] 次',
            '',
        ].join('\n'));
    });

    it('reads a date in full width with a long vowel mark and a time of one digit, shown and saved in the form the note writes', async () => {
        openHub('親');
        const shown = run<Record<string, unknown>>(`
            const date = dateInput(${JSON.stringify(START())}, 'date');
            const time = dateInput(${JSON.stringify(START())}, 'time');
            type(date, '２０２６ー１０ー０５');
            await leave(date);
            type(time, '9:40');
            await leave(time);
            return JSON.stringify({ date: date.value, time: time.value, says: says(date) });
        `);
        expect(shown).toEqual({ date: '2026-10-05', time: '09:40', says: [] });
        expect(readTestFile(TEST_FILE)).toBe([
            '# 見出し',
            '- [ ] 親 @2026-10-05T09:40',
            '- [ ] 次',
            '',
        ].join('\n'));
    });

    it('says why a line style does not read, under its row, and saves nothing', async () => {
        openHub('親');
        const said = run<Record<string, unknown>>(`
            const input = rowOf(${JSON.stringify(tr('modal.hub.linestyle'))}).querySelector('input');
            type(input, 'zigzag');
            await leave(input);
            return JSON.stringify({ says: says(input), invalid: invalid(input), text: input.value });
        `);
        expect(said).toEqual({
            says: [`${ERROR}: ${tr('issue.oneOf', { allowed: 'solid, dashed, dotted, double, dashdotted' })}`],
            invalid: true,
            text: 'zigzag',
        });
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
    });

    it('refuses a name that holds a date block, keeping the text, and saves nothing', async () => {
        openHub('親');
        const said = run<Record<string, unknown>>(`
            type(nameInput(), '電話 @10:00');
            await leave(nameInput());
            return JSON.stringify({ says: says(nameInput()), invalid: invalid(nameInput()), text: nameInput().value });
        `);
        expect(said).toEqual({ says: [`${ERROR}: ${tr('issue.notation.dateBlock')}`], invalid: true, text: '電話 @10:00' });
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
    });
});
