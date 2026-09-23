import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeBench, FILE, type WriteBench } from '../helpers/writeBench';
import type { Task } from '../../../src/types';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import { HINT_TTL_MS } from '../../../src/services/core/identity/IdentityHints';
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
        bench.edit(after);
        bench.scanner.writeSink(FILE, 'user')(before, after, null);
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
        expect(bench.scanner.getHintLog().peek().find(entry => entry.file === FILE)?.pending.length).toBe(2);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
        expect(bench.taskAt(2).id).toBe(z.id);
    });

    it('claims past their age: the chain has none, and pairs the same way', async () => {
        const { bench, x, y } = await traded();
        const start = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(start + HINT_TTL_MS + 1);
        bench.edit(['- [x] A', '- [ ] A', 'メモ']);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
    });

    it('claims past their age and nothing else changed (a drag held past it)', async () => {
        const { bench, x, y } = await traded();
        const start = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(start + HINT_TTL_MS + 1);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
    });
});

describe('the ledger stays the partner where the read may be a state it knows', () => {
    it('lines the ledger recorded: the ledger names them', async () => {
        // A sync puts back the file as the last scan read it. Which rows are
        // which is the ledger's answer, as it was before F5b.
        const { bench, x, y } = await traded();
        bench.edit(['- [ ] A', '- [x] A']);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
    });

    it('lines an earlier write left, after a scan that read before the writes dropped their claims', async () => {
        // The scan that read the file before our writes adopts nothing, and
        // the claims go with it. The next read is of the first write's lines
        // (the second has not landed, or was undone). Paired against the
        // newest state, Y would take the top line; the ledger pairs it right.
        const bench = await writeBench(['- [ ] A', '- [ ] B']);
        const x = bench.taskAt(0);
        const y = bench.taskAt(1);
        const scan = await gatedScan(bench);
        expect((await bench.writer.updateTaskInFile(plannedOn(y), { ...y, content: 'A', originalText: '- [ ] A' })).written).toBe(true);
        expect(await bench.writer.deleteTaskFromFile(plannedOn(x, { subtree: true }))).toBe(true);
        scan.release();
        await scan.done;
        expect(bench.scanner.getHintLog().peek().find(entry => entry.file === FILE)).toBeUndefined();

        bench.edit(['- [ ] A', '- [ ] A']);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
    });

    // OPEN (F5b, pinned as it is). The same rule leaves S2c's shape where the
    // read is an earlier write's lines: the ledger is older than writes whose
    // contents are known, and the ladder pairs across them. Here two renames
    // trade A and B, a third write appends a row, and the read is of the
    // second write's lines (a read that raced the third, or the third undone
    // from outside). Pairing against that state would take a claim the log
    // dropped by the ladder's door (F1's counterexample A); pairing against
    // the newest state would be wrong for a read that came before it. To be
    // looked at with E1 in F6's review.
    it('OPEN: an earlier write\'s lines after two renames traded the texts: X goes to Y\'s line', async () => {
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
        // Truth: X reads B on the top line. The ledger pairs by text.
        expect(bench.taskAt(1).id).toBe(x.id);
        expect(bench.taskAt(0).id).toBe(y.id);
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
