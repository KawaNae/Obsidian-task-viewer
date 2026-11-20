import { describe, it, expect, vi, afterEach } from 'vitest';
import realMoment from 'moment';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { valuesOf } from '../helpers/properties';
import { rowBlock, type NewRow } from '../../../src/services/persistence/NewRow';
import type { PropertyOp } from '../../../src/services/persistence/PropertyUpdatePlanner';
import { CreatePlaces } from '../../../src/services/data/CreatePlaces';
import { DEFAULT_SCOPE_KEYS, DEFAULT_SETTINGS } from '../../../src/types';

vi.mock('obsidian', async () => {
    const actual = await vi.importActual<typeof import('../mocks/obsidian')>('../mocks/obsidian');
    return { ...actual, moment: realMoment };
});

/**
 * A new row with its property lines, put by each write that adds a row:
 * the row and its property lines go in as one block (`rowBlock`), the write's
 * check takes it wherever the row goes, and the index reads back from the
 * note the values the row was handed.
 */

const FILE = 'note.md';
const DAY = '2031-01-15';
const DAILY = `${DAY}.md`;
const TEMPLATE = 'Templates/Daily.md';
const LS = String.fromCharCode(0x2028);

/** One of each kind of property a row's own lines write. */
const OPS: PropertyOp[] = [
    { key: 'tv-color', op: 'set', value: { text: 'ff0000' } },
    { key: 'tv-linestyle', op: 'set', value: { text: 'dashed' } },
    { key: 'tv-mask', op: 'set', value: { text: '***' } },
    { key: 'tags', op: 'set', value: { tags: ['a', 'b'] } },
    { key: 'owner', op: 'set', value: { text: 'me' } },
    { key: 'items', op: 'set', value: { items: ['x', 'y'] } },
    { key: 'empty', op: 'hide' },
];

const row = (line: string): NewRow => ({ line, properties: { ops: OPS, keys: DEFAULT_SCOPE_KEYS } });

/** The lines {@link OPS} write under a row, a level of `unit` under it, before the block goes at its spot. */
const propertyLines = (unit: string, at = '') => [
    `${at}${unit}- tv-color:: ff0000`,
    `${at}${unit}- tv-linestyle:: dashed`,
    `${at}${unit}- tv-mask:: ***`,
    `${at}${unit}- tags:: #a #b`,
    `${at}${unit}- owner:: me`,
    `${at}${unit}- items::`,
    `${at}${unit}${unit}- x`,
    `${at}${unit}${unit}- y`,
    `${at}${unit}- empty::`,
];

describe('rowBlock', () => {
    it('is the row alone when it has no properties, read with no indentation', () => {
        expect(rowBlock({ line: '\t- [ ] 新' }, '\t')).toEqual([{ text: '- [ ] 新', kind: 'item', under: 'spot' }]);
    });

    it('puts each property line under the row, a level of the unit, and a list\'s items a level under their line', () => {
        const block = rowBlock(row('- [ ] 新'), '    ');
        expect(Array.isArray(block) && block.map(line => line.text)).toEqual(['- [ ] 新', ...propertyLines('    ')]);
        expect(Array.isArray(block) && block.map(line => line.under)).toEqual(['spot', 0, 0, 0, 0, 0, 0, 6, 6, 0]);
    });

    it('answers why not when the properties cannot be written, its line that of the block', () => {
        const ops: PropertyOp[] = [
            { key: 'tv-linestyle', op: 'set', value: { text: 'wavy' } },
            { key: 'tv-linestyle', op: 'set', value: { text: 'dashed' } },
        ];
        expect(rowBlock({ line: '- [ ] 新', properties: { ops, keys: DEFAULT_SCOPE_KEYS } }, '\t'))
            .toEqual({ kind: 'property', key: 'tv-linestyle', line: 1 });
    });
});

let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; });

async function open(files: string[] | Record<string, string>, config?: Record<string, unknown>) {
    const opened = await openVault(files, config ? { config } : {});
    live = opened.session;
    // The daily notes as the core plugin's options name them.
    (opened.session.app as unknown as { internalPlugins: unknown }).internalPlugins = {
        getPluginById: (id: string) => (id === 'daily-notes' ? { instance: { options: { format: 'YYYY-MM-DD', folder: '', template: TEMPLATE } } } : null),
    };
    return opened;
}

const SPACES = { useTab: false, tabSize: 4 };

/** The one task of `file` worded `content`, which reads every value the row was handed. */
function readBack(session: VaultSession, file: string, content: string) {
    const found = session.index.getTasks().filter(task => task.file === file && task.content === content);
    expect(found, content).toHaveLength(1);
    const task = found[0];
    expect(task.color).toBe('ff0000');
    expect(task.linestyle).toBe('dashed');
    expect(task.mask).toBe('***');
    expect(task.tags).toEqual(['a', 'b']);
    expect(valuesOf(task.properties)).toMatchObject({
        owner: { type: 'text', spelling: 'me' },
        items: { type: 'list', items: [{ type: 'text', spelling: 'x' }, { type: 'text', spelling: 'y' }] },
        empty: { type: 'null', spelling: '' },
    });
    return task;
}

const idOf = (session: VaultSession, content: string) => session.index.getTasks().find(task => task.content === content)!.id;

describe('a new row with its properties, put where each write puts a row', () => {
    it('at the head of a section', async () => {
        const { contents, session } = await open(['# n', '## Tasks', '- [ ] 既存', '']);

        const out = await session.repository.putInNote(FILE, { heading: 'Tasks', level: 2, side: 'head' }, row('- [ ] 新'));
        expect(out.written).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toEqual(['# n', '## Tasks', '- [ ] 新', ...propertyLines('\t'), '- [ ] 既存', '']);
        readBack(session, FILE, '新');
    });

    it('at the end of a section, past a subtree, in a note indented with spaces', async () => {
        const { contents, session } = await open(['# n', '## Tasks', '- [ ] 既存', '    - [ ] c', '## Other', ''], SPACES);

        const out = await session.repository.putInNote(FILE, { heading: 'Tasks', level: 2, side: 'end' }, row('- [ ] 新'));
        expect(out.written).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toEqual(['# n', '## Tasks', '- [ ] 既存', '    - [ ] c', '- [ ] 新', ...propertyLines('    '), '## Other', '']);
        readBack(session, FILE, '新');
    });

    it('at the end of a note with no heading, and under a heading the write makes (`createTask`)', async () => {
        const { contents, session } = await open(['text', '- [ ] 既存', '']);

        expect(await session.ops.createTask(FILE, row('- [ ] 新'))).toBe(2);
        await session.settle(FILE);
        expect(await session.ops.createTask(FILE, row('- [ ] 二'), 'Made')).not.toBeNull();
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toEqual([
            'text', '- [ ] 既存', '- [ ] 新', ...propertyLines('\t'), '', '## Made', '- [ ] 二', ...propertyLines('\t'), '',
        ]);
        readBack(session, FILE, '新');
        readBack(session, FILE, '二');
    });

    it('in a daily note not there yet, made of its template in the same write (`putInDailyNote`)', async () => {
        const { contents, session } = await open({ [TEMPLATE]: '# {{date}}\n## Tasks\n- [ ] 雛形\n' });

        expect(await session.ops.putInDailyNote(DAY, row('- [ ] 新'))).toEqual({ written: true, path: DAILY });
        await session.settle(DAILY);

        expect(contents.get(DAILY)!.split('\n')).toEqual([`# ${DAY}`, '## Tasks', '- [ ] 新', ...propertyLines('\t'), '- [ ] 雛形', '']);
        readBack(session, DAILY, '新');
    });

    for (const [name, lines, config, unit, at] of [
        ['with children, indented with tabs', ['- [ ] P', '\t- [ ] c', '\t- tv-color:: 00ff00', ''], undefined, '\t', '\t'],
        ['with children, indented with two spaces', ['- [ ] P', '  - [ ] c', ''], SPACES, '    ', '  '],
        ['with none, indented with spaces', ['- [ ] P', '- [ ] Q', ''], { useTab: false, tabSize: 2 }, '  ', '  '],
    ] as const) {
        it(`at the head of a row's children (\`insertLine\`): ${name}`, async () => {
            const { contents, session } = await open([...lines], config ? { ...config } : undefined);

            expect((await session.ops.insertLine(idOf(session, 'P'), row('- [ ] 新'), 'firstChild')).written).toBe(true);
            await session.settle(FILE);

            expect(contents.get(FILE)!.split('\n')).toEqual([lines[0], `${at}- [ ] 新`, ...propertyLines(unit, at), ...lines.slice(1)]);
            expect(session.index.getTask(readBack(session, FILE, '新').parentId!)?.content).toBe('P');
        });
    }

    it('from a place to create in (`CreatePlaces.create`): a row\'s child, and the daily note', async () => {
        const { contents, session } = await open({ [FILE]: '- [ ] P\n', [DAILY]: '## Tasks\n' });
        const places = new CreatePlaces(session.app, session.ops, () => DEFAULT_SETTINGS, (id) => session.index.getTask(id));

        expect((await places.create({ kind: 'childOf', taskId: idOf(session, 'P') }, row('- [ ] 子'))).written).toBe(true);
        expect((await places.create({ kind: 'dailyNote', date: DAY }, row('- [ ] 日'))).written).toBe(true);
        await session.settle(FILE);
        await session.settle(DAILY);

        expect(contents.get(FILE)).toBe(['- [ ] P', '\t- [ ] 子', ...propertyLines('\t', '\t'), ''].join('\n'));
        expect(contents.get(DAILY)).toBe(['## Tasks', '- [ ] 日', ...propertyLines('\t'), ''].join('\n'));
        readBack(session, FILE, '子');
        readBack(session, DAILY, '日');
    });

    it('in a note with CRLF, under a heading and as a child, every line ending with CRLF', async () => {
        const { contents, session } = await open({ [FILE]: ['# n', '## Tasks', '- [ ] P', ''].join('\r\n') });

        expect(await session.ops.createTask(FILE, row('- [ ] 新'), 'Tasks')).toBe(2);
        await session.settle(FILE);
        expect((await session.ops.insertLine(idOf(session, 'P'), row('- [ ] 子'), 'firstChild')).written).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe([
            '# n', '## Tasks', '- [ ] 新', ...propertyLines('\t'), '- [ ] P', '\t- [ ] 子', ...propertyLines('\t', '\t'), '',
        ].join('\r\n'));
        readBack(session, FILE, '新');
        readBack(session, FILE, '子');
    });

    it('with U+2028 in its content, which stays inside its line', async () => {
        const { contents, session } = await open(['# n', '- [ ] P', '']);

        expect((await session.ops.insertLine(idOf(session, 'P'), row(`- [ ] 新${LS}続き`), 'firstChild')).written).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toEqual(['# n', '- [ ] P', `\t- [ ] 新${LS}続き`, ...propertyLines('\t', '\t'), '']);
        const [task] = session.index.getTasks().filter(task => task.file === FILE && task.content.startsWith('新'));
        readBack(session, FILE, task.content);
    });

    it('is written with no indentation of its own, under a heading and at the end of a note alike (`createTask`)', async () => {
        const { contents, session } = await open(['# n', '## Tasks', '- [ ] 既存', '', '## Last', 'text', '']);

        expect(await session.ops.createTask(FILE, { line: '\t- [ ] 見出し' }, 'Tasks')).toBe(2);
        await session.settle(FILE);
        expect(await session.ops.createTask(FILE, { line: '    - [ ] 末尾' })).not.toBeNull();
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toEqual(['# n', '## Tasks', '- [ ] 見出し', '- [ ] 既存', '', '## Last', 'text', '- [ ] 末尾', '']);
    });

    it('is told by its text, the spaces around it aside, when it is refused', async () => {
        const { session } = await open(['## Tasks', '- [ ] a', '## Tasks', '']);

        const put = await session.repository.putInNote(FILE, { heading: 'Tasks', level: 2, side: 'head' }, { line: ' \t- [ ] 新  ' });

        expect(put.written ? null : put.refused).toEqual({ file: FILE, reason: { kind: 'headings', name: 'Tasks', count: 2 }, subject: '- [ ] 新' });
    });

    it('is not written when its properties cannot be, and the user hears which line', async () => {
        const { contents, session } = await open(['# n', '## Tasks', '- [ ] P', '']);
        const before = contents.get(FILE);
        const ops: PropertyOp[] = [
            { key: 'tv-linestyle', op: 'set', value: { text: 'wavy' } },
            { key: 'tv-linestyle', op: 'set', value: { text: 'dashed' } },
        ];
        const bad = { line: '- [ ] 新', properties: { ops, keys: DEFAULT_SCOPE_KEYS } };

        const put = await session.repository.putInNote(FILE, { heading: 'Tasks', level: 2, side: 'head' }, bad);
        const child = await session.ops.insertLine(idOf(session, 'P'), bad, 'firstChild');

        expect(put.written ? null : put.refused.reason).toEqual({ kind: 'property', key: 'tv-linestyle', line: 3 });
        expect(child.written ? null : child.refused?.reason).toEqual({ kind: 'property', key: 'tv-linestyle', line: 4 });
        expect(contents.get(FILE)).toBe(before);
    });
});
