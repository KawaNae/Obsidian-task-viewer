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

        const outcome = await processLines(session.app, makeFile(FILE), (lines, _eol, { edits }) => {
            // Two rows, and a line between them that is not one.
            edits.splice(2, 0, '- [ ] 新1 @2026-09-21', 'メモ', '\t- [ ] 新2');
            return lines;
        }, channel(session));
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

        const outcome = await processLines(session.app, makeFile(FILE), (lines, _eol, { edits }) => {
            lines[0] = '- [x] 上';
            edits.replaced(0);
            return lines;
        }, channel(session));

        expect(outcome.made).toEqual([]);
    });

    it('are none when the write could not claim, for want of a content on record', async () => {
        const { contents, session } = await open(['- [ ] 上', '']);
        // Something else wrote the file; no scan has read it.
        contents.set(FILE, ['- [ ] 外', '- [ ] 上', ''].join('\n'));

        const outcome = await processLines(session.app, makeFile(FILE), (lines, _eol, { edits }) => {
            edits.splice(2, 0, '- [ ] 新');
            return lines;
        }, channel(session));
        await session.settle(FILE);

        expect(outcome.written).toBe(true);
        expect(outcome.made).toEqual([]);
    });
});
