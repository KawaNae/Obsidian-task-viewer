import { describe, it, expect } from 'vitest';
import { writeBench, FILE } from '../helpers/writeBench';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import type { Task } from '../../../src/types';

/**
 * Stage F5: one check for every write that names a row.
 *
 * A write that takes its row by name carries what it was planned from, and
 * `WriteSession.row` checks the lines read that way before handing out the
 * line. F2's `edited` accepted any text on record for the row, a write of ours
 * included, so a plan made from a copy older than our own last write could
 * still be written over it. These pin the shapes that differ.
 */

const checked = (task: Task): Task => ({ ...task, statusChar: 'x' });

describe('after the editor\'s menu rewrote a row, before any scan', () => {
    // The menu writes by coordinate and cannot bring the index's copy up to
    // what it wrote. A write planned from that copy would put the row back.
    const ROW = '- [ ] 設計 @2026-09-21';
    const TICKED = '- [x] 設計 @2026-09-21';

    const afterMenu = async () => {
        const bench = await writeBench([ROW, '']);
        const task = bench.taskAt(0);
        await bench.writer.updateLine(FILE, { line: 0, text: ROW }, TICKED);
        expect(bench.lines()).toEqual([TICKED, '']);
        return { bench, task };
    };

    it('refuses a card\'s update made from the copy, and keeps the tick', async () => {
        const { bench, task } = await afterMenu();
        const outcome = await bench.writer.updateTaskInFile(plannedOn(task), { ...task, content: '設計書' });

        expect(outcome.written).toBe(false);
        expect(bench.lines()).toEqual([TICKED, '']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('refuses a duplicate-as-next made from the copy', async () => {
        const { bench, task } = await afterMenu();
        const written = await bench.cloner.duplicateInlineTaskInPlace(
            plannedOn(task), { kind: 'lines', lines: ['- [ ] 設計 @2026-09-22'] });

        expect(written.written).toBe(false);
        expect(bench.lines()).toEqual([TICKED, '']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('refuses a delete and a shifted duplicate as well', async () => {
        const { bench, task } = await afterMenu();

        expect((await bench.writer.deleteTaskFromFile(plannedOn(task, { subtree: true }))).written).toBe(false);
        expect((await bench.cloner.duplicateInlineTask(plannedOn(task), { dayOffset: 1 })).written).toBe(false);
        expect(bench.lines()).toEqual([TICKED, '']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed', 'changed']);
    });

    it('still lets a timer write its record: the row reads as the menu\'s write left it', async () => {
        // The timer's inserts keep the weaker comparison until F9: a record
        // refused here would be a measurement lost (`RowBasis.ON_RECORD`).
        const { bench, task } = await afterMenu();

        expect((await bench.writer.insertLineAsFirstChild(task, '- [x] ⏱️ 記録')).written).toBe(true);
        expect(bench.lines()).toEqual([TICKED, '\t- [x] ⏱️ 記録', '']);
    });

    it('refuses a timer\'s record on a row rewritten from outside, which no record reads', async () => {
        // The weaker comparison still compares: an undated row the ladder
        // pairs one-against-one with a line written from outside (R4) is not
        // on record for it.
        const bench = await writeBench(['- [ ] alpha', '- [ ] buy milk', '- [ ] omega']);
        const milk = bench.taskAt(1);
        bench.edit(['- [ ] alpha', '- [ ] omega', '- [ ] call mom']);

        expect((await bench.writer.insertLineAsFirstChild(milk, '- [x] ⏱️ 記録')).written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] alpha', '- [ ] omega', '- [ ] call mom']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('lets the same writes through once a scan has read the tick', async () => {
        const { bench } = await afterMenu();
        await bench.scan();
        const task = bench.taskAt(0);

        expect((await bench.writer.updateTaskInFile(plannedOn(task), { ...task, content: '設計書' })).written).toBe(true);
        expect(bench.lines()).toEqual(['- [x] 設計書 @2026-09-21', '']);
    });
});

describe('the menu\'s own coordinate', () => {
    it('is refused when the line no longer reads what the editor showed', async () => {
        const bench = await writeBench(['- [ ] A', '']);
        await bench.writer.updateLine(FILE, { line: 0, text: '- [ ] B' }, '- [x] B');

        expect(bench.lines()).toEqual(['- [ ] A', '']);
        expect(bench.refused).toEqual([{ file: FILE, reason: { kind: 'changed' }, subject: '- [ ] B' }]);
    });
});

describe('applyToTask checks its basis whatever the ops are', () => {
    // Until F5 the basis was read inside the first op, so an empty list of ops
    // answered written without looking. A fire's plan always strips its
    // command, which is what kept that from mattering.
    it('refuses an empty list of ops planned from a copy the file has moved on from', async () => {
        const bench = await writeBench(['- [ ] A', '']);
        const task = bench.taskAt(0);
        bench.edit(['- [ ] A edited', '']);

        const outcome = await bench.writer.applyToTask(plannedOn(task), []);

        expect(outcome.written).toBe(false);
        expect(outcome.refused?.reason).toEqual({ kind: 'changed' });
    });

    it('answers written for an empty list of ops on a row that reads as planned', async () => {
        const bench = await writeBench(['- [ ] A', '']);
        const outcome = await bench.writer.applyToTask(plannedOn(bench.taskAt(0)), []);

        expect(outcome.written).toBe(true);
        expect(bench.lines()).toEqual(['- [ ] A', '']);
    });
});

describe('an operation that takes the row away plans from its subtree', () => {
    // F4's last out-of-scope shape. A task goes from outside, and before any
    // scan the line below it — past a blank, deeper than the task above —
    // reads as that task's child. A delete planned from the scan's copy of the
    // upper task would take it too.
    const scanned = ['- [ ] A', '- [ ] B', '', '    B のメモ', ''];
    const edited = ['- [ ] A', '', '    B のメモ', ''];

    it('refuses a delete once a line has joined the subtree', async () => {
        const bench = await writeBench(scanned);
        const a = bench.taskAt(0);
        bench.edit(edited);

        expect((await bench.writer.deleteTaskFromFile(plannedOn(a, { subtree: true }))).written).toBe(false);
        expect(bench.lines()).toEqual(edited);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('refuses a deletion fire the same way', async () => {
        const bench = await writeBench(scanned);
        const a = bench.taskAt(0);
        bench.edit(edited);

        const outcome = await bench.writer.applyToTask(
            plannedOn(a, { commands: true, subtree: true }), [{ kind: 'remove' }]);

        expect(outcome.written).toBe(false);
        expect(bench.lines()).toEqual(edited);
    });

    it('refuses a move within the file whose child was edited since', async () => {
        const bench = await writeBench(['- [ ] A', '    - [ ] 子', '- [ ] Z', '']);
        const a = bench.taskAt(0);
        bench.edit(['- [ ] A', '    - [ ] 子 書き足し', '- [ ] Z', '']);

        const outcome = await bench.writer.applyToTask(
            plannedOn(a, { commands: true, subtree: true }), [{ kind: 'move-to-end', text: '- [x] A' }]);

        expect(outcome.written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] A', '    - [ ] 子 書き足し', '- [ ] Z', '']);
    });

    it('takes the row and the subtree the scan read', async () => {
        const bench = await writeBench(scanned);
        expect((await bench.writer.deleteTaskFromFile(plannedOn(bench.taskAt(1), { subtree: true }))).written).toBe(true);
        expect(bench.lines()).toEqual(['- [ ] A', '']);
    });
});

describe('what an update leaves', () => {
    it('answers the row and its subtree as the write left them', async () => {
        const bench = await writeBench(['- [ ] A', '    - key:: v', '- [ ] B', '']);
        const a = bench.taskAt(0);

        const outcome = await bench.writer.updateTaskInFile(plannedOn(a), checked(a));

        expect(outcome.rows.get(a.id)).toEqual({
            read: ['- [ ] A', '    - key:: v'],
            left: ['- [x] A', '    - key:: v'],
        });
    });

    it('answers nothing when nothing was written', async () => {
        const bench = await writeBench(['- [ ] A', '']);
        const a = bench.taskAt(0);
        bench.edit(['- [ ] A edited', '']);

        const outcome = await bench.writer.updateTaskInFile(plannedOn(a), checked(a));

        expect(outcome.written).toBe(false);
        expect(outcome).not.toHaveProperty('rows');
    });
});
