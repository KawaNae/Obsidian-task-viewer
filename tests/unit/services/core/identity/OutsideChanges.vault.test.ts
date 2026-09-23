import { describe, it, expect, afterEach } from 'vitest';
import { vaultSession, makeFile, type VaultSession } from '../../../helpers/vaultSession';

/**
 * Which changes to a file the chain counts as outside ones (I1): every
 * `modify` and `create` the index hears, less one for each write of ours
 * that filed and has not been matched to its own `modify` yet. Counted before
 * the drag decides whether to scan, so a held scan does not hide a change.
 *
 * Each case holds the file's scans with a drag, so the chain is still there
 * to be looked at: a scan that commits drops what its read has seen.
 */

const FILE = 'note.md';
const NOTE = ['- [ ] A', '- [ ] B', ''];

let live: VaultSession | undefined;
let contents = new Map<string, string>();
afterEach(() => {
    live?.dispose();
    live = undefined;
});

async function open(lines: string[] = NOTE): Promise<VaultSession> {
    contents = new Map([[FILE, lines.join('\n')]]);
    live = vaultSession(contents);
    await live.scanAll();
    return live;
}

const chain = (session: VaultSession, path = FILE) => session.scanner.getWriteClaims().peek(path);
const idOf = (session: VaultSession, text: string): string =>
    session.index.getTasks().find(task => task.file === FILE && task.originalText === text)!.id;

async function fromOutside(session: VaultSession, lines: string[]): Promise<void> {
    contents.set(FILE, lines.join('\n'));
    await session.fireVault('modify', makeFile(FILE));
}

describe('outside changes, counted against our writes', () => {
    it('a write of ours is matched to its own modify: no outside mark', async () => {
        const session = await open();
        session.index.setDraggingFile(FILE);
        expect(await session.index.updateTask(idOf(session, '- [ ] A'), { statusChar: 'x' })).toBe(true);
        expect(chain(session)).toMatchObject({ links: ['record'], awaiting: 0 });
    });

    it('an edit by hand is one outside mark, and two in a row are still one', async () => {
        const session = await open();
        session.index.setDraggingFile(FILE);
        await fromOutside(session, ['- [ ] A', '- [ ] B', 'x']);
        expect(chain(session)).toMatchObject({ links: ['foreign'], awaiting: 0 });
        await fromOutside(session, ['- [ ] A', '- [ ] B', 'xy']);
        expect(chain(session)).toMatchObject({ links: ['foreign'], awaiting: 0 });
    });

    it('our write, then an edit by hand, then our write: each in its place', async () => {
        const session = await open();
        session.index.setDraggingFile(FILE);
        expect(await session.index.updateTask(idOf(session, '- [ ] A'), { statusChar: 'x' })).toBe(true);
        await fromOutside(session, ['- [x] A', '- [ ] B', 'x']);
        expect(chain(session).links).toEqual(['record', 'foreign']);
    });

    it('a write that leaves the same bytes waits for no modify, so the next outside change is not taken for it', async () => {
        const session = await open(['- [x] A', '- [ ] B', '']);
        session.index.setDraggingFile(FILE);
        const before = contents.get(FILE);
        expect(await session.index.updateTask(idOf(session, '- [x] A'), { statusChar: 'x' })).toBe(true);
        expect(contents.get(FILE)).toBe(before);
        expect(chain(session)).toMatchObject({ links: [], awaiting: 0 });
        await fromOutside(session, ['- [x] A', '- [ ] B', 'x']);
        expect(chain(session)).toMatchObject({ links: ['foreign'], awaiting: 0 });
    });

    it('counted while a drag holds the scan: the change is on record for the scan that reads it', async () => {
        const session = await open();
        session.index.setDraggingFile(FILE);
        await fromOutside(session, ['- [ ] A', '- [ ] B', 'x']);
        // The drag held the scan: the ledger still reads the old note.
        expect(session.index.getTasks().filter(task => task.file === FILE)).toHaveLength(2);
        expect(chain(session).links).toEqual(['foreign']);
        session.index.setDraggingFile(null);
        await session.settle(FILE);
        // The scan that read it has seen it.
        expect(chain(session).links).toEqual([]);
    });

    it('a note that arrives whole (a sync\'s create) is an outside change', async () => {
        const session = await open();
        const path = 'arrived.md';
        session.index.setDraggingFile(path);
        contents.set(path, '- [ ] C\n');
        await session.fireVault('create', makeFile(path));
        expect(chain(session, path).links).toEqual(['foreign']);
    });

    it('a change to a file nothing is waiting on is outside even right after a scan read our write', async () => {
        const session = await open();
        expect(await session.index.updateTask(idOf(session, '- [ ] A'), { statusChar: 'x' })).toBe(true);
        await session.settle(FILE);
        expect(chain(session)).toMatchObject({ links: [], awaiting: 0 });
        session.index.setDraggingFile(FILE);
        await fromOutside(session, ['- [x] A', '- [ ] B', 'x']);
        expect(chain(session).links).toEqual(['foreign']);
    });
});
