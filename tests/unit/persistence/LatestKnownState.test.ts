import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeBench, FILE, type WriteBench } from '../helpers/writeBench';
import type { Task } from '../../../src/types';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import { MAX_CHAIN_PER_FILE } from '../../../src/services/core/identity/WriteClaims';

/**
 * A scan that adopts no claim pairs its ladder against the newest state of the
 * file known to be older than what it read (F5b, `WriteClaims.ladderFor`).
 *
 * Before F5b it paired against the ledger, which our own writes may have left
 * behind: two writes that trade the texts of two rows, then any change nobody
 * reported, and the ladder handed each name to the other's line (F2's S2c).
 * The chain of what those writes left says better, as long as the read is
 * known to have come after the last of them — which takes every state the
 * file was in since the ledger, since a read can land between two writes.
 */

afterEach(() => { vi.restoreAllMocks(); });

const checked = (task: Task): Task => ({ ...task, statusChar: 'x' });

/** X and Y read `[ ] A` and `[x] A`; two updates trade their texts, no scan in between. */
async function traded(extra: string[] = []): Promise<{ bench: WriteBench; x: Task; y: Task }> {
    const bench = await writeBench(['- [ ] A', '- [x] A', ...extra]);
    const x = bench.taskAt(0);
    const y = bench.taskAt(1);
    expect((await bench.writer.updateTaskInFile(plannedOn(x), checked(x))).written).toBe(true);
    expect((await bench.writer.updateTaskInFile(plannedOn(y), { ...y, statusChar: ' ' })).written).toBe(true);
    expect(bench.lines().slice(0, 2)).toEqual(['- [x] A', '- [ ] A']);
    return { bench, x, y };
}

/** Start a scan that reads now and commits only when `release` is called. */
async function gatedScan(bench: WriteBench): Promise<{ release: () => void; done: Promise<void> }> {
    let reading!: () => void;
    const called = new Promise<void>(resolve => { reading = resolve; });
    const read = bench.app.vault.read;
    let open!: () => void;
    const gate = new Promise<void>(resolve => { open = resolve; });
    bench.app.vault.read = async (file: { path: string }) => {
        const snapshot = bench.contents.get(file.path) ?? '';
        reading();
        await gate;
        return snapshot;
    };
    const done = bench.scan();
    await called;
    return {
        release: () => { open(); bench.app.vault.read = read; },
        done,
    };
}

describe('S2c: two own writes trade two texts, then a change nobody reported', () => {
    it('a line typed by hand: X and Y stay on their lines', async () => {
        const { bench, x, y } = await traded();
        bench.edit(['- [x] A', '- [ ] A', 'メモ']);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
    });

    it('a sync that rewrote the file above them: X and Y stay on their lines', async () => {
        const { bench, x, y } = await traded(['', '本文']);
        bench.edit(['同期で入った行', '- [x] A', '- [ ] A', '', '本文を書き換えた']);
        await bench.scan();
        expect(bench.taskAt(1).id).toBe(x.id);
        expect(bench.taskAt(2).id).toBe(y.id);
    });

    it('an own write that could not say what it did: paired across like an outside edit', async () => {
        const { bench, x, y } = await traded();
        // A write that changed the file and left only the mark (a template
        // overwrite, a report `explains` refused).
        const before = bench.lines();
        const after = [...before, 'テンプレート'];
        // Filed before its bytes land, as from inside `vault.process`.
        bench.scanner.writeSink(FILE, 'user')(before, after, null, null);
        bench.edit(after);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
    });

    it('an outside line, then an own write on a third row that leaves the mark', async () => {
        const { bench, x, y } = await traded(['- [ ] Z']);
        bench.edit(['- [x] A', '- [ ] A', '- [ ] Z', 'メモ']);
        const z = bench.taskAt(2);
        // It lands (Z reads the same everywhere) but has nothing to build a
        // claim on: the file is not what the last write left.
        expect((await bench.writer.updateTaskInFile(plannedOn(z), checked(z))).written).toBe(true);
        expect(bench.scanner.getWriteClaims().peek(FILE).links).toEqual(['record', 'record', 'foreign', 'mark']);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
        expect(bench.taskAt(2).id).toBe(z.id);
    });

    it('records do not age (I1): long after the writes, the change pairs the same way', async () => {
        const { bench, x, y } = await traded();
        const start = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(start + 60 * 60 * 1000);
        bench.edit(['- [x] A', '- [ ] A', 'メモ']);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
    });

    it('long after the writes and nothing else changed (a drag held past it): the newest record is the read', async () => {
        const { bench, x, y } = await traded();
        const start = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(start + 60 * 60 * 1000);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
    });
});

// I1. A read whose lines are a state we know, with a change nobody reported
// after that state, is either that state put back (a sync, an undo) or a
// change after our newest write that happens to read the same. The lines
// cannot say which. Before I1 the first of these tests was the ledger's (it
// named them), and the second the ledger's by F5b's rule for an earlier
// write's lines; both were right for a put-back and wrong for the other
// route. Now a row keeps its name only where both readings agree: here, where
// our writes moved names between rows that read alike, they disagree, and the
// rows are new. A name is lost; none is handed to the wrong row.
describe('a known state put back after our writes, with a change nobody reported after them', () => {
    it('lines the ledger recorded: the rows our writes traded are new', async () => {
        // A sync puts back the file as the last scan read it.
        const { bench, x, y } = await traded();
        bench.edit(['- [ ] A', '- [x] A']);
        await bench.scan();
        const ids = bench.tasks().map(task => task.id);
        expect(ids).toHaveLength(2);
        expect(ids).not.toContain(x.id);
        expect(ids).not.toContain(y.id);
    });

    it('lines an earlier write left, after a scan that read before the writes: the rows are new', async () => {
        // The scan that read the file before our writes keeps both records,
        // as it has not seen them. The next read is of the first write's lines
        // (the second undone from outside). Put back, X is on top and Y below;
        // changed after the second write (which took X away), the ladder
        // finds Y on one of the two rows that read alike.
        const bench = await writeBench(['- [ ] A', '- [ ] B']);
        const x = bench.taskAt(0);
        const y = bench.taskAt(1);
        const scan = await gatedScan(bench);
        expect((await bench.writer.updateTaskInFile(plannedOn(y), { ...y, content: 'A', originalText: '- [ ] A' })).written).toBe(true);
        expect((await bench.writer.deleteTaskFromFile(plannedOn(x, { subtree: true }))).written).toBe(true);
        scan.release();
        await scan.done;
        expect(bench.scanner.getWriteClaims().peek(FILE).links).toEqual(['record', 'record']);

        bench.edit(['- [ ] A', '- [ ] A']);
        await bench.scan();
        const ids = bench.tasks().map(task => task.id);
        expect(ids).toHaveLength(2);
        expect(ids).not.toContain(x.id);
        expect(ids).not.toContain(y.id);
    });

    // Was OPEN (F5b): S2c where the read is an earlier write's lines. Two
    // renames trade A and B, a third write appends a row, and the third is
    // undone from outside. Put back, the second write's lines name X on top;
    // changed after the third write, the ladder pairs by text against it and
    // says the same. Both readings agree, and X and Y stay on their lines.
    it('an earlier write\'s lines after two renames traded the texts: X and Y stay (S2c on an earlier state, closed in I1)', async () => {
        const bench = await writeBench(['- [ ] A', '- [ ] B']);
        const x = bench.taskAt(0);
        const y = bench.taskAt(1);
        const scan = await gatedScan(bench);
        expect((await bench.writer.updateTaskInFile(plannedOn(x), { ...x, content: 'B', originalText: '- [ ] B' })).written).toBe(true);
        expect((await bench.writer.updateTaskInFile(plannedOn(y), { ...y, content: 'A', originalText: '- [ ] A' })).written).toBe(true);
        await bench.writer.appendTaskToFile(FILE, '- [ ] Z');
        scan.release();
        await scan.done;

        bench.edit(['- [ ] B', '- [ ] A']);
        await bench.scan();
        // Truth: X reads B on the top line.
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
    });
});

describe('the chain past its cap', () => {
    it('hands no name to another row when the read is none of the states it still knows', async () => {
        const { bench, x, y } = await traded(['- [ ] Z']);
        // Scans held off (a drag), and far more writes than any drag makes.
        let z = bench.taskAt(2);
        for (let i = 0; i < MAX_CHAIN_PER_FILE; i++) {
            const next = { ...z, statusChar: i % 2 === 0 ? 'x' : ' ' };
            expect((await bench.writer.updateTaskInFile(plannedOn(z), next)).written).toBe(true);
            z = { ...next, originalText: bench.lines()[2] };
        }
        bench.edit([...bench.lines(), 'メモ']);
        await bench.scan();
        const ids = bench.tasks().map(task => task.id);
        // Every row is new: the chain cannot say the read came after our last
        // write, and the ledger is older than it.
        expect(ids).not.toContain(x.id);
        expect(ids).not.toContain(y.id);
    });
});

describe('the chain past its cap, across a scan that read before the loss', () => {
    it('still hands no name to another row: what the cap dropped is newer than that read', async () => {
        const { bench, x, y } = await traded(['- [ ] Z']);
        const scan = await gatedScan(bench);
        let z = bench.taskAt(2);
        for (let i = 0; i <= MAX_CHAIN_PER_FILE; i++) {
            const next = { ...z, statusChar: i % 2 === 0 ? 'x' : ' ' };
            expect((await bench.writer.updateTaskInFile(plannedOn(z), next)).written).toBe(true);
            z = { ...next, originalText: bench.lines()[2] };
        }
        scan.release();
        await scan.done;
        bench.edit([...bench.lines(), 'メモ']);
        await bench.scan();
        const ids = bench.tasks().map(task => task.id);
        expect(ids).not.toContain(x.id);
        expect(ids).not.toContain(y.id);
    });
});

describe('a write, where no partner is safe', () => {
    it('is refused as outdated past the chain\'s cap', async () => {
        const { bench, x } = await traded(['- [ ] Z']);
        let z = bench.taskAt(2);
        for (let i = 0; i < MAX_CHAIN_PER_FILE; i++) {
            const next = { ...z, statusChar: i % 2 === 0 ? 'x' : ' ' };
            expect((await bench.writer.updateTaskInFile(plannedOn(z), next)).written).toBe(true);
            z = { ...next, originalText: bench.lines()[2] };
        }
        bench.edit([...bench.lines(), 'メモ']);
        const lines = bench.lines();
        expect(bench.scanner.locate(FILE, lines, { runtimeId: x.id })).toEqual({ kind: 'outdated' });
    });
});

/** A scan that takes its read mark now and reads the file as it is when released. */
async function lateRead(bench: WriteBench): Promise<{ release: () => void; done: Promise<void> }> {
    let reading!: () => void;
    const called = new Promise<void>(resolve => { reading = resolve; });
    const read = bench.app.vault.read;
    let open!: () => void;
    const gate = new Promise<void>(resolve => { open = resolve; });
    bench.app.vault.read = async (file: { path: string }) => {
        reading();
        await gate;
        return bench.contents.get(file.path) ?? '';
    };
    const done = bench.scan();
    await called;
    return { release: () => { open(); bench.app.vault.read = read; }, done };
}

describe('a scan that read after a write filed past its read mark', () => {
    // Found by F5b's counterexample run (C1). The scan took its mark, then a
    // write of ours and an outside edit landed, and the read returned after
    // both. Its ledger is newer than the write. Kept past the commit by the
    // mark alone, the write's record looked newer than that ledger, and the
    // next unmatched read paired against it. The commit now places the read
    // in the chain as the match did: lines that changed after the newest
    // write mean the read saw every write.
    async function setup(): Promise<{ bench: WriteBench; x: Task; y: Task }> {
        const bench = await writeBench(['- [ ] A', '- [ ] B']);
        const x = bench.taskAt(0);
        const y = bench.taskAt(1);
        const scan = await lateRead(bench);
        await bench.writer.appendTaskToFile(FILE, '- [ ] Z');
        bench.edit(['- [x] A', '- [ ] B', '- [ ] Z']);
        scan.release();
        await scan.done;
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
        bench.edit(['- [x] A', '- [ ] A', '- [ ] Z']);
        return { bench, x, y };
    }

    it('the next scan keeps X and Y on their lines', async () => {
        const { bench, x, y } = await setup();
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
    });

    it('a write on X does not land on Y\'s line', async () => {
        const { bench, x } = await setup();
        expect(bench.scanner.locate(FILE, bench.lines(), { runtimeId: x.id })).not.toEqual({ kind: 'at', line: 1 });
        await bench.writer.deleteTaskFromFile(plannedOn(x));
        expect(bench.lines()).not.toEqual(['- [x] A', '- [ ] Z']);
    });
});

// KNOWN EXCEPTION to contract 1 (C2; accepted by the user on 2026-09-23).
// S2c turned inside out: after two own writes trade two texts, an outside
// write built on the file as it was before them lands (another device's sync,
// a stale buffer) with a line of its own. The ladder's premise is that an
// outside writer builds on the newest state we know; this one did not, and
// the lines cannot say which state it started from. The ladder pairs against
// the newest state and X and Y trade names. No evidence we hold tells it: the
// outside change counts the same as a hand edit built on the newest state.
// The harm is two rows that read alike trading names. Pinned as it is: when
// this test fails, contract 1 has moved, and the change needs deciding.
describe('an outside write built on the file before our writes (C2, a known exception)', () => {
    it('KNOWN EXCEPTION: X and Y trade names', async () => {
        const { bench, x, y } = await traded();
        bench.edit(['- [ ] A', '- [x] A', 'メモ']);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(y.id);
        expect(bench.taskAt(1).id).toBe(x.id);
    });
});

describe('a scan that read exactly what a write filed past its read mark left', () => {
    it('has read that write: the next write builds its claim on the new ledger', async () => {
        // Until F5b the write was kept past the commit by the mark alone, and
        // the next write, with nothing it was allowed to build on, left the
        // mark instead of a claim (availability).
        const bench = await writeBench(['- [ ] A', '- [ ] B']);
        const scan = await lateRead(bench);
        await bench.writer.appendTaskToFile(FILE, '- [ ] Z');
        scan.release();
        await scan.done;
        expect(bench.scanner.getWriteClaims().peek(FILE).links).toEqual([]);

        const b = bench.taskAt(1);
        expect((await bench.writer.updateTaskInFile(plannedOn(b), checked(b))).written).toBe(true);
        expect(bench.scanner.getWriteClaims().peek(FILE).links).toEqual(['record']);
    });
});
