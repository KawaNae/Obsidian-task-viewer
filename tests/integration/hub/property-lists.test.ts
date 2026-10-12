/**
 * The hub's lists, in the running Dev vault: a custom property's list is
 * shown an item a line, each item edited, taken out, added and moved, and
 * every edit writes the list as its block of the note. An item that would
 * not read back as one is said under the row and not written. An inherited
 * list is shown and not edited, and made the row's own from a copy of its
 * items, written by the first edit.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/property-lists.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';

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
const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const rowOf = label => [...hub().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === label);
const items = key => [...rowOf(key).querySelectorAll('.task-hub__list-items .task-hub__list-item input')];
const addItem = key => rowOf(key).querySelector('.task-hub__list-add');
const nameInput = () => hub().querySelector('.tv-form__name-section input');
const says = row => [...row.nextElementSibling.children].map(c => c.className + ': ' + c.firstChild.textContent);
const type = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
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
        hub()?.querySelector('.task-hub__form .tv-form__discard')?.click();
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

describe('the hub edits a list item by item', () => {
    it('shows the row\'s own list an item an input, and an inherited one as items not edited', () => {
        openHub('親');
        const shown = run<Record<string, unknown>>(`
            return JSON.stringify({
                own: items('k').map(i => i.value),
                add: !!addItem('k'),
                inherited: [...rowOf('area').querySelectorAll('.task-hub__list-chip')].map(c => c.textContent),
                inheritedInputs: rowOf('area').querySelectorAll('input').length,
                makeOwn: !!rowOf('area').querySelector('.task-hub__make-own'),
            });
        `);
        expect(shown).toEqual({ own: ['a', 'b'], add: true, inherited: ['lab', 'home'], inheritedInputs: 0, makeOwn: true });
    });

    it('shows no × that takes the row\'s own list out whole, as a value\'s row and the inherited list keep theirs', () => {
        openHub('親');
        const shown = run<Record<string, unknown>>(`
            const removes = row => row.querySelectorAll('.task-hub__prop-remove').length;
            return JSON.stringify({
                own: removes(rowOf('k')),
                itemRemoves: rowOf('k').querySelectorAll('.task-hub__list-item .tv-ctrl__pill-remove:not(.is-placeholder)').length,
                value: removes(rowOf('memo')),
                inherited: [removes(rowOf('area')), !!rowOf('area').querySelector('.task-hub__hide')],
            });
        `);
        expect(shown).toEqual({ own: 0, itemRemoves: 2, value: 1, inherited: [0, true] });
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

    it('takes an item out by its ×, and the line with the last one', () => {
        openHub('親');
        run(`items('k')[1].closest('.task-hub__list-item').querySelector('.tv-ctrl__pill-remove').click(); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(7, 8));
        run(`items('k')[0].closest('.task-hub__list-item').querySelector('.tv-ctrl__pill-remove').click(); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(5, 8));
    });

    it('leaves the focus where it was when an item is taken out', () => {
        openHub('親');
        const removeOf = `i => items('k')[i].closest('.task-hub__list-item').querySelector('.tv-ctrl__pill-remove')`;
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
        const left = run<boolean>(`type(items('k')[0], ''); nameInput().focus(); await sleep(600); return document.activeElement === nameInput();`);
        expect(left).toBe(true);
        expect(readTestFile(TEST_FILE)).toBe(withLines(5, 8));
    });

    it('follows the focus to the next item when an item typed over is written on leaving it', () => {
        openHub('親');
        const next = run<boolean>(`type(items('k')[0], 'c'); items('k')[1].focus(); await sleep(600); return document.activeElement === items('k')[1];`);
        expect(next).toBe(true);
        expect(readTestFile(TEST_FILE)).toBe(withLines(6, 7, '\t\t- c'));
    });

    it('moves an item by Alt+Down, and by dragging its handle', () => {
        openHub('親');
        run(`
            items('k')[0].focus();
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

    it('makes an inherited list the row\'s own from a copy, written by the first edit, leaving the focus out of its inputs', () => {
        openHub('親');
        const inInput = run<boolean>(`rowOf('area').querySelector('.task-hub__make-own').click(); await sleep(300); return document.activeElement instanceof HTMLInputElement;`);
        expect(inInput).toBe(false);
        expect(readTestFile(TEST_FILE)).toBe(LINES.join('\n'));
        const shown = run<string[]>(`return JSON.stringify(items('area').map(i => i.value));`);
        expect(shown).toEqual(['lab', 'home']);
        run(`type(addItem('area'), 'desk'); await enter(addItem('area')); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(9, 9, '\t- area::', '\t\t- lab', '\t\t- home', '\t\t- desk'));
    });

    it('throws a draft of an inherited list away by its ×, writing nothing', () => {
        openHub('親');
        run(`rowOf('area').querySelector('.task-hub__make-own').click(); await sleep(300); return 'ok';`);
        const shown = run<Record<string, unknown>>(`
            rowOf('area').querySelector('.task-hub__prop-remove').click();
            await sleep(300);
            return JSON.stringify({ inputs: rowOf('area').querySelectorAll('input').length, makeOwn: !!rowOf('area').querySelector('.task-hub__make-own') });
        `);
        expect(shown).toEqual({ inputs: 0, makeOwn: true });
        expect(readTestFile(TEST_FILE)).toBe(LINES.join('\n'));
    });
});
