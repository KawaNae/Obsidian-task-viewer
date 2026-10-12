/**
 * Hiding an inherited value in the hub, in the running Dev vault: a row
 * that inherits a value and does not hide it offers to hide it, which
 * writes its own line with no value (`- key::`); a row's own no value shows
 * as an empty field that says so, and its × takes the line out, so the
 * value above comes through. The style fields do the same.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/property-hide.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';

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
    '',
];

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const rowOf = label => [...hub().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent.trim() === label);
const nameInput = () => hub().querySelector('.tv-form__name-section input');
const shown = el => !!el && getComputedStyle(el).display !== 'none';
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

describe('the hub hides an inherited value', () => {
    it('hides an inherited property, and then shows the row\'s no value with its ×', () => {
        openHub('親');
        const after = run<Record<string, unknown>>(`
            rowOf('area').querySelector('.task-hub__hide').click();
            await sleep(600);
            const row = rowOf('area');
            const input = row.querySelector('input');
            return JSON.stringify({ value: input.value, placeholder: input.placeholder, remove: shown(row.querySelector('.task-hub__prop-remove')), hide: !!row.querySelector('.task-hub__hide') });
        `);
        expect(readTestFile(TEST_FILE)).toBe(withLines(5, 5, '\t- area::'));
        expect(after).toEqual({ value: '', placeholder: tr('modal.hub.noValue'), remove: true, hide: false });
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

    it('takes a row\'s own no value out by its ×, and the value above comes through', () => {
        openHub('隠した');
        const before = run<Record<string, unknown>>(`
            const area = rowOf('area').querySelector('input');
            const mask = rowOf(${JSON.stringify(tr('modal.hub.mask'))});
            return JSON.stringify({
                area: [area.value, area.placeholder],
                mask: [mask.querySelector('input').placeholder, shown(mask.querySelector('.task-hub__prop-remove')), shown(mask.querySelector('.task-hub__hide'))],
            });
        `);
        expect(before).toEqual({ area: ['', tr('modal.hub.noValue')], mask: [tr('modal.hub.noValue'), true, false] });
        run(`rowOf('area').querySelector('.task-hub__prop-remove').click(); await sleep(600); return 'ok';`);
        expect(readTestFile(TEST_FILE)).toBe(withLines(6, 7));
        run(`
            const mask = rowOf(${JSON.stringify(tr('modal.hub.mask'))});
            mask.querySelector('.task-hub__prop-remove').click();
            await sleep(600);
            return 'ok';
        `);
        expect(readTestFile(TEST_FILE)).toBe(withLines(6, 8));
    });
});
