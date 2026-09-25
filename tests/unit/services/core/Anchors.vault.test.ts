import { describe, it, expect, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, makeFile, vaultSession, type VaultSession } from '../../helpers/vaultSession';

/**
 * N1 (2026-09-25, the names and IDs decision): a row whose `^id` no other
 * line of its file carries has an anchor. The anchor outlives readings — an
 * edit from outside, a reload — where a name does not. The index looks it up
 * in one place (`TaskIndex.getTaskByAnchor`), and a write to the row it finds
 * goes by that row's name, through the one check every write passes.
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

const anchors = (session: VaultSession) => session.index.getTasks()
    .filter(task => task.file === FILE)
    .sort((a, b) => a.line - b.line)
    .map(task => [task.content, task.anchor]);

describe('a row\'s anchor', () => {
    it('is its line\'s ^id when no other line of the file carries it, whatever reads that line', async () => {
        const { session } = await open([
            '- [ ] A ^only',
            '- [ ] B ^twice',
            '段落の中の ^twice',
            '- [ ] C',
            '- [ ] D ^twin',
            '    - [ ] E ^twin',
            '',
        ]);
        expect(anchors(session)).toEqual([
            ['A', 'only'],
            ['B', undefined],
            ['C', undefined],
            ['D', undefined],
            ['E', undefined],
        ]);
    });

    it('finds its row after an edit from outside moved it, and after a reload', async () => {
        const { contents, session } = await open(['- [ ] A', '- [ ] B ^keep', '']);
        const before = session.index.getTaskByAnchor(FILE, 'keep');
        expect(before?.line).toBe(1);

        contents.set(FILE, ['メモ', '- [ ] A', '- [ ] B ^keep', ''].join('\n'));
        await session.scanner.queueScan(makeFile(FILE));
        const after = session.index.getTaskByAnchor(FILE, 'keep');
        expect(after?.line).toBe(2);
        expect(after?.content).toBe('B');
        // The name did not outlive the edit; the anchor did.
        expect(session.index.getTask(before!.id)).toBeUndefined();

        const reloaded = vaultSession(contents);
        live.push(reloaded);
        await reloaded.scanAll();
        expect(reloaded.index.getTaskByAnchor(FILE, 'keep')?.line).toBe(2);
    });

    it('is lost once another line of the file takes the same ^id, and finds nothing in another file', async () => {
        const { contents, session } = await open(['- [ ] A ^keep', '']);
        expect(session.index.getTaskByAnchor('other.md', 'keep')).toBeUndefined();

        contents.set(FILE, ['- [ ] A ^keep', '- [ ] A2 ^keep', ''].join('\n'));
        await session.scanner.queueScan(makeFile(FILE));
        expect(session.index.getTaskByAnchor(FILE, 'keep')).toBeUndefined();
    });
});

describe('a write to the row an anchor finds', () => {
    it('lands on the row\'s line now, after an edit from outside the scan has read', async () => {
        const { contents, session } = await open(['- [ ] A ^keep', '- [ ] A', '']);
        contents.set(FILE, ['- [ ] A', '- [ ] A ^keep', '- [ ] A', ''].join('\n'));
        await session.scanner.queueScan(makeFile(FILE));

        const row = session.index.getTaskByAnchor(FILE, 'keep')!;
        expect(await session.index.updateTask(row.id, { statusChar: 'x' })).toBe(true);
        expect(contents.get(FILE)).toBe(['- [ ] A', '- [x] A ^keep', '- [ ] A', ''].join('\n'));
    });

    it('is refused, not taken elsewhere, while the file holds an edit the scan has not read', async () => {
        const { contents, session } = await open(['- [ ] A ^keep', '- [ ] A', '']);
        const row = session.index.getTaskByAnchor(FILE, 'keep')!;
        // A line below: the copy's line still reads as it did, but in a
        // content the copy was not read in.
        const edited = ['- [ ] A ^keep', '- [ ] A', '- [ ] B', ''].join('\n');
        contents.set(FILE, edited);

        expect(await session.index.updateTask(row.id, { statusChar: 'x' })).toBe(false);
        expect(contents.get(FILE)).toBe(edited);
    });
});
