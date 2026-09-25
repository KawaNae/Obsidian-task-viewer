import { describe, it, expect } from 'vitest';
import { writeBench, FILE } from '../helpers/writeBench';
import type { Task } from '../../../src/types';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';

/**
 * Which line a write lands on, in the shapes real notes hold.
 *
 * A write takes its row by the line the index's copy stands on, and only if
 * the line there still reads as the copy (`WriteSession.row`). Nothing looks
 * for the row anywhere else: not by its name, not by its `^id`, not by the
 * first line that reads like it (2026-09-24). So after an edit from outside
 * that moved the row, the write is refused until a scan has read the file.
 *
 * Every case reads the file first, then lets something other than the plugin
 * change it, then writes from the copy the scan read.
 */

const checked = (task: Task): Task => ({ ...task, statusChar: 'x' });

/** Read `before`, change the file to `after` from outside, then check the task read on `line`. */
async function checkAfterEdit(before: string[], line: number, after: string[]) {
    const bench = await writeBench(before);
    const task = bench.taskAt(line);
    bench.edit(after);
    const written = (await bench.writer.updateTaskInFile(plannedOn(task), checked(task))).written;
    return { bench, written };
}

describe('a row an edit from outside moved', () => {
    it('is not looked for: not in the line past the fence that reads like it', async () => {
        const line = '- [ ] 設計 @2026-08-14T10:00';
        const { bench, written } = await checkAfterEdit(
            ['```md', line, '```', line],
            3,
            ['メモ', '```md', line, '```', line],
        );

        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['メモ', '```md', line, '```', line]);
        expect(bench.refused).toEqual([{ file: FILE, reason: { kind: 'changed' }, subject: '設計' }]);
    });

    it('is not looked for by its ^id either', async () => {
        const { bench, written } = await checkAfterEdit(
            ['- [ ] task ^target', '- [ ] task'],
            0,
            ['- [ ] task', '- [ ] task ^target'],
        );

        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] task', '- [ ] task ^target']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('is written once a scan has read where it went', async () => {
        const pomodoro = [
            '- [ ] 🍅 スタディ3 @2026-08-14T09:00>09:25',
            '- [ ] 🍅 スタディ3 @2026-08-14T09:30>09:55',
            '- [ ] 🍅 スタディ3 @2026-08-14T10:00>10:25',
        ];
        const { bench, written } = await checkAfterEdit(pomodoro, 2, ['メモ', ...pomodoro]);
        expect(written).toBe(false);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);

        await bench.scan();
        const task = bench.taskAt(3);
        expect((await bench.writer.updateTaskInFile(plannedOn(task), checked(task))).written).toBe(true);
        expect(bench.lines()).toEqual(['メモ', pomodoro[0], pomodoro[1], '- [x] 🍅 スタディ3 @2026-08-14T10:00>10:25']);
    });

    it('writes nothing when the row\'s line is past the end of the file', async () => {
        const { bench, written } = await checkAfterEdit(
            ['- [ ] 買い物リスト @2026-08-12', '- [ ] 買い物 @2026-08-13'],
            1,
            ['- [ ] 買い物リスト @2026-08-12'],
        );

        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] 買い物リスト @2026-08-12']);
        expect(bench.refused).toEqual([{ file: FILE, reason: { kind: 'changed' }, subject: '買い物' }]);
    });
});

describe('a line that reads as the copy on the copy\'s line', () => {
    it('is written when only lines below it changed', async () => {
        const { bench, written } = await checkAfterEdit(
            ['- [ ] 設計 @2026-08-15', 'メモ'],
            0,
            ['- [ ] 設計 @2026-08-15', 'メモ 書き足し', '- [ ] 別'],
        );

        expect(written).toBe(true);
        expect(bench.lines()).toEqual(['- [x] 設計 @2026-08-15', 'メモ 書き足し', '- [ ] 別']);
    });

    it('is written though it is the twin of the row that was read there', async () => {
        // Nothing in the file tells two rows that read the same apart, and no
        // name lasts past the read (2026-09-24): the line the copy stands on
        // reads as the copy, which is all the write was planned from.
        const same = ['- [ ] 別 @2026-08-14', '- [ ] 読書 @2026-08-14', '- [ ] 読書 @2026-08-14'];
        const { bench, written } = await checkAfterEdit(same, 2, ['メモ', ...same]);

        expect(written).toBe(true);
        expect(bench.lines()).toEqual(['メモ', same[0], '- [x] 読書 @2026-08-14', same[2]]);
    });
});

describe('a line edited from outside since the index read it', () => {
    it('is not rebuilt from the index\'s copy', async () => {
        const { bench, written } = await checkAfterEdit(
            ['- [ ]  @2026-08-15'],
            0,
            ['- [ ] 名前あり @2026-08-15'],
        );

        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] 名前あり @2026-08-15']);
        expect(bench.refused).toEqual([{ file: FILE, reason: { kind: 'changed' }, subject: '- [ ]  @2026-08-15' }]);
    });

    it('is written from the index\'s copy of the plugin\'s own change, before any scan', async () => {
        const bench = await writeBench(['- [ ] 設計 @2026-08-15']);
        const task = bench.taskAt(0);
        const first = await bench.writer.updateTaskInFile(plannedOn(task), { ...task, content: '設計書' });
        expect(first.written).toBe(true);

        // The index read what the update left once it landed (`landed`).
        const copy = bench.taskAt(0);
        expect(copy.originalText).toBe('- [ ] 設計書 @2026-08-15');
        expect((await bench.writer.updateTaskInFile(plannedOn(copy), checked(copy))).written).toBe(true);
        expect(bench.lines()).toEqual(['- [x] 設計書 @2026-08-15']);
    });

    it('is not written from a copy that predates the plugin\'s own change', async () => {
        const bench = await writeBench(['- [ ] 設計 @2026-08-15']);
        const task = bench.taskAt(0);
        expect((await bench.writer.updateTaskInFile(plannedOn(task), { ...task, content: '設計書' })).written).toBe(true);

        // Planned from the copy the first update did not bring up: it would
        // put the old name back over the one just written.
        expect((await bench.writer.updateTaskInFile(plannedOn(task), checked(task))).written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] 設計書 @2026-08-15']);
        expect(bench.refused).toEqual([{ file: FILE, reason: { kind: 'changed' }, subject: '設計' }]);
    });
});
