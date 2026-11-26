/**
 * Where a row's hub says the row stands, in the running E2E vault: the
 * General tab shows, after the dates, the note's path, the heading the row
 * stands under (none above the note's first heading) and, for a row under a
 * parent, the parent's text, each a row with no field and no reason under
 * them. The values follow the row through a write of the hub's own. A note
 * written from outside loses the row (the index follows a row's name across
 * the plugin's own writes alone): the rows stay, with no values.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/row-place.test.ts
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, writeIndexedTestFile, writeTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { DIALOG_ROWS } from '../helpers/dialog-rows';

const TEST_FILE = 'test-int-row-place.md';

const NOTE = [
    '- [ ] 見出しの上の行',
    '# 予定',
    '- [ ] 親の行',
    '    - [ ] 子の行',
    '## 来週',
    '- [ ] 見出しの下の行',
    '',
].join('\n');

/** The note written from outside: the child moved out of its parent, under the next heading. */
const MOVED = [
    '- [ ] 見出しの上の行',
    '# 予定',
    '- [ ] 親の行',
    '## 来週',
    '- [ ] 見出しの下の行',
    '- [ ] 子の行2',
    '',
].join('\n');

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
${DIALOG_ROWS}
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const rowNamed = start => plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(TEST_FILE)} && t.content.startsWith(start));
/** The rows the place shows, each its label and value; whether it says anything under them, and whether it stands in General after the dates. */
const place = () => {
    const group = hub().querySelector('.task-hub__shown');
    if (!group) return null;
    const basic = hubPane(hub(), 'basic');
    const dates = [...basic.querySelectorAll('.tv-form__field--date')].pop() ?? null;
    return {
        rows: [...group.querySelectorAll('.tv-form__row')].filter(row => getComputedStyle(row).display !== 'none')
            .map(row => [row.querySelector('.tv-form__label').textContent, row.querySelector('.task-hub__shown-value').textContent]),
        says: !!group.querySelector('.tv-form__says'),
        inBasic: basic.contains(group),
        afterDates: !!dates && !!(dates.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
};
/** Open the hub on the row whose name starts with \`start\`, and wait for its heading to be read. */
const openOn = async (start) => {
    plugin.openTaskHub(rowNamed(start).id);
    await until(() => hub()?.querySelector('.task-hub__shown'));
    await until(() => place().rows[1][1] !== '', 3000, () => JSON.stringify(place()));
};
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

interface Shown {
    rows: [string, string][];
    says: boolean;
    inBasic: boolean;
    afterDates: boolean;
}

afterEach(() => {
    run(`
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
        await until(() => !document.querySelector('.tv-overlay'));
        return 'true';
    `);
});

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

const NOTE_ROW: [string, string] = [tr('modal.note'), TEST_FILE];
const shownOf = (rows: [string, string][]): Shown => ({ rows, says: false, inBasic: true, afterDates: true });

describe('where a row\'s hub says the row stands', () => {
    it.each([
        ['見出しの下の行', [NOTE_ROW, [tr('modal.heading'), '来週']]],
        ['子の行', [NOTE_ROW, [tr('modal.heading'), '予定'], [tr('modal.parentTask'), '親の行']]],
        ['見出しの上の行', [NOTE_ROW, [tr('modal.heading'), tr('modal.newTask.noHeading')]]],
    ] as [string, [string, string][]][])('for %s, in General after the dates, with nothing said under it', async (start, rows) => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const seen = run<Shown>(`
            await openOn(${JSON.stringify(start)});
            return JSON.stringify(place());
        `);
        expect(seen).toEqual(shownOf(rows));
    });

    it('follows the row through a write of its own, and keeps its rows with no values once a note written from outside loses the row', async () => {
        await writeIndexedTestFile(TEST_FILE, NOTE);
        const written = run<Shown>(`
            await openOn('子の行');
            const input = hub().querySelector('.tv-form__name-section input');
            input.focus();
            input.value = '子の行2';
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
            await until(() => rowNamed('子の行2'), 5000, 'the name written');
            await sleep(300);
            return JSON.stringify(place());
        `);
        expect(written).toEqual(shownOf([NOTE_ROW, [tr('modal.heading'), '予定'], [tr('modal.parentTask'), '親の行']]));

        writeTestFile(TEST_FILE, MOVED);
        const lost = run<Shown>(`
            await until(() => place().rows[0][1] === '', 8000, () => JSON.stringify(place()));
            return JSON.stringify(place());
        `);
        expect(lost).toEqual(shownOf([[tr('modal.note'), ''], [tr('modal.heading'), ''], [tr('modal.parentTask'), '']]));
    });
});
