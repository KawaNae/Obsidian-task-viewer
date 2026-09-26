import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { TaskApi } from '../../../src/api/TaskApi';
import { TaskReadService } from '../../../src/services/data/TaskReadService';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { editorSession } from '../helpers/editorSession';
import { freezeDate } from '../helpers/fakeDate';

/**
 * A move stays in its note (F8, the decision of 2026-09-26): `move()` carries
 * the completed row and its subtree to the end of the note, `move([[#name]])`
 * to the end of that heading's section. A heading that is not there, or is
 * there twice, and a move that names another note, fire nothing: the
 * completion is written, the command stays, and the user is told. The same
 * on every path that completes a row — a card, the API, the editor.
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

async function open(lines: string[]) {
    const { contents, session } = await openVault({ [FILE]: lines });
    live = session;
    const idOf = (content: string) => session.index.getTasks().find(task => task.content === content)!.id;
    const read = () => contents.get(FILE)!.split('\n');
    return { contents, session, idOf, read };
}

type Path = 'card' | 'api' | 'editor';

/** Complete the row reading `content` on line `line`, by `path`, and answer the note's lines once it has settled. */
async function complete(lines: string[], line: number, content: string, path: Path): Promise<string[]> {
    const note = await open(lines);
    if (path === 'card') {
        await note.session.index.updateTask(note.idOf(content), { statusChar: 'x' });
        await note.session.flowSettled(FILE);
        return note.read();
    }
    if (path === 'api') {
        const api = new TaskApi({
            app: note.session.app,
            settings: { startHour: 0 },
            getTaskReadService: () => new TaskReadService(note.session.index, 0),
            getTaskWriteService: () => new TaskWriteService(note.session.index),
        } as never);
        await api.update({ id: note.idOf(content), status: 'x' });
        await note.session.flowSettled(FILE);
        return note.read();
    }
    const editor = editorSession(note.session.index.editorFireHost(), FILE, note.contents.get(FILE)!);
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
    it('carries the row and its subtree to the end of the heading\'s section, past its deeper headings', async () => {
        expect(await complete(NOTE, 1, '移す', path)).toEqual([
            '# note',
            '## Done',
            '- [x] old',
            '    - [x] old child',
            '',
            '### Deeper',
            '- [x] deep',
            '- [x] 移す @2026-09-21',
            '    - [ ] 子',
            '    text',
            '',
            '## Later',
            '- [ ] later',
            '',
        ]);
        expect(Notice.messages).toEqual([]);
    });

    it('carries the row to the end of the note with move()', async () => {
        const lines = ['# note', '- [ ] 移す ==> move()', '    - [ ] 子', '## Later', '- [ ] later', ''];
        expect(await complete(lines, 1, '移す', path)).toEqual(['# note', '## Later', '- [ ] later', '- [x] 移す', '    - [ ] 子', '']);
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
        'move([[Log]])',
        'move([[note#Done]])',
        'move("Log/Done")',
        'move([[Log/]] + format(done, "YYYY-MM"))',
    ])('fires nothing for a move that names another note, retired: %s', async (command) => {
        const lines = ['# note', `- [ ] 移す @2026-09-21 ==> +1d ${command}`, '## Done', ''];
        expect(await complete(lines, 1, '移す', path)).toEqual([
            '# note', `- [x] 移す @2026-09-21 ==> +1d ${command}`, '## Done', '',
        ]);
        await Promise.resolve();
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toContain('within its note');
    });
});

describe('a parent\'s move and a child\'s fire in one editor transaction (R10 within a note)', () => {
    const PARENT = '- [ ] P @2026-09-21 ==> move([[#Done]])';

    async function both(child: string, headings: string[] = []): Promise<{ lines: string[]; fired: string[] }> {
        const note = await open(['# note', PARENT, `    - [ ] C @2026-09-21 ==> ${child}`, '## Done', '- [x] old', '', ...headings, '']);
        const fired: string[] = [];
        const plan = note.session.executor.planFire.bind(note.session.executor);
        note.session.executor.planFire = (...args) => {
            const planned = plan(...args);
            if (planned.kind !== 'none') fired.push(`${planned.task.content}:${planned.kind}`);
            return planned;
        };
        const editor = editorSession(note.session.index.editorFireHost(), FILE, note.contents.get(FILE)!);
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

    it('carries the child out of the parent\'s subtree to the end of the note with move()', async () => {
        const { lines, fired } = await both('move()');
        expect(fired).toEqual(['P:fires', 'C:fires']);
        expect(lines).toEqual(['# note', '## Done', '- [x] old', '- [x] P @2026-09-21', '', '- [x] C @2026-09-21', '']);
    });

    it('puts the child past the parent\'s subtree, at the top, when both go to one heading', async () => {
        const { lines } = await both('move([[#Done]])');
        expect(lines).toEqual(['# note', '## Done', '- [x] old', '- [x] P @2026-09-21', '- [x] C @2026-09-21', '', '']);
    });

    it('carries the child to its own heading', async () => {
        const { lines } = await both('move([[#Later]])', ['## Later', '- [ ] later']);
        expect(lines).toEqual([
            '# note', '## Done', '- [x] old', '- [x] P @2026-09-21', '', '## Later', '- [ ] later', '- [x] C @2026-09-21', '',
        ]);
    });

    it('fires the child where it stands when the parent\'s fire fails', async () => {
        const note = await open(['# note', '- [ ] P @2026-09-21 ==> move([[#Nope]])', '    - [ ] C @2026-09-21 ==> +1d', '']);
        const editor = editorSession(note.session.index.editorFireHost(), FILE, note.contents.get(FILE)!);
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
