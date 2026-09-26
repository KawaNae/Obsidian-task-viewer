import { describe, it, expect, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, makeFile, vaultSession, type VaultSession } from '../../helpers/vaultSession';
import { plannedOn } from '../../../../src/services/persistence/TaskRefs';

/**
 * N1: a name lasts one reading of its file (the path, the reading's number,
 * the line). The index never pairs a reading with the one before it. A name
 * given before a write of ours is followed across the write's report
 * (`TaskIndex.getTask`); one given before any other change names nothing.
 */

const FILE = 'note.md';

let live: VaultSession[] = [];

afterEach(() => {
    for (const session of live) session.dispose();
    live = [];
    Notice.messages.length = 0;
});

async function open(lines: string[]) {
    const opened = await openVault(lines);
    live.push(opened.session);
    return opened;
}

const ids = (session: VaultSession) => session.index.getTasks()
    .filter(task => task.file === FILE)
    .sort((a, b) => a.line - b.line)
    .map(task => task.id);

function idOf(session: VaultSession, content: string): string {
    const found = session.index.getTasks().filter(task => task.file === FILE && task.content === content);
    expect(found).toHaveLength(1);
    return found[0].id;
}

describe('a reading\'s names', () => {
    it('are distinct, twins and a shared ^id included', async () => {
        const { session } = await open(['- [ ] A ^dup', '- [ ] A ^dup', '\t- [ ] A', '- [ ] A', '']);
        const names = ids(session);
        expect(names).toHaveLength(4);
        expect(new Set(names).size).toBe(4);
    });

    it('stay as they were across a modify that changed nothing, and across a read the index asks for of the same content', async () => {
        const { session } = await open(['# note', '- [ ] A', '- [ ] B', '']);
        const before = ids(session);

        session.fireVault('modify', makeFile(FILE));
        await session.settle(FILE);
        expect(ids(session)).toEqual(before);

        await session.scanner.requestScan(makeFile(FILE));
        expect(ids(session)).toEqual(before);
    });

    it('are not the next index\'s: after a reload, one of the same content names nothing', async () => {
        const { contents, session } = await open(['# note', '- [ ] A', '- [ ] B', '']);
        const before = ids(session);

        const reloaded = vaultSession(contents);
        live.push(reloaded);
        await reloaded.scanAll();
        expect(ids(reloaded).filter(id => before.includes(id))).toEqual([]);
        expect(before.map(id => reloaded.index.getTask(id))).toEqual([undefined, undefined]);
    });

    it('all change with any change to the file, a line no task stands on included', async () => {
        const { contents, session } = await open(['# note', '- [ ] A', '- [ ] B', '']);
        const before = ids(session);

        contents.set(FILE, ['# note!', '- [ ] A', '- [ ] B', ''].join('\n'));
        await session.scanner.queueScan(makeFile(FILE));
        const after = ids(session);
        expect(after.filter(id => before.includes(id))).toEqual([]);
        // Nothing from before the change is followed to anything.
        expect(before.map(id => session.index.getTask(id))).toEqual([undefined, undefined]);
    });
});

describe('a name given before our writes brought the file back to a content it had', () => {
    // The walk of stage N1 found these: a name made of the content's key
    // named the same line of both readings, and the store answered it before
    // the writes' reports were followed (`TaskIndex.getTask`).

    it('is followed to its row, not to the copy on its old line: delete the first twin, duplicate the second', async () => {
        const { contents, session } = await open(['- [ ] A', '- [ ] A', '']);
        const [r1, r2] = ids(session);
        session.holdScans();

        expect(await session.index.deleteTask(r1)).toBe(true);
        expect(await session.index.duplicateTask(r2)).toBe(true);
        expect(contents.get(FILE)).toBe(['- [ ] A', '- [ ] A', ''].join('\n'));

        // Neither name is one of this reading's: the store does not answer them.
        expect(ids(session).filter(id => id === r1 || id === r2)).toEqual([]);
        expect(session.index.getTask(r1)).toBeUndefined();
        const now = session.index.getTask(r2);
        expect(now?.line).toBe(0);

        expect(await session.index.updateTask(r2, { content: 'A2' })).toBe(true);
        expect(contents.get(FILE)).toBe(['- [ ] A2', '- [ ] A', ''].join('\n'));
    });

    it('names nothing once our write took its row away, though a copy of it stands on its line: duplicate, delete, update', async () => {
        const { contents, session } = await open(['- [ ] B', '- [ ] other', '']);
        const b = idOf(session, 'B');
        session.holdScans();

        expect(await session.index.duplicateTask(b)).toBe(true);
        expect(await session.index.deleteTask(b)).toBe(true);
        const back = contents.get(FILE);
        expect(back).toBe(['- [ ] B', '- [ ] other', ''].join('\n'));

        expect(session.index.getTask(b)).toBeUndefined();
        expect(await session.index.updateTask(b, { statusChar: 'x' })).toBe(false);
        expect(contents.get(FILE)).toBe(back);
    });

    it('is not written on its old line from a copy made before the writes, which the file reads as again', async () => {
        const { contents, session } = await open(['- [ ] A', '- [ ] A', '']);
        const [r1, r2] = ids(session);
        const held = session.index.getTask(r2)!;
        session.holdScans();

        expect(await session.index.deleteTask(r1)).toBe(true);
        expect(await session.index.duplicateTask(r2)).toBe(true);

        // The copy's line 1 reads as it did, in a content that reads as it
        // did: only the reading tells the rows apart. Carried across the two
        // writes, the row is on line 0.
        const written = await session.index.getRepository().updateTaskInFile(plannedOn(held), { ...held, content: 'A2', originalText: '- [ ] A2' });
        expect(written.written).toBe(true);
        expect(contents.get(FILE)).toBe(['- [ ] A2', '- [ ] A', ''].join('\n'));
    });
});

describe('a name given before edits from outside brought the file back to the content it was given in', () => {
    it('names nothing, and a copy made then is not written: the file came back, the reading did not', async () => {
        const { contents, session } = await open(['- [ ] A', '- [ ] A', '']);
        const [, r2] = ids(session);
        const held = session.index.getTask(r2)!;
        const first = contents.get(FILE)!;

        // Two edits from outside, each read: the second puts the first content back.
        contents.set(FILE, ['- [ ] A', ''].join('\n'));
        await session.scanner.queueScan(makeFile(FILE));
        contents.set(FILE, first);
        await session.scanner.queueScan(makeFile(FILE));

        expect(session.index.getTask(r2)).toBeUndefined();
        expect(await session.index.updateTask(r2, { statusChar: 'x' })).toBe(false);
        const written = await session.index.getRepository().updateTaskInFile(plannedOn(held), { ...held, statusChar: 'x', originalText: '- [x] A' });
        expect(written.written).toBe(false);
        expect(contents.get(FILE)).toBe(first);
    });
});

describe('a name given before a write of ours', () => {
    it('is followed to the row, on the line the write left it, and the copy carries the name it has now', async () => {
        const { session } = await open(['# note', '- [ ] A', '- [ ] B', '']);
        const a = idOf(session, 'A');
        const b = idOf(session, 'B');
        session.holdScans();

        expect(await session.index.getRepository().insertLineUnderHeading(FILE, '- [ ] 新', 'note', 1)).toMatchObject({ written: true });

        expect(session.index.getTask(a)?.content).toBe('A');
        expect(session.index.getTask(b)?.content).toBe('B');
        expect(session.index.getTask(b)?.id).toBe(idOf(session, 'B'));
        expect(session.index.getTask(b)?.id).not.toBe(b);
    });

    it('is followed across several of our writes in a row: a check clicked twice lands twice', async () => {
        const { contents, session } = await open(['# note', '- [ ] A', '- [ ] B', '']);
        const b = idOf(session, 'B');
        session.holdScans();

        expect(await session.index.updateTask(b, { statusChar: 'x' })).toBe(true);
        expect(await session.index.updateTask(b, { statusChar: ' ' })).toBe(true);
        expect(await session.index.updateTask(b, { content: 'B2' })).toBe(true);

        expect(contents.get(FILE)).toBe(['# note', '- [ ] A', '- [ ] B2', ''].join('\n'));
        expect(session.index.getTask(b)?.content).toBe('B2');
    });

    it('names nothing once our write took the row away', async () => {
        const { session } = await open(['- [ ] Z', '- [ ] A', '- [ ] B', '']);
        const a = idOf(session, 'A');
        expect(await session.index.deleteTask(a)).toBe(true);
        expect(session.index.getTask(a)).toBeUndefined();
    });

    it('names nothing once the file changed some other way after it', async () => {
        const { contents, session } = await open(['# note', '- [ ] A', '- [ ] B', '']);
        const b = idOf(session, 'B');
        expect(await session.index.updateTask(b, { statusChar: 'x' })).toBe(true);
        expect(session.index.getTask(b)?.statusChar).toBe('x');

        contents.set(FILE, ['メモ', ...contents.get(FILE)!.split('\n')].join('\n'));
        await session.scanner.queueScan(makeFile(FILE));
        expect(session.index.getTask(b)).toBeUndefined();
    });

    it('names nothing after a write of ours made over a change it did not see', async () => {
        const { contents, session } = await open(['# note', '- [ ] A', '- [ ] B', '']);
        const a = idOf(session, 'A');
        const b = idOf(session, 'B');
        session.holdScans();
        contents.set(FILE, ['# note', '- [ ] A', '- [ ] B', 'メモ', ''].join('\n'));

        // A write that names no row is made on the file as it is now. (One
        // that names a row read before the change is not: `NamedRow.read`.)
        expect((await session.index.getRepository().setFrontmatterKeys(FILE, { color: 'red' })).written).toBe(true);
        expect(session.index.getTask(a)).toBeUndefined();
        expect(session.index.getTask(b)).toBeUndefined();
    });
});

describe('a name given before writes of ours to the file being dragged', () => {
    // While a file is dragged, what our writes leave is not committed
    // (`TaskIndex.landed`); the numbers they give are numbers all the same.

    it('is followed to its row across writes that bring the file back to its content, and a write after them', async () => {
        const { contents, session } = await open(['- [ ] A', '- [ ] A', '- [ ] B', '']);
        const [r1, r2, b] = ids(session);
        session.index.setDraggingFile(FILE);

        expect(await session.index.deleteTask(r1)).toBe(true);
        expect(await session.index.duplicateTask(r2)).toBe(true);
        expect(contents.get(FILE)).toBe(['- [ ] A', '- [ ] A', '- [ ] B', ''].join('\n'));
        // Handed the content the file was given in: the write starts from the
        // reading our two writes left, not from the one the names are of.
        expect(await session.index.updateTask(b, { statusChar: 'x' })).toBe(true);

        // The row is on line 0; the copy on line 1, where it stood.
        expect(await session.index.updateTask(r2, { content: 'A2' })).toBe(true);
        expect(contents.get(FILE)).toBe(['- [ ] A2', '- [ ] A', '- [x] B', ''].join('\n'));
    });
});

describe('a copy of a row whose target names no reading', () => {
    it('is not written, though its line reads as it did: nothing says which reading the line is of', async () => {
        const { contents, session } = await open(['- [ ] A', '']);
        const held = session.index.getTask(idOf(session, 'A'))!;
        const target = { ...plannedOn(held), read: undefined };

        const written = await session.index.getRepository().updateTaskInFile(target, { ...held, statusChar: 'x', originalText: '- [x] A' });
        expect(written.refused?.reason).toEqual({ kind: 'changed' });
        expect(contents.get(FILE)).toBe(['- [ ] A', ''].join('\n'));
    });
});
