import { describe, it, expect, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, makeFile, vaultSession, type VaultSession } from '../../helpers/vaultSession';

/**
 * N1: a name lasts one reading of its file (the path, the content's key, the
 * line). The index never pairs a reading with the one before it. A name given
 * before a write of ours is followed across the write's report
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

    it('stay as they were across a modify that changed nothing, and across a reload', async () => {
        const { contents, session } = await open(['# note', '- [ ] A', '- [ ] B', '']);
        const before = ids(session);

        session.fireVault('modify', makeFile(FILE));
        await session.settle(FILE);
        expect(ids(session)).toEqual(before);

        const reloaded = vaultSession(contents);
        live.push(reloaded);
        await reloaded.scanAll();
        expect(ids(reloaded)).toEqual(before);
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
        const { session } = await open(['# note', '- [ ] A', '- [ ] B', '']);
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
        // Below both rows: the next write is still made, on the file as it is now.
        contents.set(FILE, ['# note', '- [ ] A', '- [ ] B', 'メモ', ''].join('\n'));

        expect(await session.index.updateTask(a, { statusChar: 'x' })).toBe(true);
        expect(session.index.getTask(b)).toBeUndefined();
    });
});
