/**
 * A property condition in the running Dev vault: the CLI's `property=`, a
 * filter file and the API's filter compare a property's value by its type,
 * a text in any case, a list item by item, and `isNotSet` finds no value
 * as it finds no key; the API gives each value as its type says.
 *
 * The tasks are in notes of the test's own, removed at the end.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/property-filter.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cliList, isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, waitForFileDeindexed, writeIndexedTestFile, writeTestFile } from '../helpers/test-file-manager';

const FILE = 'test-int-property-filter.md';
const FM_FILE = 'test-int-property-filter-fm.md';
const FILTER_FILE = 'test-int-property-filter.json';
const KEY = 'tvpf';

const NOTE = [
    `- [ ] pf-one`,
    `    - ${KEY}:: 1`,
    `- [ ] pf-one-dot`,
    `    - ${KEY}:: 1.0`,
    `- [ ] pf-hex`,
    `    - ${KEY}:: 0x1F`,
    `- [ ] pf-text123`,
    `    - ${KEY}:: "123"`,
    `- [ ] pf-num123`,
    `    - ${KEY}:: 123`,
    `- [ ] pf-true`,
    `    - ${KEY}:: True`,
    `- [ ] pf-lab`,
    `    - ${KEY.toUpperCase()}:: Lab`,
    `- [ ] pf-list`,
    `    - ${KEY}::`,
    `        - a`,
    `        - Bee`,
    `- [ ] pf-none`,
    `    - ${KEY}::`,
    `- [ ] pf-missing`,
    '',
].join('\n');

const FM_NOTE = ['---', `${KEY}:`, '---', '- [ ] pf-fm-none', ''].join('\n');

const FIELDS = { 'output-fields': 'id,content,file,properties', limit: 'all' };

/** The names of the test's rows among `tasks`. */
function names(tasks: Record<string, unknown>[]): string[] {
    return tasks
        .filter(t => t.file === FILE || t.file === FM_FILE)
        .map(t => String(t.content))
        .sort();
}

function apiList(filter: unknown): Record<string, unknown>[] {
    return obsidianEval(`(async () => {
        const api = app.plugins.plugins['obsidian-task-viewer'].api;
        const r = await api.list({ filter: ${JSON.stringify(filter)}, limit: Infinity });
        return JSON.stringify(r.tasks);
    })()`) as Record<string, unknown>[];
}

/** The rows a property condition passes, through the API's filter and a filter file alike. */
function which(operator: string, value?: string): string[] {
    const filter = { logic: 'and', filters: [{ property: 'property', operator, key: KEY, ...(value === undefined ? {} : { value }) }] };
    const viaApi = names(apiList(filter));
    writeTestFile(FILTER_FILE, JSON.stringify(filter));
    const viaFile = names(cliList({ ...FIELDS, 'filter-file': FILTER_FILE }).tasks);
    expect(viaFile).toEqual(viaApi);
    return viaApi;
}

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    expect(await writeIndexedTestFile(FILE, NOTE)).toBe(true);
    expect(await writeIndexedTestFile(FM_FILE, FM_NOTE)).toBe(true);
});

afterAll(async () => {
    deleteTestFile(FILE);
    deleteTestFile(FM_FILE);
    deleteTestFile(FILTER_FILE);
    await waitForFileDeindexed(FILE);
    await waitForFileDeindexed(FM_FILE);
});

describe('a property condition compares by type', () => {
    it('equals: numbers and booleans as values, a quoted value as text alone, a text in any case, a list item by item', () => {
        expect(which('equals', '1')).toEqual(['pf-one', 'pf-one-dot']);
        expect(which('equals', '31')).toEqual(['pf-hex']);
        expect(which('equals', '123')).toEqual(['pf-num123', 'pf-text123']);
        expect(which('equals', '"123"')).toEqual(['pf-text123']);
        expect(which('equals', 'TRUE')).toEqual(['pf-true']);
        expect(which('equals', 'lab')).toEqual(['pf-lab']);
        expect(which('equals', 'bee')).toEqual(['pf-list']);
    });

    it('contains: in a number\'s spelling, in one item of a list; the CLI\'s property= alike', () => {
        expect(which('contains', 'x1f')).toEqual(['pf-hex']);
        expect(which('contains', 'a, b')).toEqual([]);
        expect(names(cliList({ ...FIELDS, property: `${KEY}:EE` }).tasks)).toEqual(['pf-list']);
        expect(names(cliList({ ...FIELDS, property: `${KEY.toUpperCase()}:la` }).tasks)).toEqual(['pf-lab']);
    });

    it('isNotSet: no value on a line or in the frontmatter, and no key', () => {
        expect(which('isNotSet')).toEqual(['pf-fm-none', 'pf-missing', 'pf-none']);
    });
});

describe('the API gives a property as its type says', () => {
    it('a quoted text without its quotes, a number, a boolean, a list, no value as null, under the key as written', () => {
        const props = (name: string) => cliList({ ...FIELDS, file: FILE }).tasks.find(t => t.content === name)?.properties;
        expect(props('pf-text123')).toEqual({ [KEY]: '123' });
        expect(props('pf-hex')).toEqual({ [KEY]: 31 });
        expect(props('pf-true')).toEqual({ [KEY]: true });
        expect(props('pf-list')).toEqual({ [KEY]: ['a', 'Bee'] });
        expect(props('pf-none')).toEqual({ [KEY]: null });
        expect(props('pf-lab')).toEqual({ [KEY.toUpperCase()]: 'Lab' });
    });
});
