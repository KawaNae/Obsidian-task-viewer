import { describe, it, expect, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { openLiveVault, vaultSession, type VaultSession } from '../helpers/vaultSession';
import { t } from '../../../src/i18n';
import { freezeDate } from '../helpers/fakeDate';

/**
 * A fire does not write a plan made from a copy the file has moved on from.
 *
 * A deletion's fire is planned from the index's copy of the row: the next
 * instance, where it goes. The write used to check only that the row's line
 * read as *something* on record for it and never looked at the command
 * lines, so a command line edited from outside was consumed by the plan it
 * no longer said, and a generation block edited from outside was written as
 * it no longer read (the F3 counterexample runs: CE2, CX1). Each is refused
 * now, whole, with one notice.
 *
 * A completion's fire has no copy to be stale: it is planned inside the write
 * that completes the row, from the lines that write holds (stage X). A card's
 * completion over a file edited from outside before any scan read it is not
 * made at all: the copy it names was read in content the file has moved on
 * from (`NamedRow.read`). It is refused with one notice, and once the scan
 * has read the file, the command, the block or the child is fired as the
 * file says it now; what the older copy said is never written.
 */

// `every` lands on the first grid point after the later of today and the
// row's date: today is held on the Friday the dates below are read from.
freezeDate(new Date(2026, 8, 25, 12, 0, 0));

const FILE = 'note.md';

let live: VaultSession | undefined;

afterEach(() => {
    live?.dispose();
    live = undefined;
    Notice.messages.length = 0;
});

async function open(files: Record<string, string[]>): Promise<{ contents: Map<string, string>; session: VaultSession }> {
    return openLiveVault(files, session => { live = session; });
}

function idOf(session: VaultSession, content: string): string {
    const found = session.index.getTasks().filter(task => task.file === FILE && task.content === content);
    expect(found).toHaveLength(1);
    return found[0].id;
}

/** Complete the row as a card's check does: the completion and its fire, one write. */
async function check(session: VaultSession, id: string, ...files: string[]): Promise<void> {
    expect(await session.index.updateTask(id, { statusChar: 'x' })).toBe(true);
    await session.flowSettled(FILE, ...files);
}

const CHANGED = t('notice.writeTargetChanged', { subject: 'A' });

/**
 * A card's completion of A over a file edited from outside that no scan has
 * read: refused, nothing written, one notice. The refusal has the file read
 * again; the answer is A's id in that reading.
 */
async function refusedUntilScanned(contents: Map<string, string>, session: VaultSession, id: string): Promise<string> {
    const edited = contents.get(FILE);
    expect(await session.index.updateTask(id, { statusChar: 'x' })).toBe(false);
    expect(contents.get(FILE)).toBe(edited);
    expect(Notice.messages).toEqual([CHANGED]);
    Notice.messages.length = 0;
    await session.settle(FILE);
    return idOf(session, 'A');
}

describe('CE2: a command line edited from outside, before any scan read it', () => {
    it('a completion is refused until a scan, then fires the command as the file says it now', async () => {
        const { contents, session } = await open({ [FILE]: ['# note', '- [ ] A @2026-09-21', '\t- ==> every 1d', ''] });
        const id = idOf(session, 'A');
        contents.set(FILE, contents.get(FILE)!.replace('every 1d', 'every 7d'));

        await check(session, await refusedUntilScanned(contents, session, id));

        expect(contents.get(FILE)).toBe(['# note', '- [ ] A @2026-09-28', '\t- ==> every 7d', '- [x] A @2026-09-21', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
    });

    it('a deletion fire neither deletes the row nor writes the old plan\'s instance', async () => {
        const { contents, session } = await open({ [FILE]: ['# note', '- [ ] A @2026-09-21', '\t- ==> every 1d', '\t- [ ] c', ''] });
        const id = idOf(session, 'A');
        const edited = contents.get(FILE)!.replace('every 1d', 'every 1w');
        contents.set(FILE, edited);

        expect(await session.index.deleteTask(id, { fireFlow: true })).toBe(false);

        expect(contents.get(FILE)).toBe(edited);
        expect(Notice.messages).toEqual([CHANGED]);
    });

    it('a move is refused until a scan, then goes where the command names now', async () => {
        const { contents, session } = await open({
            [FILE]: ['# note', '- [ ] A @2026-09-21', '\t- ==> move()', '\t- [ ] c', '- [ ] Z', '## Done', ''],
        });
        const id = idOf(session, 'A');
        contents.set(FILE, contents.get(FILE)!.replace('move()', 'move([[#Done]])'));

        await check(session, await refusedUntilScanned(contents, session, id));

        expect(contents.get(FILE)).toBe(['# note', '- [ ] Z', '## Done', '- [x] A @2026-09-21', '\t- [ ] c', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
    });
});

describe('CX1: a generation block edited from outside, before any scan read it', () => {
    const NOTE = [
        '# note', '- [ ] Z', '',
        '```tv-gen w', '- [ ] A ${dates}', '\t- [ ] old child', '```', '',
    ];

    it('a completion is refused until a scan, then writes the block as it reads now', async () => {
        const { contents, session } = await open({
            [FILE]: ['# note', '- [ ] A @2026-09-21', '\t- ==> every mon use("w")', ...NOTE.slice(1)],
        });
        const id = idOf(session, 'A');
        contents.set(FILE, contents.get(FILE)!.replace('old child', 'new child'));

        await check(session, await refusedUntilScanned(contents, session, id));

        const lines = contents.get(FILE)!.split('\n');
        expect(lines.filter(line => line === '\t- [ ] new child')).toHaveLength(2);
        expect(lines).not.toContain('\t- [ ] old child');
        expect(Notice.messages).toEqual([]);
    });

    it('a deletion fire neither deletes the row nor writes the old block', async () => {
        const { contents, session } = await open({
            [FILE]: ['# note', '- [ ] A @2026-09-21', '\t- ==> every mon use("w")', ...NOTE.slice(1)],
        });
        const id = idOf(session, 'A');
        const edited = contents.get(FILE)!.replace('old child', 'new child');
        contents.set(FILE, edited);

        expect(await session.index.deleteTask(id, { fireFlow: true })).toBe(false);

        expect(contents.get(FILE)).toBe(edited);
        expect(Notice.messages).toEqual([CHANGED]);
    });

    it('a block left as it was does not stop the fire', async () => {
        const { contents, session } = await open({
            [FILE]: ['# note', '- [ ] A @2026-09-21', '\t- ==> every mon use("w")', ...NOTE.slice(1)],
        });

        await check(session, idOf(session, 'A'));

        expect(contents.get(FILE)).toContain('- [x] A @2026-09-21');
        expect(contents.get(FILE)).not.toContain('- [x] A @2026-09-21 ==>');
        expect(contents.get(FILE)!.split('\n').filter(line => line === '\t- [ ] old child')).toHaveLength(2);
        expect(Notice.messages).toEqual([]);
    });
});

describe('F5: a subtree changed from outside, before any scan read it', () => {
    // An operation that takes the row away, or carries it, takes its subtree
    // with it. A deletion plans from its copy, so the subtree is part of what
    // it planned from, and a line that joined it since would otherwise go
    // with it unseen (F4's last out-of-scope shape). A completion's move is
    // planned from the lines it is written over, once a scan has read them,
    // and carries the subtree they hold.

    it('a move within the file is refused until a scan, then carries the child as the file holds it', async () => {
        const { contents, session } = await open({
            [FILE]: ['# note', '- [ ] A @2026-09-21', '\t- ==> move()', '\t- [ ] 子', '- [ ] Z', ''],
        });
        const id = idOf(session, 'A');
        contents.set(FILE, contents.get(FILE)!.replace('\t- [ ] 子', '\t- [ ] 子 書き足し'));

        await check(session, await refusedUntilScanned(contents, session, id));

        expect(contents.get(FILE)).toBe(['# note', '- [ ] Z', '- [x] A @2026-09-21', '\t- [ ] 子 書き足し', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
    });

    // A task goes from outside, and the line below it — past a blank, deeper
    // than the task above — now reads as that task's child.
    const scanned = ['# note', '- [ ] A @2026-09-21', '- [ ] B', '', '    B のメモ', ''];
    const bGone = ['# note', '- [ ] A @2026-09-21', '', '    B のメモ', ''];

    it('a delete does not take a line that joined the subtree', async () => {
        const { contents, session } = await open({ [FILE]: scanned });
        const id = idOf(session, 'A');
        contents.set(FILE, bGone.join('\n'));

        expect(await session.index.deleteTask(id)).toBe(false);

        expect(contents.get(FILE)).toBe(bGone.join('\n'));
        expect(Notice.messages).toEqual([CHANGED]);
    });

    it('a deletion fire does not take it either', async () => {
        const withFlow = ['# note', '- [ ] A @2026-09-21', '\t- ==> every 1d', '- [ ] B', '', '    B のメモ', ''];
        const { contents, session } = await open({ [FILE]: withFlow });
        const id = idOf(session, 'A');
        const edited = ['# note', '- [ ] A @2026-09-21', '\t- ==> every 1d', '', '    B のメモ', ''].join('\n');
        contents.set(FILE, edited);

        expect(await session.index.deleteTask(id, { fireFlow: true })).toBe(false);

        expect(contents.get(FILE)).toBe(edited);
        expect(Notice.messages).toEqual([CHANGED]);
    });
});
