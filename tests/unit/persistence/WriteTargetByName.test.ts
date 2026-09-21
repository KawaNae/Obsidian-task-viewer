import { describe, it, expect } from 'vitest';
import { writeBench, FILE } from '../helpers/writeBench';
import type { Task } from '../../../src/types';

/**
 * Which line a write lands on, in the shapes real notes hold.
 *
 * These shapes were pinned against `FileOperations.findTaskLineNumber`, which
 * looked a task up by its stored line, its text, and its name and date. That
 * search is gone: a write names its task and asks the scanner where it stands
 * (`TaskScanner.locate`, pinned on its own in `Locate.test.ts`). What the
 * shapes still say is what a write must do with them — land on the right line,
 * or write nothing and say why.
 *
 * Every case reads the file first, then lets something other than the plugin
 * change it, so the write cannot answer from a content on record and has to
 * work the lines out.
 */

const checked = (task: Task): Task => ({ ...task, statusChar: 'x' });

/** Read `before`, change the file to `after` from outside, then check the task read on `line`. */
async function checkAfterEdit(before: string[], line: number, after: string[]) {
    const bench = await writeBench(before);
    const task = bench.taskAt(line);
    bench.edit(after);
    const written = await bench.writer.updateTaskInFile(task, checked(task));
    return { bench, written };
}

describe('a line inside a code fence is never the target', () => {
    it('writes the real line, not an identical sample above it', async () => {
        const line = '- [ ] 設計 @2026-08-14T10:00';
        const { bench, written } = await checkAfterEdit(
            ['```md', line, '```', line],
            3,
            ['メモ', '```md', line, '```', line],
        );

        expect(written).toBe(true);
        expect(bench.lines()).toEqual(['メモ', '```md', line, '```', '- [x] 設計 @2026-08-14T10:00']);
        expect(bench.refused).toEqual([]);
    });

    it('writes nothing when the only line like it now sits inside a fence', async () => {
        const line = '- [ ] 設計 @2026-08-14T10:00';
        const { bench, written } = await checkAfterEdit([line], 0, ['```md', line, '```']);

        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['```md', line, '```']);
        expect(bench.refused).toEqual([{ file: FILE, reason: { kind: 'gone' }, subject: '設計' }]);
    });
});

describe('a ^id decides only when it names one line', () => {
    it('follows the ^id past a line that reads the same without it', async () => {
        const { bench, written } = await checkAfterEdit(
            ['- [ ] task ^target', '- [ ] task'],
            0,
            ['- [ ] task', '- [ ] task ^target'],
        );

        expect(written).toBe(true);
        expect(bench.lines()).toEqual(['- [ ] task', '- [x] task ^target']);
    });
});

describe('a name is not a prefix of another', () => {
    it('writes 買い物, not 買い物リスト, after both moved', async () => {
        const { bench, written } = await checkAfterEdit(
            ['- [ ] 買い物リスト @2026-08-12', '- [ ] 買い物 @2026-08-13'],
            1,
            ['# 見出し', '- [ ] 買い物リスト @2026-08-12', '- [ ] 買い物 @2026-08-13'],
        );

        expect(written).toBe(true);
        expect(bench.lines()).toEqual(['# 見出し', '- [ ] 買い物リスト @2026-08-12', '- [x] 買い物 @2026-08-13']);
    });

    it('writes nothing to 買い物リスト when 買い物 is gone', async () => {
        const { bench, written } = await checkAfterEdit(
            ['- [ ] 買い物リスト @2026-08-12', '- [ ] 買い物 @2026-08-13'],
            1,
            ['- [ ] 買い物リスト @2026-08-12'],
        );

        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] 買い物リスト @2026-08-12']);
        expect(bench.refused).toEqual([{ file: FILE, reason: { kind: 'gone' }, subject: '買い物' }]);
    });
});

describe('rows that share a name', () => {
    // A day of pomodoros is a column of one name; the times tell them apart.
    const pomodoro = [
        '- [ ] 🍅 スタディ3 @2026-08-14T09:00>09:25',
        '- [ ] 🍅 スタディ3 @2026-08-14T09:30>09:55',
        '- [ ] 🍅 スタディ3 @2026-08-14T10:00>10:25',
        '- [ ] 🍅 スタディ3 @2026-08-14T10:30>10:55',
    ];

    it('writes the record the write named, not the first of the run', async () => {
        const { bench, written } = await checkAfterEdit(pomodoro, 2, ['メモ', ...pomodoro]);

        expect(written).toBe(true);
        expect(bench.lines()).toEqual([
            'メモ', pomodoro[0], pomodoro[1], '- [x] 🍅 スタディ3 @2026-08-14T10:00>10:25', pomodoro[3],
        ]);
    });

    it('writes neither of two rows that read exactly the same', async () => {
        // No time to tell them apart. A write used to land on the first one
        // without saying so.
        const same = ['- [ ] 別 @2026-08-14', '- [ ] 読書 @2026-08-14', '- [ ] 読書 @2026-08-14'];
        const { bench, written } = await checkAfterEdit(same, 2, ['メモ', ...same]);

        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['メモ', ...same]);
        expect(bench.refused).toEqual([{ file: FILE, reason: { kind: 'ambiguous', count: 2 }, subject: '読書' }]);
    });
});

describe('a row with no name', () => {
    it('is written when its line is the only one that reads like it, date or not', async () => {
        // Nothing but notation, and no date either. The old search had nothing
        // to compare and refused; the row's own name finds it now.
        const { bench, written } = await checkAfterEdit(
            ['- [ ] ', '- [ ] 名前あり'],
            0,
            ['メモ', '- [ ] ', '- [ ] 名前あり'],
        );

        expect(written).toBe(true);
        expect(bench.lines()).toEqual(['メモ', '- [x]', '- [ ] 名前あり']);
    });

    it('writes neither of two nameless rows that read the same', async () => {
        const rows = ['- [ ]  @2026-08-15', '- [ ]  @2026-08-15'];
        const { bench, written } = await checkAfterEdit(rows, 1, ['メモ', ...rows]);

        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['メモ', ...rows]);
        expect(bench.refused).toEqual([{ file: FILE, reason: { kind: 'ambiguous', count: 2 }, subject: '- [ ]  @2026-08-15' }]);
    });
});

describe('a line edited from outside since the index read it', () => {
    // The ladder still pairs the row (its dates did not change), so the write
    // knows where it is. What it does not know is the text: an update rebuilds
    // the whole line from the index's copy, and that copy predates the edit.
    // Writing it would put back what the edit took out.

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

    it('is still written when only other lines moved', async () => {
        const { bench, written } = await checkAfterEdit(
            ['- [ ] 設計 @2026-08-15'],
            0,
            ['メモ', '- [ ] 設計 @2026-08-15'],
        );

        expect(written).toBe(true);
        expect(bench.lines()).toEqual(['メモ', '- [x] 設計 @2026-08-15']);
    });

    it('is still written when the plugin itself changed it and no scan has read it yet', async () => {
        const bench = await writeBench(['- [ ] 設計 @2026-08-15']);
        const task = bench.taskAt(0);
        // Our own update, then an edit elsewhere from outside, before any scan.
        expect(await bench.writer.updateTaskInFile(task, { ...task, content: '設計書' })).toBe(true);
        bench.edit(['メモ', ...bench.lines()]);

        expect(await bench.writer.updateTaskInFile(task, checked({ ...task, content: '設計書' }))).toBe(true);
        expect(bench.lines()).toEqual(['メモ', '- [x] 設計書 @2026-08-15']);
    });
});
