import { describe, it, expect } from 'vitest';
import { writeBench, FILE, type WriteBench } from '../helpers/writeBench';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import type { Task } from '../../../src/types';

/**
 * A completion answers by the write that last wrote its row (F6), and which
 * row that is comes from identity. While the ledger is older than our writes
 * (F5b's LIMIT window), the ladder can hand the name of a row the user
 * checked to another checked row with the same words. Found by F6's
 * counterexample run (L1–L4): a flow's completed row in the same signature
 * then grew the count, and the renamed row answered for the user.
 */

const A = (c: string) => `- [${c}] A @2026-09-21 ==> every mon`;
const check = (task: Task, c: string): Task => ({ ...task, statusChar: c });
const fired = (bench: WriteBench): number =>
    bench.flow.handleTaskCompletion.mock.calls.length;

describe('a flow\'s completed row beside a trade the ladder undoes', () => {
    it('fires nothing when the user\'s writes are undone by a sync built before them (L3)', async () => {
        const bench = await writeBench([A('x'), A(' ')]);
        const y = bench.taskAt(0), x = bench.taskAt(1);
        expect((await bench.writer.updateTaskInFile(plannedOn(x), check(x, 'x'))).written).toBe(true);
        expect((await bench.writer.updateTaskInFile(plannedOn(y), check(y, ' '))).written).toBe(true);
        await bench.writer.appendTaskToFile(FILE, A('x'), 'flow');
        bench.edit([A('x'), A(' '), A('x'), 'メモ']);
        await bench.scan();
        expect(fired(bench)).toBe(0);
    });

    it('fires nothing when the sync is built on the flow\'s write, before the user\'s (L4)', async () => {
        const bench = await writeBench([A('x'), A(' ')]);
        const y = bench.taskAt(0), x = bench.taskAt(1);
        await bench.writer.appendTaskToFile(FILE, A('x'), 'flow');
        const afterFlow = bench.lines();
        expect((await bench.writer.updateTaskInFile(plannedOn(x), check(x, 'x'))).written).toBe(true);
        expect((await bench.writer.updateTaskInFile(plannedOn(y), check(y, ' '))).written).toBe(true);
        bench.edit([...afterFlow, 'メモ']);
        await bench.scan();
        expect(fired(bench)).toBe(0);
    });

    // A known limit, pinned as it stands (L1). With no flow row, a sync built
    // before the user's trade adds a completed row of its own. A row no write
    // of ours wrote cannot say whether it is new or was counted before, so
    // the count grows by the sync's row and the renamed row answers for the
    // user. It takes the LIMIT window and rows with the same words; with the
    // ledger current (each write scanned) it fires nothing.
    it('fires once when a sync built before the trade adds a completed row of its own (L1, a known limit)', async () => {
        const bench = await writeBench([A(' '), A('x')]);
        const x = bench.taskAt(0), y = bench.taskAt(1);
        expect((await bench.writer.updateTaskInFile(plannedOn(x), check(x, 'x'))).written).toBe(true);
        expect((await bench.writer.updateTaskInFile(plannedOn(y), check(y, ' '))).written).toBe(true);
        bench.edit([A(' '), A('x'), A('x')]);
        await bench.scan();
        expect(fired(bench)).toBe(1);
    });
});
