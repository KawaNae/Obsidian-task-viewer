import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { TaskApi } from '../../../src/api/TaskApi';
import { TaskReadService } from '../../../src/services/data/TaskReadService';
import { openLiveVault, vaultSession, type VaultSession } from '../helpers/vaultSession';
import { editorSession } from '../helpers/editorSession';
import { freezeDate } from '../helpers/fakeDate';
import { DEFAULT_SETTINGS } from '../../../src/types';
import type { SectionSide } from '../../../src/services/persistence/utils/Placement';

/**
 * A move stays in its note (F8, the decision of 2026-09-26): `move([[#name]])`
 * carries the completed row and its subtree to that heading's section, at
 * the side the settings say (`sectionSide`, the head unless set; the
 * decision of 2026-09-28). A heading that is not there, or is there twice,
 * fires nothing: the completion is written, the command stays, and the user
 * is told. A move that names no heading of the note — another note, or
 * nothing at all, `move()` — is a syntax error (2026-10-01): the command does
 * not read, so nothing fires and nothing is said; the editor marks it. The
 * same on every path that completes a row — a card, the API, the editor.
 */

freezeDate(new Date(2026, 8, 25, 12, 0, 0));

const FILE = 'note.md';

let live: VaultSession | undefined;

beforeEach(() => {
    Notice.messages.length = 0;
});

afterEach(() => {
    live?.dispose();
    live = undefined;
});

async function open(lines: string[], side: SectionSide = 'head') {
    const { contents, session } = await openLiveVault({ [FILE]: lines }, s => { live = s; });
    if (side !== 'head') session.index.updateSettings({ ...DEFAULT_SETTINGS, sectionSide: side });
    const idOf = (content: string) => session.index.getTasks().find(task => task.content === content)!.id;
    const read = () => contents.get(FILE)!.split('\n');
    return { contents, session, idOf, read };
}

type Path = 'card' | 'api' | 'editor';

/** Complete the row reading `content` on line `line`, by `path`, and answer the note's lines once it has settled. */
async function complete(lines: string[], line: number, content: string, path: Path, side: SectionSide = 'head'): Promise<string[]> {
    const note = await open(lines, side);
    if (path === 'card') {
        await note.session.ops.updateTask(note.idOf(content), { statusChar: 'x' });
        await note.session.flowSettled(FILE);
        return note.read();
    }
    if (path === 'api') {
        const api = new TaskApi({
            app: note.session.app,
            settings: { startHour: 0 },
            getTaskReadService: () => new TaskReadService(note.session.index, () => ({ startHour: 0, weekStartDay: 1 })),
            getIndex: () => note.session.index,
            getOperations: () => note.session.ops,
        } as never);
        await api.update({ id: note.idOf(content), status: 'x' });
        await note.session.flowSettled(FILE);
        return note.read();
    }
    const editor = editorSession(note.session.ops.editorFireHost(), FILE, note.contents.get(FILE)!);
    editor.check(line);
    await Promise.resolve();
    return editor.lines();
}

const NOTE = [
    '# note',
    '- [ ] 移す @2026-09-21 ==> move([[#Done]])',
    '    - [ ] 子',
    '    text',
    '## Done',
    '- [x] old',
    '    - [x] old child',
    '',
    '### Deeper',
    '- [x] deep',
    '',
    '## Later',
    '- [ ] later',
    '',
];

describe.each<Path>(['card', 'api', 'editor'])('a move within the note, from the %s', (path) => {
    it('carries the row and its subtree to the head of the heading\'s section', async () => {
        expect(await complete(NOTE, 1, '移す', path)).toEqual([
            '# note',
            '## Done',
            '- [x] 移す @2026-09-21',
            '    - [ ] 子',
            '    text',
            '- [x] old',
            '    - [x] old child',
            '',
            '### Deeper',
            '- [x] deep',
            '',
            '## Later',
            '- [ ] later',
            '',
        ]);
        expect(Notice.messages).toEqual([]);
    });

    it('carries the row and its subtree to the end of the heading\'s section, short of its deeper headings, with the end side', async () => {
        expect(await complete(NOTE, 1, '移す', path, 'end')).toEqual([
            '# note',
            '## Done',
            '- [x] old',
            '    - [x] old child',
            '- [x] 移す @2026-09-21',
            '    - [ ] 子',
            '    text',
            '',
            '### Deeper',
            '- [x] deep',
            '',
            '## Later',
            '- [ ] later',
            '',
        ]);
        expect(Notice.messages).toEqual([]);
    });

    it('writes the next instance where the row was, and carries the row', async () => {
        const lines = ['# note', '- [ ] 移す @2026-09-21 ==> +1d move([[#Done]])', '## Done', ''];
        expect(await complete(lines, 1, '移す', path)).toEqual([
            '# note', '- [ ] 移す @2026-09-22 ==> +1d move([[#Done]])', '## Done', '- [x] 移す @2026-09-21', '',
        ]);
    });

    it.each([
        ['no heading of the name', ['## Other'], "No heading 'Done'"],
        ['two headings of the name', ['## Done', '## done'], "2 headings are named 'Done'"],
    ])('fires nothing when there is %s: the completion stays, with its command, and says why', async (_name, headings, said) => {
        const lines = ['# note', '- [ ] 移す @2026-09-21 ==> +1d move([[#Done]])', '    - [ ] 子', ...headings, ''];
        expect(await complete(lines, 1, '移す', path)).toEqual([
            '# note', '- [x] 移す @2026-09-21 ==> +1d move([[#Done]])', '    - [ ] 子', ...headings, '',
        ]);
        await Promise.resolve();
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toContain(said);
    });

    it.each([
        'move()',
        'move([[Other]])',
        'move([[note#Done]])',
        'move("Log/Done")',
        'move([[Log/]] + format(done, "YYYY-MM"))',
        'nochildren',
    ])('fires nothing for a command that does not read: %s', async (clause) => {
        const lines = ['# note', `- [ ] 移す @2026-09-21 ==> +1d ${clause}`, '    - [ ] 子', '## Done', ''];
        expect(await complete(lines, 1, '移す', path)).toEqual([
            '# note', `- [x] 移す @2026-09-21 ==> +1d ${clause}`, '    - [ ] 子', '## Done', '',
        ]);
        await Promise.resolve();
        expect(Notice.messages).toEqual([]);
    });
});

/**
 * A heading is a bound of the note's structure as an item is: a write puts
 * no line past one, and leaves every one reading as it did (F8's
 * counterexample run, R1 and R2). A move that would is refused, the
 * completion written alone and the command kept, and the user is told.
 */
describe.each<Path>(['card', 'api', 'editor'])('a move and the headings around it, from the %s', (path) => {
    it.each([
        ['an indented heading just below an empty section (R1)', ['## Log', '   ## Next', '- [x] b']],
        ['a setext heading just below an empty section (R1)', ['## Log', 'Next', '----']],
        ['an indented heading below the section\'s paragraph (R1)', ['## Log', 'words', '', '  ## Next']],
    ])('does not carry the row past %s', async (_name, below) => {
        const lines = ['# note', '- [ ] A ==> move([[#Log]])', ...below, ''];
        expect(await complete(lines, 1, 'A', path)).toEqual(['# note', '- [x] A ==> move([[#Log]])', ...below, '']);
        await Promise.resolve();
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toMatch(/heading/);
    });

    it.each([
        ['a paragraph and a rule become a setext heading (R2)', ['Para', '- [ ] A ==> move([[#Done]])', '---', '## Done'], 2],
        ['an indented heading goes into the item above (R2)', ['1. [x] Z', '  1. [ ] A ==> move([[#Done]])', '   # H', '## Done'], 2],
    ])('does not take the row out when %s', async (_name, note, line) => {
        const lines = ['# note', ...note, ''];
        const expected = lines.map(text => text.replace('[ ] A', '[x] A'));
        expect(await complete(lines, line, 'A', path)).toEqual(expected);
        await Promise.resolve();
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toMatch(/heading/);
    });
});

describe('a parent\'s move and a child\'s fire in one editor transaction (R10 within a note)', () => {
    const PARENT = '- [ ] P @2026-09-21 ==> move([[#Done]])';

    async function both(child: string, headings: string[] = [], side: SectionSide = 'end'): Promise<{ lines: string[]; fired: string[] }> {
        const note = await open(['# note', PARENT, `    - [ ] C @2026-09-21 ==> ${child}`, '## Done', '- [x] old', '', ...headings, ''], side);
        const fired: string[] = [];
        const plan = note.session.executor.planFire.bind(note.session.executor);
        note.session.executor.planFire = (...args) => {
            const planned = plan(...args);
            if (planned.kind !== 'none') fired.push(`${planned.task.content}:${planned.kind}`);
            return planned;
        };
        const editor = editorSession(note.session.ops.editorFireHost(), FILE, note.contents.get(FILE)!);
        const status = (line: number) => editor.at(line, editor.lines()[line].indexOf('[') + 1);
        editor.change([
            { from: status(1), to: status(1) + 1, insert: 'x' },
            { from: status(2), to: status(2) + 1, insert: 'x' },
        ], 'input.type');
        await Promise.resolve();
        return { lines: editor.lines(), fired };
    }

    it('fires each once, the child\'s next instance in the parent\'s subtree where it went', async () => {
        const { lines, fired } = await both('+1d');
        expect(fired).toEqual(['P:fires', 'C:fires']);
        expect(lines).toEqual([
            '# note', '## Done', '- [x] old', '- [x] P @2026-09-21',
            '    - [ ] C @2026-09-22 ==> +1d', '    - [x] C @2026-09-21', '', '',
        ]);
    });

    it('puts the child past the parent\'s subtree, at the top, when both go to one heading', async () => {
        const { lines } = await both('move([[#Done]])');
        expect(lines).toEqual(['# note', '## Done', '- [x] old', '- [x] P @2026-09-21', '- [x] C @2026-09-21', '', '']);
    });

    it('puts the child at the section\'s head, above the parent, when both go to one heading at its head', async () => {
        const { lines, fired } = await both('move([[#Done]])', [], 'head');
        expect(fired).toEqual(['P:fires', 'C:fires']);
        expect(lines).toEqual(['# note', '## Done', '- [x] C @2026-09-21', '- [x] P @2026-09-21', '- [x] old', '', '']);
    });

    it('carries the child to its own heading', async () => {
        const { lines } = await both('move([[#Later]])', ['## Later', '- [ ] later']);
        expect(lines).toEqual([
            '# note', '## Done', '- [x] old', '- [x] P @2026-09-21', '', '## Later', '- [ ] later', '- [x] C @2026-09-21', '',
        ]);
    });

    it('fires the child once when the parent\'s move carries it to another indentation', async () => {
        const note = await open(['# note', '- [ ] Q', '    - [ ] P @2026-09-21 ==> move([[#Done]])', '        - [ ] C @2026-09-21 ==> +1d', '## Done', '']);
        const editor = editorSession(note.session.ops.editorFireHost(), FILE, note.contents.get(FILE)!);
        const status = (line: number) => editor.at(line, editor.lines()[line].indexOf('[') + 1);
        editor.change([
            { from: status(2), to: status(2) + 1, insert: 'x' },
            { from: status(3), to: status(3) + 1, insert: 'x' },
        ], 'input.type');
        await Promise.resolve();
        expect(editor.lines()).toEqual([
            '# note', '- [ ] Q', '## Done', '- [x] P @2026-09-21', '    - [ ] C @2026-09-22 ==> +1d', '    - [x] C @2026-09-21', '',
        ]);
        expect(Notice.messages).toEqual([]);
    });

    it('fires the child where it stands when the parent\'s fire fails', async () => {
        const note = await open(['# note', '- [ ] P @2026-09-21 ==> move([[#Nope]])', '    - [ ] C @2026-09-21 ==> +1d', '']);
        const editor = editorSession(note.session.ops.editorFireHost(), FILE, note.contents.get(FILE)!);
        const status = (line: number) => editor.at(line, editor.lines()[line].indexOf('[') + 1);
        editor.change([
            { from: status(1), to: status(1) + 1, insert: 'x' },
            { from: status(2), to: status(2) + 1, insert: 'x' },
        ], 'input.type');
        await Promise.resolve();
        expect(editor.lines()).toEqual([
            '# note', '- [x] P @2026-09-21 ==> move([[#Nope]])', '    - [ ] C @2026-09-22 ==> +1d', '    - [x] C @2026-09-21', '',
        ]);
        expect(Notice.messages).toHaveLength(1);
    });
});

describe.each<Path>(['card', 'api', 'editor'])('the ^ids a move carries, from the %s', (path) => {
    it('keeps the row\'s and its children\'s, to a heading', async () => {
        const lines = ['# note', '- [ ] 移す @2026-09-21 ==> move([[#Done]]) ^keep', '    - [ ] 子 ^kid', '        - [ ] 孫 ^deep', '## Done', ''];
        expect(await complete(lines, 1, '移す', path)).toEqual([
            '# note', '## Done', '- [x] 移す @2026-09-21 ^keep', '    - [ ] 子 ^kid', '        - [ ] 孫 ^deep', '',
        ]);
    });

    it('keeps them to the end of a section, and gives the next instance none', async () => {
        const lines = ['# note', '- [ ] 移す @2026-09-21 ==> +1d move([[#Done]]) ^keep', '    - [ ] 子 ^kid', '- [ ] U', '## Done', '- [x] old', ''];
        expect(await complete(lines, 1, '移す', path, 'end')).toEqual([
            '# note', '- [ ] 移す @2026-09-22 ==> +1d move([[#Done]])', '- [ ] U', '## Done', '- [x] old', '- [x] 移す @2026-09-21 ^keep', '    - [ ] 子 ^kid', '',
        ]);
    });
});

/**
 * An ordered row is numbered where it lands (`ListNumber.at`): on from the
 * ordered item straight above it, else 1, the one number that interrupts a
 * paragraph.
 */
describe.each<Path>(['card', 'api', 'editor'])('an ordered row a move carries, from the %s', (path) => {
    const LIST = ['# note', '3. [ ] T @2026-09-21 ==> move([[#Done]])', '## Done', '1. [x] old', ''];

    it('opens the section\'s list at 1 at the head', async () => {
        expect(await complete(LIST, 1, 'T', path)).toEqual(['# note', '## Done', '1. [x] T @2026-09-21', '1. [x] old', '']);
    });

    it('goes on from the section\'s last item at the end', async () => {
        expect(await complete(LIST, 1, 'T', path, 'end')).toEqual(['# note', '## Done', '1. [x] old', '2. [x] T @2026-09-21', '']);
    });

    it('is numbered 1 past a paragraph, which a number past 1 would go on', async () => {
        const lines = ['# note', '5. [ ] T @2026-09-21 ==> move([[#Done]])', '## Done', 'words', ''];
        expect(await complete(lines, 1, 'T', path)).toEqual(['# note', '## Done', 'words', '1. [x] T @2026-09-21', '']);
        expect(Notice.messages).toEqual([]);
    });

    it('takes its children as far right as a wider number moves its content', async () => {
        const lines = ['# note', '1. [ ] T @2026-09-21 ==> move([[#Done]])', '   - [ ] c', '## Done', '9. [x] old', ''];
        expect(await complete(lines, 1, 'T', path, 'end')).toEqual(['# note', '## Done', '9. [x] old', '10. [x] T @2026-09-21', '    - [ ] c', '']);
        expect(Notice.messages).toEqual([]);
    });
});

describe('a moved row, after a reload', () => {
    it('is found by its ^id where it went', async () => {
        const note = await open(['# note', '- [ ] 移す @2026-09-21 ==> move([[#Done]]) ^keep', '    - [ ] 子 ^kid', '## Done', '']);
        await note.session.ops.updateTask(note.idOf('移す'), { statusChar: 'x' });
        await note.session.flowSettled(FILE);
        note.session.dispose();

        const reloaded = vaultSession(note.contents);
        live = reloaded;
        await reloaded.scanAll();
        expect(reloaded.index.getTaskByAnchor(FILE, 'keep')).toMatchObject({ content: '移す', line: 2, statusChar: 'x' });
        expect(reloaded.index.getTaskByAnchor(FILE, 'kid')).toMatchObject({ content: '子', line: 3 });
    });
});
