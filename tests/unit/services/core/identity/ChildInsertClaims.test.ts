import { describe, it, expect, afterEach } from 'vitest';
import { vaultSession, type VaultSession } from '../../../helpers/vaultSession';
import type { WriteObserver } from '../../../../../src/services/persistence/WriteObserver';
import type { Refusal } from '../../../../../src/utils/FileLines';
import { plannedOn } from '../../../../../src/services/persistence/TaskRefs';

/**
 * What the writes that *add* a line tell the next scan.
 *
 * The inserts in this file share one shape: a line goes in, and every row
 * under it moves. The ladder works that out from the text, and gets it wrong
 * exactly where the text cannot separate the new line from the one it was
 * copied from — a duplicate among twins, a child written next to a child worded
 * the same. What the claim adds is the one thing the file does not say: which
 * of the identical rows the write had just made.
 *
 * Where the ladder was already right, the claim changes no identity and the
 * test says so by counting the adoption instead: the scan believed the write
 * rather than working it out, which is what takes the result off the order the
 * read happened to land in.
 */

const FILE = 'verify.md';

let live: VaultSession | undefined;
afterEach(() => {
    live?.dispose();
    live = undefined;
});

function rowsOf(session: VaultSession, file = FILE): Array<{ id: string; text: string }> {
    return session.index.getTasks()
        .filter(task => task.file === file)
        .sort((a, b) => a.line - b.line)
        .map(task => ({ id: task.id, text: task.originalText }));
}

function idsOf(session: VaultSession, file = FILE): string[] {
    return rowsOf(session, file).map(row => row.id);
}

/**
 * The claims this session's writes file, and what each scan did with them.
 *
 * Counted by wrapping the log itself rather than inferred from the IDs: a
 * claim that decides what the ladder would have decided anyway leaves no trace
 * in the result, and "the scan believed the write" is the thing under test.
 */
function watchClaims(session: VaultSession) {
    const log = session.scanner.getHintLog() as unknown as {
        add: (file: string, hints: unknown[], now: number) => () => void;
        settle: (file: string, consumed: number, moved: boolean) => void;
    };
    const filed: string[] = [];
    const adopted: string[] = [];
    const add = log.add.bind(log);
    const settle = log.settle.bind(log);
    log.add = (file, hints, now) => {
        if (hints.length > 0) filed.push(file);
        return add(file, hints, now);
    };
    log.settle = (file, consumed, moved) => {
        if (consumed > 0) adopted.push(file);
        settle(file, consumed, moved);
    };
    return { filed, adopted };
}

/** The repository, for the writes of a move made one by one. */
function repositoryOf(session: VaultSession) {
    return session.index.getRepository();
}

/**
 * Run without the write layer reporting anything — the ladder alone.
 *
 * The channel stays connected for everything but the report: a write still
 * asks where its target stands and still says when it gives up. Cutting the
 * channel whole would leave every target `gone` and every write refused.
 */
function silenceWrites(session: VaultSession): void {
    const index = session.index as unknown as {
        repository: { getWriteObserver: () => WriteObserver };
        reportRefusal: (refusal: Refusal) => void;
    };
    index.repository.getWriteObserver().connect(path => ({
        locate: (lines, ref) => session.scanner.locate(path, lines, ref),
        onRecord: (lines, ref, line) => session.scanner.onRecord(path, lines, ref, line),
        refused: refusal => index.reportRefusal(refusal),
    }));
}

describe('the line the editor writes below another', () => {
    it('the copy is the new task even when its twin is the line below it', async () => {
        // Three rows the file cannot tell apart once the copy lands. The
        // ladder pairs them in order, so the previous second row — the one
        // still on the page, now one line further down — is handed to the line
        // the write had just made.
        const contents = new Map([[FILE, ['- [ ] 同じ行', '- [ ] 同じ行', ''].join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const [first, second] = idsOf(live);
        const claims = watchClaims(live);

        await live.index.insertLineAfterLine(FILE, { line: 0, text: '- [ ] 同じ行' }, '- [ ] 同じ行');
        await live.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toEqual([
            '- [ ] 同じ行', '- [ ] 同じ行', '- [ ] 同じ行', '',
        ]);
        const after = idsOf(live);
        expect(after[0]).toBe(first);
        expect(after[2]).toBe(second);
        expect(after[1]).not.toBe(first);
        expect(after[1]).not.toBe(second);
        expect(claims.adopted).toEqual([FILE]);
    });

    it('what the ladder alone does with the same duplicate', async () => {
        // The same write with nothing reported: the line just written wears
        // the identity of the row below it. Kept as the measurement the claim
        // is against, the way the delete scenarios keep theirs.
        const contents = new Map([[FILE, ['- [ ] 同じ行', '- [ ] 同じ行', ''].join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const [first, second] = idsOf(live);
        silenceWrites(live);

        await live.index.insertLineAfterLine(FILE, { line: 0, text: '- [ ] 同じ行' }, '- [ ] 同じ行');
        await live.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toHaveLength(4);
        const after = idsOf(live);
        expect(after[0]).toBe(first);
        expect(after[1]).toBe(second);
        expect(after[2]).not.toBe(second);
    });
});

describe('the child written at the head of a subtree', () => {
    it('the inserted child is the new row, and the child worded the same keeps its ID', async () => {
        const contents = new Map([[FILE, [
            '- [ ] 親 @2026-09-21',
            '\t- [ ] 子',
            '- [ ] 下の行 @2026-09-21',
            '',
        ].join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const [parent, child, below] = idsOf(live);
        const claims = watchClaims(live);

        expect(await live.index.insertChildTask(parent, '- [ ] 子')).toBe(true);
        await live.settle(FILE);

        const after = idsOf(live);
        expect(after).toHaveLength(4);
        expect([after[0], after[3]]).toEqual([parent, below]);
        // The written line is the first child; the one that was there is now
        // the second, and it is the same row it was.
        expect(after[1]).not.toBe(child);
        expect(after[2]).toBe(child);
        expect(claims.adopted).toEqual([FILE]);
    });

    it('what the ladder alone does with the same child', async () => {
        const contents = new Map([[FILE, [
            '- [ ] 親 @2026-09-21',
            '\t- [ ] 子',
            '- [ ] 下の行 @2026-09-21',
            '',
        ].join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const [parent, child] = idsOf(live);
        silenceWrites(live);

        await live.index.insertChildTask(parent, '- [ ] 子');
        await live.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toHaveLength(5);
        const after = idsOf(live);
        expect(after[1]).toBe(child);
        expect(after[2]).not.toBe(child);
    });
});

describe('the lines a timer writes beside a task', () => {
    // A session record is not a task row, so the claim adds no row and moves
    // no identity: every row it names is the row it was. What it removes is
    // the dependence on which state the scan's read happened to catch.
    it('a record appended under the task leaves every row its ID', async () => {
        const contents = new Map([[FILE, [
            '- [ ] 親 @2026-09-21',
            '\t- [ ] 子 @2026-09-21',
            '- [ ] 下の行 @2026-09-21',
            '',
        ].join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const before = idsOf(live);
        const claims = watchClaims(live);

        await live.index.appendChildTask(before[0], '- ⏱ 10:00>11:00');
        await live.settle(FILE);

        expect(idsOf(live)).toEqual(before);
        expect(contents.get(FILE)!.split('\n')[2]).toBe('\t- ⏱ 10:00>11:00');
        expect(claims.adopted).toEqual([FILE]);
    });

    it('a record joining the end of a completed run leaves every row its ID', async () => {
        const contents = new Map([[FILE, [
            '- [ ] 記録 @2026-09-21',
            '- [x] 記録 @2026-09-20',
            '- [x] 記録 @2026-09-19',
            '- [ ] 下の行 @2026-09-21',
            '',
        ].join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const before = idsOf(live);
        const claims = watchClaims(live);

        const at = await live.index.insertSiblingAfterTask(
            before[0], '- [x] 記録 @2026-09-18', { afterCompletedRun: true });
        await live.settle(FILE);

        // Past the completed siblings, not between them.
        expect(at).toBe(3);
        const after = idsOf(live);
        expect([after[0], after[1], after[2], after[4]]).toEqual(before);
        expect(after[3]).not.toBe(before[3]);
        expect(claims.adopted).toEqual([FILE]);
    });
});

describe('the task appended at the end of a file', () => {
    it('the appended row is new, whether or not the file ended in a blank line', async () => {
        // `appendLines` replaces a trailing empty line rather than following
        // it, so the two shapes report differently — a removal and an insert
        // against an insert alone — and both have to account for the file.
        for (const tail of ['\n', '']) {
            const contents = new Map([[FILE, `- [ ] 同じ行${tail}`]]);
            live = vaultSession(contents);
            await live.scanAll();
            const [existing] = idsOf(live);
            const claims = watchClaims(live);

            const at = await live.index.createTask(FILE, '- [ ] 同じ行');
            await live.settle(FILE);

            const after = idsOf(live);
            expect(at).toBe(1);
            expect(after[0]).toBe(existing);
            expect(after[1]).not.toBe(existing);
            expect(claims.adopted).toEqual([FILE]);
            live.dispose();
            live = undefined;
        }
    });

    it('a file that did not exist yet is written whole, and claims nothing', async () => {
        // `vault.create` writes every line of the file, so there is no
        // previous generation for its rows to be confused with. The scan mints
        // them, and the write has nothing to add.
        const contents = new Map([[FILE, '- [ ] 既存 @2026-09-21\n']]);
        live = vaultSession(contents);
        await live.scanAll();
        const claims = watchClaims(live);

        await live.index.createTask('新しいノート.md', '- [ ] 新しい行 @2026-09-21');
        await live.settle('新しいノート.md');

        expect(claims.filed).toEqual([]);
        expect(rowsOf(live, '新しいノート.md').map(row => row.text))
            .toEqual(['- [ ] 新しい行 @2026-09-21']);
    });
});

describe('the half of a move that writes the destination', () => {
    /**
     * Within one file a move is one write that carries the row to the end
     * (F3). It used to be two — the append, then a silent delete — and the
     * moved row's name then turned on whether a scan fell between them and on
     * how near the ladder found the rows. Now the claim says the moved line is
     * the row that was moved. To another file it is still two writes, and the
     * appended lines are new rows there: the move drops the task's `^id`, and
     * a row in another file is another row.
     */
    const MOVED = ['- [ ] 見張り @2026-09-21', '- [ ] 移す', '\t- ==> move([[verify]])', ''];

    it('within the file, the moved row keeps its name, and the claim is adopted', async () => {
        const contents = new Map([[FILE, MOVED.join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const [watcher, moving] = rowsOf(live);
        const task = live.index.getTask(moving.id)!;
        const claims = watchClaims(live);

        const outcome = await repositoryOf(live).applyToTask(plannedOn(task), [{ kind: 'move-to-end', text: '- [x] 移す' }]);
        await live.settle(FILE);

        expect(outcome.written).toBe(true);
        expect(outcome.made).toEqual([]);
        expect(contents.get(FILE)!.split('\n')).toEqual([
            '- [ ] 見張り @2026-09-21', '- [x] 移す', '',
        ]);
        expect(idsOf(live)).toEqual([watcher.id, moving.id]);
        expect(claims.adopted).toEqual([FILE]);
    });

    it('a move to another file leaves the destination\'s own rows alone', async () => {
        const contents = new Map([
            [FILE, ['- [ ] 移す @2026-09-21 ==> move([[archive]])', ''].join('\n')],
            ['archive.md', ['- [ ] 移す @2026-09-21', ''].join('\n')],
        ]);
        live = vaultSession(contents);
        await live.scanAll();
        const [existing] = rowsOf(live, 'archive.md');
        const moving = rowsOf(live)[0];
        const claims = watchClaims(live);

        await repositoryOf(live).appendTaskWithChildren(
            'archive.md', '- [x] 移す @2026-09-21', plannedOn(live.index.getTask(moving.id)!));
        await live.settle('archive.md');

        const after = rowsOf(live, 'archive.md');
        expect(after.map(row => row.text)).toEqual(['- [ ] 移す @2026-09-21', '- [x] 移す @2026-09-21']);
        expect(after[0].id).toBe(existing.id);
        expect(after[1].id).not.toBe(existing.id);
        expect(after[1].id).not.toBe(moving.id);
        expect(claims.adopted).toEqual(['archive.md']);
    });
});
