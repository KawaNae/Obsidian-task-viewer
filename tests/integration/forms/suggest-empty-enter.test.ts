/**
 * An Enter in an empty field whose list is open, in the running E2E vault,
 * with the keys as the keyboard sends them (Electron's `sendInputEvent`).
 * As the lists of Obsidian's own fields do, a list opened on an empty field
 * selects no item, and an Enter with none selected closes the list and is
 * the field's own: an emptied colour takes the row's line out, an emptied
 * text property writes `- key::` or, over an inherited value, takes the
 * row's line out, and an Enter in the empty tag field or in the note field
 * of a task to make puts no item in. An ArrowDown selects the first item,
 * and the Enter after it puts that item in.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open,
 *     with a current build, its window in front
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/forms/suggest-empty-enter.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { MENUS } from '../helpers/menus';
import { DIALOG_ROWS } from '../helpers/dialog-rows';
import { DRAFT_HUB } from '../helpers/draft-hub';
import { REAL_INPUT } from '../helpers/real-input';

const TEST_FILE = 'test-int-suggest-empty-enter.md';

const LINES = [
    '# 見出し',
    '- [ ] 他 @2026-10-01 #e2e-ee-tag-a #e2e-ee-tag-b',
    '\t- e2e-ee-text:: 値X',
    '\t- tv-color:: blue',
    '- [ ] 色 @2026-10-01',
    '\t- tv-color:: red',
    '- [ ] 文字 @2026-10-01',
    '\t- e2e-ee-text:: 自分',
    '- [ ] 空 @2026-10-01',
    '## 継ぐ節',
    '- e2e-ee-text:: 節の値',
    '- [ ] 継ぐ @2026-10-01',
    '\t- e2e-ee-text:: 自分',
    '',
];

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
${UNTIL}
${DIALOG_ROWS}
${MENUS}
${DRAFT_HUB}
${REAL_INPUT}
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const rowIn = label => [...hub().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent.trim() === label);
const colorInput = () => hub().querySelector('.tv-form__input-with-picker--color input.tv-ctrl__text-input');
const textInput = () => rowIn('e2e-ee-text').querySelector('input.tv-ctrl__text-input');
const tagInput = () => hub().querySelector('.task-hub__tag-add-wrap input');
const taskOf = name => plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(name));
/** The list Obsidian shows under a field: how many items, and the one selected. */
const list = () => {
    const box = [...document.querySelectorAll('.suggestion-container')].find(el => el.isConnected);
    if (!box) return null;
    return {
        items: box.querySelectorAll('.suggestion-item').length,
        selected: box.querySelector('.suggestion-item.is-selected')?.textContent.trim() ?? null,
    };
};
/** The row's hub open on its Details tab. */
const openOn = async name => {
    plugin.openTaskHub(taskOf(name).id, { focusField: 'name' });
    await until(() => hub() && document.activeElement === hub().querySelector('.tv-form__name-section input'));
    chooseHubTab(hub(), 'detail');
    await until(() => hubTabOn(hub()) === 'detail');
    await sleep(250);
};
/** The field pressed as a person presses it, and its list as it opened. */
const focusOn = async input => {
    await press(input);
    await until(() => document.activeElement === input);
    await sleep(400);
    return list();
};
/** The field's text deleted as a person deletes it, and the list as it opened on the empty field. */
const empty = async input => {
    input.setSelectionRange(0, input.value.length);
    keys('Backspace');
    await until(() => input.value === '');
    await sleep(400);
    return list();
};
`;

function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

/** The lines of the row `name` in the file: its task line and the lines under it. */
function blockOf(name: string): string[] {
    const lines = readTestFile(TEST_FILE).split('\n');
    const at = lines.findIndex(l => l.startsWith(`- [ ] ${name}`));
    const end = lines.findIndex((l, i) => i > at && !l.startsWith('\t'));
    return lines.slice(at, end);
}

beforeAll(() => { if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']); });
beforeEach(async () => { await writeIndexedTestFile(TEST_FILE, LINES.join('\n')); });
afterEach(() => {
    run(`await cleanUpHubs(); await sleep(200); return JSON.stringify(true);`);
});
afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('an Enter in an empty field with its list open is the field\'s, and puts no item in', () => {
    it('the colour: its own value deleted and Enter takes the row\'s line out; an Enter in the empty field writes nothing', () => {
        const own = run<Record<string, unknown>>(`
            await openOn('色');
            await focusOn(colorInput());
            const emptied = await empty(colorInput());
            keys('Enter');
            await until(() => !taskOf('色')?.color, 3000, 'the colour is still written');
            await sleep(300);
            return JSON.stringify({ emptied, list: list(), value: colorInput().value });
        `);
        expect(own.emptied).toMatchObject({ selected: null });
        expect((own.emptied as { items: number }).items).toBeGreaterThan(0);
        expect(own).toMatchObject({ list: null, value: '' });
        expect(blockOf('色')).toEqual(['- [ ] 色 @2026-10-01']);

        run(`await cleanUpHubs(); return JSON.stringify(true);`);
        const before = readTestFile(TEST_FILE);
        const none = run<Record<string, unknown>>(`
            await openOn('空');
            const opened = await focusOn(colorInput());
            keys('Enter');
            // Long enough for a write the Enter must not start to reach the file.
            await sleep(800);
            return JSON.stringify({ opened, list: list(), value: colorInput().value, color: taskOf('空').color ?? null });
        `);
        expect(none.opened).toMatchObject({ selected: null });
        expect((none.opened as { items: number }).items).toBeGreaterThan(0);
        expect(none).toMatchObject({ list: null, value: '', color: null });
        expect(readTestFile(TEST_FILE)).toBe(before);
    });

    it('a text property: its own value deleted and Enter writes `- key::` where nothing is inherited', () => {
        const result = run<Record<string, unknown>>(`
            await openOn('文字');
            await focusOn(textInput());
            const emptied = await empty(textInput());
            keys('Enter');
            await until(() => taskOf('文字') && !JSON.stringify(taskOf('文字').properties).includes('自分'), 3000, 'the value is still written');
            await sleep(300);
            return JSON.stringify({ emptied, list: list() });
        `);
        expect(result.emptied).toMatchObject({ selected: null });
        expect((result.emptied as { items: number }).items).toBeGreaterThan(0);
        expect(result.list).toBeNull();
        expect(blockOf('文字')).toEqual(['- [ ] 文字 @2026-10-01', '\t- e2e-ee-text::']);
    });

    it('a text property: its own value deleted and Enter takes the row\'s line out where a value is inherited', () => {
        const result = run<Record<string, unknown>>(`
            await openOn('継ぐ');
            await focusOn(textInput());
            const emptied = await empty(textInput());
            keys('Enter');
            await until(() => taskOf('継ぐ') && !JSON.stringify(taskOf('継ぐ').properties).includes('自分'), 3000, 'the value is still written');
            await sleep(300);
            return JSON.stringify({ emptied, list: list() });
        `);
        expect(result.emptied).toMatchObject({ selected: null });
        expect((result.emptied as { items: number }).items).toBeGreaterThan(0);
        expect(result.list).toBeNull();
        expect(blockOf('継ぐ')).toEqual(['- [ ] 継ぐ @2026-10-01']);
    });

    it('the tag field: an Enter in it empty adds no tag', () => {
        const before = readTestFile(TEST_FILE);
        const result = run<Record<string, unknown>>(`
            await openOn('空');
            const opened = await focusOn(tagInput());
            keys('Enter');
            await sleep(800);
            return JSON.stringify({ opened, list: list(), tags: taskOf('空').tags, field: tagInput().value });
        `);
        expect(result.opened).toMatchObject({ selected: null });
        expect((result.opened as { items: number }).items).toBeGreaterThan(0);
        expect(result).toMatchObject({ list: null, tags: [], field: '' });
        expect(readTestFile(TEST_FILE)).toBe(before);
    });

    it('the note field of a task to make: an Enter in it empty puts no note in, and makes nothing', () => {
        const result = run<Record<string, unknown>>(`
            const files = app.vault.getMarkdownFiles().length;
            plugin.openDraftHub(null, { startDate: '2031-02-03' });
            await until(() => draft() && noteInput());
            await sleep(400);
            if (tabOn() !== 'basic') { tab('basic').click(); await sleep(200); }
            const opened = await focusOn(noteInput());
            keys('Enter');
            await sleep(800);
            return JSON.stringify({ opened, list: list(), open: !!draft(), note: noteInput().value, files: app.vault.getMarkdownFiles().length - files });
        `);
        expect(result.opened).toMatchObject({ selected: null });
        expect((result.opened as { items: number }).items).toBeGreaterThan(0);
        expect(result).toMatchObject({ list: null, open: true, note: '', files: 0 });
    });
});

describe('an ArrowDown in an empty field selects the first item, and the Enter after it puts it in', () => {
    it('the tag field: the first tag is added', () => {
        const result = run<Record<string, unknown>>(`
            await openOn('空');
            const opened = await focusOn(tagInput());
            keys('Down');
            await sleep(200);
            const moved = list();
            keys('Enter');
            await until(() => taskOf('空')?.tags.length > 0, 3000, 'no tag added');
            return JSON.stringify({ opened: opened.selected, moved: moved.selected, tags: taskOf('空').tags });
        `);
        expect(result.opened).toBeNull();
        expect(result.moved).toMatch(/^#e2e-ee-tag-[ab]$/);
        expect(result.tags).toEqual([(result.moved as string).slice(1)]);
        expect(blockOf('空').join('\n')).toContain(result.moved as string);
    });
});
