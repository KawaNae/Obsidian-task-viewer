import { describe, it, expect } from 'vitest';
import { writeBench, FILE, type WriteBench } from '../helpers/writeBench';
import type { Task } from '../../../src/types';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';

/**
 * A read may be more than one state (I1, `WriteClaims.reading`): two known
 * states with its content (K2), or a known state put back and a change after
 * the newest record that reads the same (an outside mark after it). A row
 * keeps a name only where every reading gives it that name.
 */

/** Something other than the plugin changed the file, without the change being counted. */
function unnoticed(bench: WriteBench, lines: string[]): void {
    Map.prototype.set.call(bench.contents, FILE, lines.join('\n'));
}

describe('K2: two known states with the read\'s content', () => {
    it('that name the rows alike: the read takes their names (F5b\'s K2: a deleted row does not come back)', async () => {
        // X is deleted, then Y renamed and renamed back, no scan in between:
        // the first and the third record have the same content and the same
        // names, and neither holds X.
        const bench = await writeBench(['- [ ] A', '- [ ] B']);
        const x = bench.taskAt(0);
        const y = bench.taskAt(1);
        expect(await bench.writer.deleteTaskFromFile(plannedOn(x))).toBe(true);
        expect((await bench.writer.updateTaskInFile(plannedOn(y), { ...y, content: 'B2', originalText: '- [ ] B2' })).written).toBe(true);
        const renamed: Task = { ...y, line: 0, content: 'B2', originalText: '- [ ] B2' };
        expect((await bench.writer.updateTaskInFile(plannedOn(renamed), { ...renamed, content: 'B', originalText: '- [ ] B' })).written).toBe(true);
        expect(bench.lines()).toEqual(['- [ ] B']);
        expect(bench.scanner.getWriteClaims().peek(FILE).links).toEqual(['record', 'record', 'record']);
        await bench.scan();
        expect(bench.tasks().map(task => task.id)).toEqual([y.id]);
    });

    it('that name the rows differently: the rows they disagree on are new', async () => {
        // A copy goes below the original, then the original goes: the file
        // reads as the ledger recorded it, but the one row is the copy.
        const bench = await writeBench(['- [ ] T', '']);
        const original = bench.taskAt(0);
        await bench.writer.appendTaskToFile(FILE, '- [ ] T');
        expect(await bench.writer.deleteTaskFromFile(plannedOn(original))).toBe(true);
        expect(bench.lines()).toEqual(['- [ ] T', '']);
        // A write is handed the file after every write of ours has landed, so
        // these lines are the second write's: the original is gone. A scan
        // cannot know as much (its read may have come before our writes).
        expect(bench.scanner.locate(FILE, bench.lines(), { runtimeId: original.id })).toEqual({ kind: 'gone' });
        // The scan's read is the ledger's state or the second write's, and the
        // two name the one row differently: it is new.
        await bench.scan();
        const [row] = bench.tasks();
        expect(row.id).not.toBe(original.id);
        expect(bench.scanner.getLedger().snapshotFor(FILE).map(entry => entry.runtimeId)).toEqual([row.id]);
    });

    it('that name some rows alike and one differently: only that one is new', async () => {
        const bench = await writeBench(['- [ ] 甲', '- [ ] T', '']);
        const kou = bench.taskAt(0);
        const original = bench.taskAt(1);
        await bench.writer.appendTaskToFile(FILE, '- [ ] T');
        expect(await bench.writer.deleteTaskFromFile(plannedOn(original))).toBe(true);
        expect(bench.lines()).toEqual(['- [ ] 甲', '- [ ] T', '']);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(kou.id);
        expect(bench.taskAt(1).id).not.toBe(original.id);
    });
});

describe('a note with no two rows alike: an outside mark changes no answer', () => {
    // Lead's gate for I1: an ordinary hand edit, counted as an outside change,
    // must not cost a name where the rows are all different. Each case runs
    // the same writes and edits twice, once with the edits counted and once
    // not, and the names have to come out the same way both times.
    type Step = (bench: WriteBench, edit: (lines: string[]) => void) => Promise<void>;

    async function run(steps: Step[], counted: boolean): Promise<string[]> {
        const bench = await writeBench(['- [ ] A @2026-09-21', '- [ ] B @2026-09-21', '- [ ] C @2026-09-21', '']);
        const names = new Map(bench.tasks().map(task => [task.id, task.originalText.slice(6, 7)]));
        const edit = counted ? (lines: string[]) => bench.edit(lines) : (lines: string[]) => unnoticed(bench, lines);
        for (const step of steps) await step(bench, edit);
        await bench.scan();
        // Each row as the letter its name was first given to, or new.
        return bench.tasks().map(task => names.get(task.id) ?? 'new');
    }

    const update = (text: string, to: string): Step => async bench => {
        const task = bench.tasks().find(candidate => candidate.originalText.startsWith(`- [ ] ${text}`)) as Task;
        expect((await bench.writer.updateTaskInFile(plannedOn(task), { ...task, content: to, originalText: task.originalText.replace(text, to) })).written).toBe(true);
    };
    const typed = (lines: string[]): Step => async (_bench, edit) => { edit(lines); };
    const scan: Step = async bench => { await bench.scan(); };

    const cases: Array<[string, Step[]]> = [
        ['a line typed below', [typed(['- [ ] A @2026-09-21', '- [ ] B @2026-09-21', '- [ ] C @2026-09-21', 'メモ'])]],
        ['a row edited by hand', [typed(['- [ ] A @2026-09-21', '- [ ] B2 @2026-09-21', '- [ ] C @2026-09-21', ''])]],
        ['a card edit, then a line typed', [update('B', 'B2'), typed(['- [ ] A @2026-09-21', '- [ ] B2 @2026-09-21', '- [ ] C @2026-09-21', 'メモ'])]],
        ['a card edit, then typed and taken back by hand', [
            update('B', 'B2'),
            typed(['- [ ] A @2026-09-21', '- [ ] B2 @2026-09-21', '- [ ] C @2026-09-21', 'メモ']),
            typed(['- [ ] A @2026-09-21', '- [ ] B2 @2026-09-21', '- [ ] C @2026-09-21', '']),
        ]],
        ['a card edit undone by hand', [update('B', 'B2'), typed(['- [ ] A @2026-09-21', '- [ ] B @2026-09-21', '- [ ] C @2026-09-21', ''])]],
        ['a card edit, scanned, then undone by hand', [update('B', 'B2'), scan, typed(['- [ ] A @2026-09-21', '- [ ] B @2026-09-21', '- [ ] C @2026-09-21', ''])]],
        ['two card edits on two rows, then a line typed', [update('A', 'A2'), update('C', 'C2'), typed(['- [ ] A2 @2026-09-21', '- [ ] B @2026-09-21', '- [ ] C2 @2026-09-21', 'メモ'])]],
        ['rows moved by hand', [typed(['- [ ] C @2026-09-21', '- [ ] A @2026-09-21', '- [ ] B @2026-09-21', ''])]],
    ];

    it.each(cases)('%s', async (_name, steps) => {
        const counted = await run(steps, true);
        const uncounted = await run(steps, false);
        expect(counted).toEqual(uncounted);
        expect(counted).not.toContain('new');
    });
});
