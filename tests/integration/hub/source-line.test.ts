/**
 * The hub opens the line a value is written on, in the running Dev vault:
 * an inherited value's source label and a finding's button open the row's
 * note with the cursor on that line, and a frontmatter key the Properties
 * view shows is lit there. A value written above the first heading is said
 * to be the file's, as the frontmatter's is, and its line opens as a
 * section's does. A line our own write moved is followed.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/source-line.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';

const TEST_FILE = 'test-int-hub-source-line.md';

const LINES = [
    '---',
    'tv-mask: "***"',
    'owner: me',
    '---',
    '- 時給:: 1450',
    '# 見出し',
    '- area:: lab',
    '- tv-color:: red',
    '- tags:: #sec',
    '- [ ] 親 @2026-10-01',
    '\t- ok:: 1',
    '\t- memo:: a',
    '\t\t- under',
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
const noteView = () => app.workspace.getLeavesOfType('markdown').map(l => l.view).find(v => v.file?.path === ${JSON.stringify(TEST_FILE)});
/** Wait for the note to be shown with the cursor moved, and answer the cursor's line. */
const cursorLine = async () => { await until(() => noteView() && !hub()); await sleep(300); return noteView().editor.getCursor().line; };
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

/** Close the hub, if it is open, and the note's tabs. */
function closeAll(): void {
    run(`
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
        await sleep(100);
        hub()?.querySelector('.task-hub__form .tv-form__discard')?.click();
        await until(() => !hub());
        app.workspace.getLeavesOfType('markdown').filter(l => l.view.file?.path === ${JSON.stringify(TEST_FILE)}).forEach(l => l.detach());
        return 'ok';
    `);
}

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
});

beforeEach(async () => { await writeIndexedTestFile(TEST_FILE, LINES.join('\n')); });
afterEach(() => { closeAll(); });

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('the hub opens the line a value is written on', () => {
    it('opens a section\'s property line from its source label', () => {
        openHub('親');
        const line = run<number>(`rowOf('area').querySelector('.task-hub__source').click(); return await cursorLine();`);
        expect(line).toBe(6);
    });

    it('says a value above the first heading is the file\'s, a section\'s the section\'s, and opens its line', () => {
        openHub('親');
        const labels = run<string[]>(`return JSON.stringify(['時給', 'area'].map(key => rowOf(key).querySelector('.task-hub__source').textContent));`);
        expect(labels).toEqual(['継承: ファイル', '継承: セクション']);
        expect(run<boolean>(`return !rowOf('owner');`)).toBe(true);
        const line = run<number>(`rowOf('時給').querySelector('.task-hub__source').click(); return await cursorLine();`);
        expect(line).toBe(4);
    });

    it('opens a section\'s style line, and the line that adds an inherited tag', () => {
        openHub('親');
        const color = run<number>(`
            hub().querySelector('.tv-form__input-with-picker--color').closest('.tv-form__row').querySelector('.task-hub__source').click();
            return await cursorLine();
        `);
        expect(color).toBe(7);
        closeAll();
        openHub('親');
        const tag = run<number>(`hub().querySelector('.task-hub__tag-chip--cascade').click(); return await cursorLine();`);
        expect(tag).toBe(8);
    });

    it('opens a finding\'s line from its button', () => {
        openHub('親');
        const line = run<number>(`rowOf('memo').nextElementSibling.querySelector('.tv-form__issue-action').click(); return await cursorLine();`);
        expect(line).toBe(12);
    });

    it('opens a finding\'s line where a write of ours moved it', () => {
        openHub('親');
        const line = run<number>(`
            rowOf('ok').querySelector('.tv-ctrl__pill-remove').click();
            await until(() => !rowOf('ok'));
            await sleep(600);
            rowOf('memo').nextElementSibling.querySelector('.tv-form__issue-action').click();
            return await cursorLine();
        `);
        expect(line).toBe(11);
    });

    it('lights a frontmatter key in the Properties view, or puts the cursor on its line in source mode', () => {
        openHub('親');
        const shown = run<{ lit: boolean; cursor: number; properties: boolean }>(`
            rowOf('マスク').querySelector('.task-hub__source').click();
            await until(() => noteView() && !hub());
            await sleep(200);
            const view = noteView();
            const property = view.containerEl.querySelector('.metadata-property[data-property-key="tv-mask"]');
            return JSON.stringify({
                properties: !!property && property.offsetParent !== null,
                lit: !!property?.classList.contains('is-flashing'),
                cursor: view.editor.getCursor().line,
            });
        `);
        if (shown.properties) expect(shown.lit).toBe(true);
        else expect(shown.cursor).toBe(1);
    });
});
