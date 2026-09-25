import { describe, it, expect } from 'vitest';
import { writeBench, FILE, type Filed, type WriteBench } from '../helpers/writeBench';
import type { Task } from '../../../src/types';
import { TaskParser } from '../../../src/services/parsing/TaskParser';
import type { TaskOp } from '../../../src/services/persistence/TaskOps';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';

/**
 * Counterexamples found against the name-based targeting of F2 to F5b (a write
 * named its target and asked `TaskScanner.locate` where it stood), rerun
 * against N1's: a write takes the line the index's copy stands on, and only if
 * the line there still reads as the copy (`WriteSession.row`).
 *
 * Nothing looks for a row anywhere else, so these shapes, which were about the
 * search pairing a name with the wrong line, are refused as `changed` now.
 * Where the copy's line reads otherwise, the basis refuses it. Where it reads
 * the same — a twin moved onto it — nothing on the line tells the twins
 * apart, so the line counts only in the content the copy was read in, or one
 * our own writes carried it to (`NamedRow.read`, 2026-09-25): after any edit
 * from outside, the write waits for a scan.
 */

const checked = (task: Task): Task => ({ ...task, statusChar: 'x' });

/** A recurrence's fire as the executor writes it: the next instance, then the strip, one write. */
const fire = (task: Task, next: string): TaskOp[] => [
    { kind: 'insert-instance', insert: { kind: 'recurrence', content: next, flowLines: ['every 1d'] } },
    { kind: 'strip-flow', text: TaskParser.format({ ...task, flow: undefined }).trim() },
];

/** The one claim a write filed. */
function only(filed: Filed[]): Filed {
    expect(filed).toHaveLength(1);
    return filed[0];
}

describe('nested rows that read the same', () => {
    // c1 and c2 read the same, under different parents, each with its own child.
    const before = [
        '- [ ] P1',
        '\t- [ ] c',
        '\t\t- [ ] g1',
        '- [ ] P2',
        '\t- [ ] c',
        '\t\t- [ ] g2',
    ];

    it('an external line above: the delete of c2 is refused, neither c taken', async () => {
        const bench = await writeBench(before);
        const c2 = bench.taskAt(4);
        bench.edit(['メモ', ...before]);
        expect((await bench.writer.deleteTaskFromFile(plannedOn(c2, { subtree: true }))).written).toBe(false);
        expect(bench.lines()).toEqual(['メモ', ...before]);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('N1 (F2\'s): c2\'s subtree moved above c1 from outside: the delete of c2 is refused', async () => {
        const bench = await writeBench(before);
        const c2 = bench.taskAt(4);
        const moved = [
            '- [ ] P1',
            '\t- [ ] c',
            '\t\t- [ ] g2',
            '\t- [ ] c',
            '\t\t- [ ] g1',
            '- [ ] P2',
        ];
        bench.edit(moved);
        const { written } = await bench.writer.deleteTaskFromFile(plannedOn(c2, { subtree: true }));

        expect(written).toBe(false);
        expect(bench.lines()).toEqual(moved);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });
});

describe('a row replaced from outside', () => {
    // R4: "buy milk" replaced from outside by "call mom" (a sync, or a delete
    // and an add in one save). The copy's line does not read "buy milk".
    it('R4: refuses to delete a row whose line reads another', async () => {
        const before = ['- [ ] alpha', '- [ ] buy milk', '- [ ] omega'];
        const bench = await writeBench(before);
        const milk = bench.taskAt(1);
        bench.edit(['- [ ] alpha', '- [ ] omega', '- [ ] call mom']);
        const { written } = await bench.writer.deleteTaskFromFile(plannedOn(milk, { subtree: true }));

        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] alpha', '- [ ] omega', '- [ ] call mom']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('the rewrite on the same shape is refused as changed', async () => {
        const bench = await writeBench(['- [ ] alpha', '- [ ] buy milk', '- [ ] omega']);
        const milk = bench.taskAt(1);
        bench.edit(['- [ ] alpha', '- [ ] omega', '- [ ] call mom']);
        const written = (await bench.writer.updateTaskInFile(plannedOn(milk), checked(milk))).written;
        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] alpha', '- [ ] omega', '- [ ] call mom']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('a line checked from outside is not rebuilt from the snapshot', async () => {
        const bench = await writeBench(['- [ ] A @2026-01-01', '- [ ] B @2026-01-02']);
        const a = bench.taskAt(0);
        bench.edit(['- [x] A @2026-01-01 #tag', '- [ ] B @2026-01-02']);
        const written = (await bench.writer.updateTaskInFile(plannedOn(a), { ...a, startDate: '2026-01-05' })).written;
        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['- [x] A @2026-01-01 #tag', '- [ ] B @2026-01-02']);
    });
});

describe('identical rows', () => {
    const same = ['- [ ] 読書', '- [ ] 読書', '- [ ] other'];

    it('with nothing changed, the second is written', async () => {
        const bench = await writeBench(same);
        const y = bench.taskAt(1);
        await bench.writer.updateTaskInFile(plannedOn(y), checked(y));
        expect(bench.lines()).toEqual(['- [ ] 読書', '- [x] 読書', '- [ ] other']);
    });

    it('a line inserted above from outside: refused, though the copy\'s line now holds its twin', async () => {
        // Refused as ambiguous under F2; written on the twin while N1 took a
        // line on its basis alone. The twin reads as the copy, and only the
        // content tells them apart: the copy was not read in this one.
        const bench = await writeBench(same);
        const y = bench.taskAt(1);
        bench.edit(['メモ', ...same]);
        const written = (await bench.writer.updateTaskInFile(plannedOn(y), checked(y))).written;
        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['メモ', ...same]);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('an edit below them from outside: refused until a scan, then written', async () => {
        // Refused as ambiguous under F2 (availability, not a wrong line).
        const bench = await writeBench(same);
        const y = bench.taskAt(1);
        const edited = ['- [ ] 読書', '- [ ] 読書', '- [ ] other!'];
        bench.edit(edited);
        expect((await bench.writer.updateTaskInFile(plannedOn(y), checked(y))).written).toBe(false);
        expect(bench.lines()).toEqual(edited);

        await bench.scan();
        const read = bench.taskAt(1);
        expect((await bench.writer.updateTaskInFile(plannedOn(read), checked(read))).written).toBe(true);
        expect(bench.lines()).toEqual(['- [ ] 読書', '- [x] 読書', '- [ ] other!']);
    });

    it('a stale copy after our own writes moved the rows: written where our writes carried the row', async () => {
        // The copy is the one the scan read, before our duplicate and the
        // frontmatter moved every row down. Only our own writes came between,
        // and their reports carry the copy's line to where the row is now.
        const bench = await writeBench(['- [ ] A', '- [ ] B']);
        const a = bench.taskAt(0);
        expect((await bench.cloner.duplicateInlineTask(plannedOn(a))).written).toBe(true);
        await bench.repo.setFrontmatterKeys(FILE, { color: 'red' });
        const after = bench.lines();
        // The duplicate went above the original (`duplicateInlineTask`).
        const row = after.lastIndexOf('- [ ] A');
        expect(row).toBeGreaterThan(0);
        expect((await bench.writer.updateTaskInFile(plannedOn(a), checked(a))).written).toBe(true);
        expect(bench.lines()).toEqual(after.map((line, i) => (i === row ? '- [x] A' : line)));
        expect(bench.refused).toEqual([]);
    });
});

describe('own writes and outside edits interleaved', () => {
    // X1: our write renames X to Y's text, then Y is deleted from outside
    // before any scan. A write on Y (from a view the scan has not refreshed)
    // landed on X under the ladder. Y's line now holds C.
    it('X1: a write on a row deleted from outside does not land on the row our own write renamed to its text', async () => {
        const bench = await writeBench(['- [ ] A', '- [ ] B', '- [ ] C']);
        const x = bench.taskAt(0);
        const y = bench.taskAt(1);
        await bench.writer.updateTaskInFile(plannedOn(x), { ...x, content: 'B', originalText: '- [ ] B' });
        expect(bench.lines()).toEqual(['- [ ] B', '- [ ] B', '- [ ] C']);
        bench.edit(['- [ ] B', '- [ ] C']);
        const written = (await bench.writer.updateTaskInFile(plannedOn(y), checked(y))).written;

        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] B', '- [ ] C']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('a scan that read before the write and committed after it: the next write from its reading is refused, not misplaced', async () => {
        const bench = await writeBench(['- [ ] 読書', '- [ ] 読書', '- [ ] other']);
        const y = bench.taskAt(1);
        const other = bench.taskAt(2);

        const scan = await gatedScan(bench);
        await bench.writer.updateTaskInFile(plannedOn(other), checked(other));
        scan.release();
        await scan.done;

        // The late scan's reading is of the content before our write, which
        // the file no longer reads as.
        const written = (await bench.writer.updateTaskInFile(plannedOn(bench.taskAt(1)), checked(y))).written;
        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] 読書', '- [ ] 読書', '- [x] other']);
    });
});

describe('^id', () => {
    // B1: the ^id moved from the task onto a paragraph line from outside, and
    // a write from a copy taken before still has the ^id. The copy's line no
    // longer reads as the copy, and nothing looks for the ^id.
    it('B1: a delete from a stale snapshot does not take the paragraph that now carries the ^id', async () => {
        const bench = await writeBench(['- [ ] A ^a', 'text']);
        const stale = bench.taskAt(0);
        bench.edit(['- [ ] A', 'text ^a']);
        await bench.scan();
        const { written } = await bench.writer.deleteTaskFromFile(plannedOn(stale, { subtree: true }));

        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] A', 'text ^a']);
    });

    it('a ^id line copied above from outside: refused until a scan', async () => {
        // Refused under F2, the ^id naming two lines. The copy's line reads
        // as the copy, and so does the line below it: which of the two is the
        // row the copy was read from, nothing on either line says.
        const bench = await writeBench(['- [ ] A ^a']);
        const x = bench.taskAt(0);
        bench.edit(['- [ ] A ^a', '- [ ] A ^a']);
        expect((await bench.writer.updateTaskInFile(plannedOn(x), checked(x))).written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] A ^a', '- [ ] A ^a']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });
});

describe('flow effects', () => {
    const DONE = '- [x] 🍅 記録';
    const TODO = '- [ ] 🍅 記録';
    const FLOW = '\t- ==> every 1d';

    it('create-next then strip-flow on the second of two identical fired records: the right one', async () => {
        // The next instance goes to the head of the sibling group (line 0).
        // The strip takes its line from the insert's report, in one write.
        const bench = await writeBench([DONE, FLOW, DONE, FLOW, '']);
        const second = bench.taskAt(2);
        await bench.writer.applyToTask(plannedOn(second), fire(second, TODO));
        expect(bench.lines()).toEqual([TODO, FLOW, DONE, FLOW, DONE, '']);
        expect(bench.refused).toEqual([]);
    });

    it('same-file move with an identical text: the original goes, not the row carried to the end', async () => {
        const bench = await writeBench(['- [x] A', '- [ ] B']);
        const a = bench.taskAt(0);
        const outcome = await bench.writer.applyToTask(plannedOn(a), [{ kind: 'move-to-end', text: '- [x] A' }]);
        expect(outcome.written).toBe(true);
        expect(bench.lines()).toEqual(['- [ ] B', '- [x] A']);
        expect(only(bench.filed).edits.some(edit => edit.kind === 'carried')).toBe(true);
    });

    it('an outside line before the fire: nothing lands, the command stays', async () => {
        // Landed under F3, the ladder finding the row below the new line.
        const bench = await writeBench([DONE, FLOW, '']);
        const rec = bench.taskAt(0);
        bench.edit(['メモ', DONE, FLOW, '']);
        const outcome = await bench.writer.applyToTask(plannedOn(rec), fire(rec, TODO));
        expect(outcome.written).toBe(false);
        expect(bench.lines()).toEqual(['メモ', DONE, FLOW, '']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('the fired row rewritten from outside before the fire: nothing lands, the command stays', async () => {
        const bench = await writeBench([DONE, FLOW, '']);
        const rec = bench.taskAt(0);
        const edited = ['- [x] 🍅 記録 書き足し', FLOW, ''];
        bench.edit(edited);
        const outcome = await bench.writer.applyToTask(plannedOn(rec), fire(rec, TODO));
        expect(outcome.written).toBe(false);
        expect(bench.lines()).toEqual(edited);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('an effect whose row an earlier effect took away: none of them lands, and it is told once', async () => {
        // The first op resolves; the second finds the row gone, carried across
        // the first's splice. The instance the first wrote does not stay.
        const bench = await writeBench([DONE, FLOW, '']);
        const rec = bench.taskAt(0);
        const outcome = await bench.writer.applyToTask(plannedOn(rec), [
            { kind: 'insert-instance', insert: { kind: 'recurrence', content: TODO, flowLines: ['every 1d'] } },
            { kind: 'remove' },
            { kind: 'strip-flow', text: DONE },
        ]);
        expect(outcome.written).toBe(false);
        expect(bench.lines()).toEqual([DONE, FLOW, '']);
        expect(bench.filed).toEqual([]);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['gone']);
    });
});

describe('editor-driven writes', () => {
    it('deleteLine refuses when the disk line no longer reads what the editor showed', async () => {
        const bench = await writeBench(['- [ ] A', '- [ ] B']);
        bench.edit(['メモ', '- [ ] A', '- [ ] B']);
        await bench.writer.deleteLine(FILE, { line: 1, text: '- [ ] B', subtree: ['- [ ] B'] });
        expect(bench.lines()).toEqual(['メモ', '- [ ] A', '- [ ] B']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    // The editor's delete takes the subtree it showed, and only that (F5): a
    // child the user has not seen is not taken with its parent.
    const shown = ['- [ ] A', '\t- [ ] c', '- [ ] B'];
    it('deleteLine refuses when a child was added under the line since the editor showed it', async () => {
        const bench = await writeBench(shown);
        bench.edit(['- [ ] A', '\t- [ ] c', '\t- [ ] 外で足した子', '- [ ] B']);
        await bench.writer.deleteLine(FILE, { line: 0, text: '- [ ] A', subtree: shown.slice(0, 2) });
        expect(bench.lines()).toEqual(['- [ ] A', '\t- [ ] c', '\t- [ ] 外で足した子', '- [ ] B']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('deleteLine refuses when a child under the line was rewritten since the editor showed it', async () => {
        const bench = await writeBench(shown);
        bench.edit(['- [ ] A', '\t- [ ] c 書き換えた', '- [ ] B']);
        await bench.writer.deleteLine(FILE, { line: 0, text: '- [ ] A', subtree: shown.slice(0, 2) });
        expect(bench.lines()).toEqual(['- [ ] A', '\t- [ ] c 書き換えた', '- [ ] B']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('deleteLine takes the line and the subtree the editor showed when the file still reads so', async () => {
        const bench = await writeBench(shown);
        await bench.writer.deleteLine(FILE, { line: 0, text: '- [ ] A', subtree: shown.slice(0, 2) });
        expect(bench.lines()).toEqual(['- [ ] B']);
        expect(bench.refused).toEqual([]);
    });
});

describe('a guess by position one level up', () => {
    // S1: identical parents, each with one `c`. The ladder paired the
    // children by the parents' positions.
    const before = [
        '- [ ] p',
        '\t- [ ] c',
        '\t\t- [ ] g1',
        '- [ ] p',
        '\t- [ ] c',
        '\t\t- [ ] g2',
    ];

    it('S1a: subtrees swapped from outside: the delete of c1 takes neither c and g', async () => {
        const bench = await writeBench(before);
        const c1 = bench.taskAt(1);
        const swapped = ['- [ ] p', '\t- [ ] c', '\t\t- [ ] g2', '- [ ] p', '\t- [ ] c', '\t\t- [ ] g1'];
        bench.edit(swapped);
        expect((await bench.writer.deleteTaskFromFile(plannedOn(c1, { subtree: true }))).written).toBe(false);
        expect(bench.lines()).toEqual(swapped);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('S1b: the first subtree deleted from outside: a delete of c1 does not take c2', async () => {
        const bench = await writeBench(before);
        const c1 = bench.taskAt(1);
        bench.edit(before.slice(3));
        expect((await bench.writer.deleteTaskFromFile(plannedOn(c1, { subtree: true }))).written).toBe(false);
        expect(bench.lines()).toEqual(before.slice(3));
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('S1c: the same, an update: c2, which now stands on c1\'s line and reads as it, is not written', async () => {
        // An update plans from the row's line alone, and the line reads so;
        // the delete above plans from the subtree too, which does not. The
        // content tells them apart: c1 was not read in this one.
        const bench = await writeBench(before);
        const c1 = bench.taskAt(1);
        bench.edit(before.slice(3));
        expect((await bench.writer.updateTaskInFile(plannedOn(c1), checked(c1))).written).toBe(false);
        expect(bench.lines()).toEqual(before.slice(3));
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('S1d: children that differ under swapped identical parents: refused, b untouched', async () => {
        const bench = await writeBench(['- [ ] p', '\t- [ ] a', '- [ ] p', '\t- [ ] b']);
        const a = bench.taskAt(1);
        bench.edit(['- [ ] p', '\t- [ ] b', '- [ ] p', '\t- [ ] a']);
        expect((await bench.writer.updateTaskInFile(plannedOn(a), checked(a))).written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] p', '\t- [ ] b', '- [ ] p', '\t- [ ] a']);
    });
});

describe('two own writes trade the texts of two rows, then an unreported change', () => {
    // S2: X and Y trade `[ ] A` and `[x] A` by our own writes, no scan in
    // between. X's copy is the index's once its write landed (`landed`).
    const traded = async (): Promise<{ bench: WriteBench; x: Task }> => {
        const bench = await writeBench(['- [ ] A', '- [x] A']);
        const x = bench.taskAt(0);
        const y = bench.taskAt(1);
        expect((await bench.writer.updateTaskInFile(plannedOn(x), checked(x))).written).toBe(true);
        expect((await bench.writer.updateTaskInFile(plannedOn(y), { ...y, statusChar: ' ' })).written).toBe(true);
        expect(bench.lines()).toEqual(['- [x] A', '- [ ] A']);
        return { bench, x: bench.taskAt(0) };
    };

    it('S2a: after the plugin\'s own frontmatter write moved the rows, a delete of X from its copy takes X', async () => {
        // Only our own write came between: its report carries X's line.
        const { bench, x } = await traded();
        await bench.repo.setFrontmatterKeys(FILE, { color: 'red' });
        const after = bench.lines();
        const row = after.indexOf('- [x] A');
        expect(row).toBeGreaterThan(0);
        expect((await bench.writer.deleteTaskFromFile(plannedOn(x, { subtree: true }))).written).toBe(true);
        expect(bench.lines()).toEqual(after.filter((_, i) => i !== row));
        expect(bench.refused).toEqual([]);
    });

    it('S2b: after a line appended from outside: refused until a scan', async () => {
        const { bench, x } = await traded();
        const edited = ['- [x] A', '- [ ] A', 'メモ'];
        bench.edit(edited);
        expect((await bench.writer.deleteTaskFromFile(plannedOn(x, { subtree: true }))).written).toBe(false);
        expect(bench.lines()).toEqual(edited);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('S2d: the same with renames (X to B, Y to A), X planned from a copy older than its rename', async () => {
        const bench = await writeBench(['- [ ] A', '- [ ] B']);
        const x = bench.taskAt(0);
        const y = bench.taskAt(1);
        await bench.writer.updateTaskInFile(plannedOn(x), { ...x, content: 'B', originalText: '- [ ] B' });
        await bench.writer.updateTaskInFile(plannedOn(y), { ...y, content: 'A', originalText: '- [ ] A' });
        expect(bench.lines()).toEqual(['- [ ] B', '- [ ] A']);
        bench.edit(['- [ ] B', '- [ ] A', 'メモ']);
        expect((await bench.writer.deleteTaskFromFile(plannedOn(x, { subtree: true }))).written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] B', '- [ ] A', 'メモ']);
    });

    it('with nothing else changed, the same writes land', async () => {
        const { bench, x } = await traded();
        expect((await bench.writer.deleteTaskFromFile(plannedOn(x, { subtree: true }))).written).toBe(true);
        expect(bench.lines()).toEqual(['- [ ] A']);
    });
});

describe('an outside line above: refused until a scan', () => {
    it('every row below it is refused, and written once a scan has read the file', async () => {
        const bench = await writeBench(['- [ ] A', '- [ ] B']);
        const a = bench.taskAt(0);
        const b = bench.taskAt(1);
        bench.edit(['メモ', '- [ ] A', '- [ ] B']);
        expect((await bench.writer.updateTaskInFile(plannedOn(a), checked(a))).written).toBe(false);
        expect((await bench.writer.updateTaskInFile(plannedOn(b), checked(b))).written).toBe(false);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed', 'changed']);

        await bench.scan();
        expect((await bench.writer.updateTaskInFile(plannedOn(bench.taskAt(1)), checked(bench.taskAt(1)))).written).toBe(true);
        expect((await bench.writer.updateTaskInFile(plannedOn(bench.taskAt(2)), checked(bench.taskAt(2)))).written).toBe(true);
        expect(bench.lines()).toEqual(['メモ', '- [x] A', '- [x] B']);
    });

    it('X1 through a scan that read before our write: the write on Y, deleted from outside, is refused', async () => {
        const bench = await writeBench(['- [ ] A', '- [ ] B', '- [ ] C']);
        const x = bench.taskAt(0);
        const y = bench.taskAt(1);
        const scan = await gatedScan(bench);
        await bench.writer.updateTaskInFile(plannedOn(x), { ...x, content: 'B', originalText: '- [ ] B' });
        scan.release();
        await scan.done;
        expect(bench.lines()).toEqual(['- [ ] B', '- [ ] B', '- [ ] C']);
        bench.edit(['- [ ] B', '- [ ] C']);
        expect((await bench.writer.updateTaskInFile(plannedOn(y), checked(y))).written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] B', '- [ ] C']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });
});

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
