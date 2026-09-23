import { describe, it, expect, afterEach } from 'vitest';
import { vaultSession, makeFile, type VaultSession } from '../../../helpers/vaultSession';
import { processLines } from '../../../../../src/utils/FileLines';

/**
 * A write answers the names of the rows it made, and they are the names the
 * next scan gives those rows — the scan adopts the write's claim, and the claim
 * is where the names were issued. A write that claims nothing promises no name.
 */

const FILE = 'note.md';

let live: VaultSession | undefined;

afterEach(() => {
    live?.dispose();
    live = undefined;
});

async function open(lines: string[]): Promise<{ contents: Map<string, string>; session: VaultSession }> {
    const contents = new Map([[FILE, lines.join('\n')]]);
    live = vaultSession(contents);
    await live.scanAll();
    return { contents, session: live };
}

function channel(session: VaultSession) {
    return session.index.getRepository().getWriteObserver().for(FILE);
}

describe('the rows a write made', () => {
    it('are named as the next scan names them', async () => {
        const { session } = await open(['# note', '- [ ] 上 @2026-09-21', '- [ ] 下 @2026-09-21', '']);
        const kept = session.index.getTasks().map(task => task.id).sort();

        const outcome = await processLines(session.app, makeFile(FILE), channel(session), (draft) => {
            // Two rows, and a line between them that is not one.
            draft.splice(2, 0, '- [ ] 新1 @2026-09-21', 'メモ', '\t- [ ] 新2');
            return true;
        });
        await session.settle(FILE);

        expect(outcome.written).toBe(true);
        expect(outcome.made.map(row => row.line)).toEqual([2, 4]);
        const byLine = new Map(session.index.getTasks().map(task => [task.line, task.id]));
        expect(outcome.made.map(row => byLine.get(row.line))).toEqual(outcome.made.map(row => row.runtimeId));
        // The rows that were there keep theirs, and none of them is one made.
        expect([byLine.get(1), byLine.get(5)].sort()).toEqual(kept);
    });

    it('are none when the write rewrote rows and made nothing', async () => {
        const { session } = await open(['- [ ] 上', '']);

        const outcome = await processLines(session.app, makeFile(FILE), channel(session), (draft) => {
            draft.rewrite(0, '- [x] 上');
            return true;
        });

        expect(outcome.made).toEqual([]);
    });

    it('are none when the write could not claim, for want of a content on record', async () => {
        const { contents, session } = await open(['- [ ] 上', '']);
        // Something else wrote the file; no scan has read it.
        contents.set(FILE, ['- [ ] 外', '- [ ] 上', ''].join('\n'));

        const outcome = await processLines(session.app, makeFile(FILE), channel(session), (draft) => {
            draft.splice(2, 0, '- [ ] 新');
            return true;
        });
        await session.settle(FILE);

        expect(outcome.written).toBe(true);
        expect(outcome.made).toEqual([]);
    });
});

describe('a made name, once the file has moved on without it', () => {
    // A row a write made is known by the claim that carries its name until a
    // scan adopts it. If something else edits the file first, no scan will:
    // the lines are not the ones the claim describes. The chain still says
    // what the write left, and the edit came after it, so the scan's ladder
    // pairs against that state and the row keeps the name the write gave it
    // (F5b; before it the ladder paired against the ledger, which has never
    // heard the name).
    it('is kept by the row the write made', async () => {
        const { contents, session } = await open(['# note', '- [ ] 上 @2026-09-21', '']);
        // A drag holds the file's scans back until it ends, as it does in use.
        session.index.setDraggingFile(FILE);

        const outcome = await processLines(session.app, makeFile(FILE), channel(session), (draft) => {
            draft.splice(2, 0, '- [ ] 新 @2026-09-21');
            return true;
        });
        const [made] = outcome.made;
        expect(made).toBeDefined();
        // The claim is still waiting for its scan.
        expect(session.scanner.getHintLog().peek().find(entry => entry.file === FILE)?.pending.length).toBe(1);

        // Something else writes a line above, before any scan reads the file.
        const edited = ['# note', '- [ ] 外 @2026-09-21', '- [ ] 上 @2026-09-21', '- [ ] 新 @2026-09-21', ''];
        contents.set(FILE, edited.join('\n'));
        expect(session.scanner.locate(FILE, edited, { runtimeId: made.runtimeId })).toEqual({ kind: 'gone' });

        session.index.setDraggingFile(null);
        await session.settle(FILE);
        const ids = session.index.getTasks().filter(task => task.file === FILE).map(task => task.id);
        expect(ids).toHaveLength(3);
        const kept = session.index.getTasks().find(task => task.id === made.runtimeId);
        expect(kept?.originalText).toBe('- [ ] 新 @2026-09-21');
    });
});
