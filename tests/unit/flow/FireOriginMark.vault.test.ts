import { describe, it, expect, vi } from 'vitest';
import { vaultSession } from '../helpers/vaultSession';
import { writeBench, makeFile, FILE as BENCH_FILE, type WriteBench } from '../helpers/writeBench';
import { replaceWhole } from '../../../src/utils/FileLines';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import type { Task } from '../../../src/types';

/**
 * A write of ours that cannot say what it did leaves a mark, not a claim
 * (`WriteClaims`): its base is a content no record describes. A completion
 * such a write made still has to answer for the user (F6, the director's
 * review): a card's check on one row, built on a file a sync had changed on
 * another row and no scan had read yet.
 */

const FILE = 'note.md';

function open(lines: string[]) {
    const contents = new Map([[FILE, lines.join('\n')]]);
    const session = vaultSession(contents);
    const executor = session.executor;
    const fired: string[] = [];
    const original = executor.handleTaskCompletion.bind(executor);
    executor.handleTaskCompletion = (task: Task) => { fired.push(task.content); return original(task); };
    const settled = async () => {
        await vi.waitFor(() => expect(executor.isProcessing).toBe(false));
        await session.settle(FILE);
        await vi.waitFor(() => expect(executor.isProcessing).toBe(false));
    };
    return { contents, session, fired, settled, idOf: (c: string) => session.index.getTasks().find(t => t.content === c)!.id };
}

describe('a completion made by a write that could only leave a mark', () => {
    it('fires when a sync changed another row before any scan read it', async () => {
        const note = open(['# note', '- [ ] 甲 @2026-09-21 ==> every mon', '- [ ] 乙', '']);
        await note.session.scanAll();
        // The sync lands with no modify heard yet: nothing has read it.
        note.contents.set(FILE, ['# note', '- [ ] 甲 @2026-09-21 ==> every mon', '- [ ] 乙 synced', ''].join('\n'));
        expect(await note.session.index.updateTask(note.idOf('甲'), { statusChar: 'x' })).toBe(true);
        await note.settled();
        expect(note.fired).toEqual(['甲']);
    });
});

/**
 * A mark says only the rows its write rewrote, as a claim does — not a row
 * the write found to write beside it. Found by F6's counterexample run 8: a
 * child written under a completed row named that row unchanged, and a flow's
 * or a sync's completed row with the same words then rode on it.
 */
describe('what a mark answers for', () => {
    const A = (c: string) => `- [${c}] A @2026-09-21 ==> every mon`;
    const check = (task: Task, c: string): Task => ({ ...task, statusChar: c });
    const firedIn = (bench: WriteBench): number =>
        bench.flow.handleTaskCompletion.mock.calls.length;

    it('not a completed row a child was written under: a sync\'s completed row does not ride on it', async () => {
        const bench = await writeBench([A('x'), '- [ ] 乙']);
        const y = bench.taskAt(0);
        bench.edit([A('x'), '- [ ] 乙 synced']);
        expect((await bench.writer.insertLineAfterTask(y, 'メモ')).written).toBe(true);
        bench.edit([...bench.lines(), A('x')]);
        await bench.scan();
        expect(firedIn(bench)).toBe(0);
    });

    it('a file replaced whole cannot say which rows it wrote, so a completion before it answers to nothing past it', async () => {
        // The whole replacement may have rewritten the row the user checked;
        // a mark that cannot say is where the search stops.
        const bench = await writeBench([A(' '), '- [ ] 乙']);
        const x = bench.taskAt(0);
        expect((await bench.writer.updateTaskInFile(plannedOn(x), check(x, 'x'))).written).toBe(true);
        await replaceWhole(bench.app, makeFile(BENCH_FILE), bench.channel(), [...bench.lines(), 'メモ'].join('\n'));
        await bench.scan();
        expect(firedIn(bench)).toBe(0);
    });

    it('fires the user\'s check once beside a flow\'s completed row, as without the sync', async () => {
        for (const withSync of [true, false]) {
            const bench = await writeBench([A('x') + ' ^y', A(' '), '- [ ] 乙']);
            const y = bench.taskAt(0), x = bench.taskAt(1);
            expect((await bench.writer.updateTaskInFile(plannedOn(x), check(x, 'x'))).written).toBe(true);
            if (withSync) bench.edit([...bench.lines().slice(0, 2), '- [ ] 乙 synced']);
            expect((await bench.writer.insertLineAfterTask(y, 'メモ')).written).toBe(true);
            await bench.writer.appendTaskToFile(BENCH_FILE, A('x'), 'flow');
            await bench.scan();
            expect(firedIn(bench)).toBe(1);
        }
    });
});
