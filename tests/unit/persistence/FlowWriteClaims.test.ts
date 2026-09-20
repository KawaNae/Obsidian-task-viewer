import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { TaskCloner } from '../../../src/services/persistence/TaskCloner';
import { InlineTaskWriter } from '../../../src/services/persistence/writers/InlineTaskWriter';
import { WriteObserver } from '../../../src/services/persistence/WriteObserver';
import { TaskRepository } from '../../../src/services/persistence/TaskRepository';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { makeTask } from '../helpers/makeTask';
import { TaskParser } from '../../../src/services/parsing/TaskParser';
import type { Task } from '../../../src/types';
import type { LineEdit } from '../../../src/utils/FileLines';

/**
 * What the three writes a firing makes report about the lines they wrote.
 *
 * A firing writes three times — the tick, the next instance, the `==>` coming
 * off the fired line — and the last two report here. The tick is
 * `updateTaskInFile`, which reports from stage 2-4. Through the real writers
 * and the real `processLines`, so the report is the one a scan would be
 * handed, arithmetic included.
 */

const FILE = 'note.md';
const TASK = '- [ ] ポモドーロ';
const DONE = '- [x] ポモドーロ';
const FLOW = '\t- ==> every 1d';

interface Filed {
    before: string[];
    after: string[];
    edits: LineEdit[];
}

function bench(text: string) {
    let content = text;
    const file = new TFile();
    file.path = FILE;
    const app = {
        vault: {
            getAbstractFileByPath: () => file,
            process: async (_f: TFile, fn: (data: string) => string) => { content = fn(content); },
        },
    } as any;

    const filed: Filed[] = [];
    const writes = new WriteObserver();
    writes.connect(() => (before, after, edits) => {
        filed.push({ before: [...before], after: [...after], edits: [...edits] });
        return () => { filed.pop(); };
    });

    const fileOps = new FileOperations(app);
    return {
        cloner: new TaskCloner(app, fileOps, writes),
        writer: new InlineTaskWriter(app, fileOps, writes),
        filed,
        lines: () => content.split('\n'),
    };
}

/** The one claim a write filed. Fails loudly when a write filed none. */
function only(filed: Filed[]): Filed {
    expect(filed).toHaveLength(1);
    return filed[0];
}

describe('what stripFlow reports', () => {
    // The state a firing leaves behind before the third write: the next
    // instance sits above the fired line, both carrying their `==>` child.
    const fired = [TASK, FLOW, DONE, FLOW, ''];

    const task = () => makeTask({
        file: FILE,
        line: 2,
        content: 'ポモドーロ',
        statusChar: 'x',
        originalText: DONE,
    });

    it('names the flow child it removed and the line it rewrote', async () => {
        const b = bench(fired.join('\n'));
        await b.writer.stripFlow(task());

        const claim = only(b.filed);
        expect(claim.edits).toEqual([
            { kind: 'removed', at: 3, count: 1 },
            { kind: 'replaced', at: 2 },
        ]);

        // The fired line is the one that was rewritten, and it is still where
        // the report says it is: every flow child sits below the task line, so
        // removing them cannot move it.
        expect(b.lines()).toEqual([TASK, FLOW, DONE, '']);
        expect(claim.after[2]).toBe(DONE);
        expect(claim.before[3]).toBe(FLOW);
    });

    it('names each of several flow children where it stood', async () => {
        // Removing from the bottom up is what makes each index the one the
        // line had: taking the top one first would shift the rest, and the
        // second report would name a line one above the one that went.
        const two = [TASK, FLOW, DONE, FLOW, '\t- ==> until 2026-12-31', ''];
        const b = bench(two.join('\n'));
        await b.writer.stripFlow(task());

        const claim = only(b.filed);
        expect(claim.edits).toEqual([
            { kind: 'removed', at: 4, count: 1 },
            { kind: 'removed', at: 3, count: 1 },
            { kind: 'replaced', at: 2 },
        ]);
        for (const edit of claim.edits) {
            if (edit.kind === 'removed') expect(claim.before[edit.at]).toContain('==>');
        }
    });
});

describe('what the next instance reports', () => {
    const task = () => makeTask({
        file: FILE,
        line: 0,
        content: 'ポモドーロ',
        statusChar: 'x',
        originalText: DONE,
    });

    it('names the lines it inserted above the fired one', async () => {
        const b = bench([DONE, FLOW, ''].join('\n'));
        await b.cloner.insertRecurrenceForTask(task(), TASK, ['every 1d']);

        const claim = only(b.filed);
        expect(claim.edits).toEqual([{ kind: 'inserted', at: 0, count: 2 }]);
        expect(b.lines()).toEqual([TASK, FLOW, DONE, FLOW, '']);
    });

    it('names the append when the task is gone from the file', async () => {
        const b = bench(['- [ ] 別のタスク', ''].join('\n'));
        await b.cloner.insertRecurrenceForTask(task(), TASK, ['every 1d']);

        const claim = only(b.filed);
        // appendLines replaces the trailing blank rather than writing past it.
        expect(claim.edits).toEqual([
            { kind: 'removed', at: 1, count: 1 },
            { kind: 'inserted', at: 1, count: 2 },
        ]);
        expect(b.lines()).toEqual(['- [ ] 別のタスク', TASK, FLOW]);
    });
});

describe('what a generated instance reports', () => {
    it('names the parent, its flow line and its children as one insert', async () => {
        const b = bench([DONE, FLOW, ''].join('\n'));
        await b.cloner.insertGeneratedInstance(
            makeTask({ file: FILE, line: 0, content: 'ポモドーロ', statusChar: 'x', originalText: DONE }),
            TASK,
            ['every 1d'],
            [{ depth: 1, body: '- [ ] 子' }],
        );

        const claim = only(b.filed);
        expect(claim.edits).toEqual([{ kind: 'inserted', at: 0, count: 3 }]);
        expect(b.lines()).toEqual([TASK, FLOW, '\t- [ ] 子', DONE, FLOW, '']);
    });
});

describe('when the flow is written on the task line itself', () => {
    // The form the field measurement used, and the one where the strip
    // actually changes a row: the `==>` is part of the task line, so removing
    // it rewrites the text the next scan reads.
    const LIVE = '- [ ] ポモドーロ ==> every 1d';
    const FIRED = '- [x] ポモドーロ ==> every 1d';

    const task = (line: number) => makeTask({
        file: FILE,
        line,
        content: 'ポモドーロ',
        statusChar: 'x',
        originalText: FIRED,
    });

    it('reports the strip as a rewrite of that one line', async () => {
        const b = bench([LIVE, FIRED, ''].join('\n'));
        await b.writer.stripFlow(task(1));

        expect(only(b.filed).edits).toEqual([{ kind: 'replaced', at: 1 }]);
        expect(b.lines()).toEqual([LIVE, DONE, '']);
    });

    it('reports the next instance as one inserted line', async () => {
        const b = bench([FIRED, ''].join('\n'));
        await b.cloner.insertRecurrenceForTask(task(0), LIVE, []);

        expect(only(b.filed).edits).toEqual([{ kind: 'inserted', at: 0, count: 1 }]);
        expect(b.lines()).toEqual([LIVE, FIRED, '']);
    });
});

describe('the wiring', () => {
    // The observer reaches `InlineTaskWriter` for the first time in this
    // change, and it is handed over in exactly one place. Everything the
    // writes stage adds later depends on that one line still being there.
    it('carries a strip through the repository to whoever is listening', async () => {
        let content = ['- [x] ポモドーロ ==> every 1d', ''].join('\n');
        const file = new TFile();
        file.path = FILE;
        const app = {
            vault: {
                getAbstractFileByPath: () => file,
                process: async (_f: TFile, fn: (data: string) => string) => { content = fn(content); },
            },
        } as any;

        const repo = new TaskRepository(app);
        const filed: LineEdit[][] = [];
        repo.getWriteObserver().connect(() => (_before, _after, edits) => {
            filed.push([...edits]);
            return () => { filed.pop(); };
        });

        await repo.stripFlow(makeTask({
            file: FILE,
            line: 0,
            content: 'ポモドーロ',
            statusChar: 'x',
            originalText: '- [x] ポモドーロ ==> every 1d',
        }));

        expect(filed).toEqual([[{ kind: 'replaced', at: 0 }]]);
        expect(content.split('\n')).toEqual([DONE, '']);
    });
});

describe('what an update reports', () => {
    // Every fixture below is the writer's own output: `TaskParser.format` is
    // what `updateTaskInFile` puts on the line, so a file built any other way
    // would pin a shape the writer never produces (#202).
    const bare = (statusChar: string) =>
        TaskParser.format(makeTask({ content: 'ポモドーロ', statusChar }));

    const task = (over: Partial<Task> = {}) => makeTask({
        file: FILE,
        line: 0,
        content: 'ポモドーロ',
        statusChar: ' ',
        originalText: bare(' '),
        ...over,
    });

    it('is the writer that decides what TASK and DONE read', () => {
        // The constants the rest of this file and the scanner's tests are
        // built from, tied to the formatter rather than to a guess at it.
        expect(bare(' ')).toBe(TASK);
        expect(bare('x')).toBe(DONE);
    });

    it('names the task line it rewrote, and nothing else', async () => {
        const b = bench([TASK, ''].join('\n'));
        await b.writer.updateTaskInFile(task(), task({ statusChar: 'x' }));

        expect(only(b.filed).edits).toEqual([{ kind: 'replaced', at: 0 }]);
        expect(b.lines()).toEqual([DONE, '']);
    });

    it('says nothing when the line could not be found', async () => {
        // Nothing was written, so a claim here would be weighed against a file
        // that never changed.
        const b = bench(['- [ ] 別のタスク', ''].join('\n'));
        await b.writer.updateTaskInFile(task(), task({ statusChar: 'x' }));

        expect(b.filed).toEqual([]);
        expect(b.lines()).toEqual(['- [ ] 別のタスク', '']);
    });

    describe('with child property ops', () => {
        const CHILD = '\t- 金額:: 100';

        it('names the child line it rewrote as a rewrite', async () => {
            const b = bench([TASK, CHILD, ''].join('\n'));
            await b.writer.updateTaskInFile(task(), task({ statusChar: 'x' }), [
                { key: '金額', op: 'set', value: '200' },
            ]);

            // The task line first, then the child: `applyOps` only ever
            // touches lines below the task line, so the first report's
            // coordinate survives the second.
            expect(only(b.filed).edits).toEqual([
                { kind: 'replaced', at: 0 },
                { kind: 'replaced', at: 1 },
            ]);
            expect(b.lines()).toEqual([DONE, '\t- 金額:: 200', '']);
        });

        it('names a child line it added as an insert', async () => {
            const b = bench([TASK, ''].join('\n'));
            await b.writer.updateTaskInFile(task(), task({ statusChar: 'x' }), [
                { key: '金額', op: 'set', value: '200' },
            ]);

            expect(only(b.filed).edits).toEqual([
                { kind: 'replaced', at: 0 },
                { kind: 'inserted', at: 1, count: 1 },
            ]);
            expect(b.lines()).toEqual([DONE, '\t- 金額:: 200', '']);
        });

        it('names each removed declaration where it stood', async () => {
            // Two declarations of one key, removed from the bottom up so each
            // index is the one that line had — the same arithmetic stripFlow
            // relies on.
            const b = bench([TASK, CHILD, '\t- 金額:: 300', ''].join('\n'));
            await b.writer.updateTaskInFile(task(), task({ statusChar: 'x' }), [
                { key: '金額', op: 'delete' },
            ]);

            expect(only(b.filed).edits).toEqual([
                { kind: 'replaced', at: 0 },
                { kind: 'removed', at: 2, count: 1 },
                { kind: 'removed', at: 1, count: 1 },
            ]);
            expect(b.lines()).toEqual([DONE, '']);
        });

        it('leaves a declaration inside a fence out of the report', async () => {
            // A `- key:: value` in a code block is a sample, not a property.
            // `findOwnPropertyLines` skips it, so the write must not claim it
            // either — and must not touch it.
            const fenced = [TASK, CHILD, '\t```', '\t- 金額:: 999', '\t```', ''];
            const b = bench(fenced.join('\n'));
            await b.writer.updateTaskInFile(task(), task({ statusChar: 'x' }), [
                { key: '金額', op: 'set', value: '200' },
            ]);

            expect(only(b.filed).edits).toEqual([
                { kind: 'replaced', at: 0 },
                { kind: 'replaced', at: 1 },
            ]);
            expect(b.lines()[3]).toBe('\t- 金額:: 999');
        });
    });

    describe('on twins', () => {
        // Two rows reading exactly the same thing. This is the shape the whole
        // mechanism exists for, and `updateTaskInFile` now runs into it on
        // every ordinary edit rather than only on a firing.
        it('names the stored line, not the first row that matches', async () => {
            const b = bench([TASK, TASK, ''].join('\n'));
            await b.writer.updateTaskInFile(
                task({ line: 1 }),
                task({ line: 1, statusChar: 'x' }),
            );

            // Strategy 0 (the stored line, verified against originalText) runs
            // before the first-match scan for exactly this reason
            // (FileOperations.ts:309-310).
            expect(only(b.filed).edits).toEqual([{ kind: 'replaced', at: 1 }]);
            expect(b.lines()).toEqual([TASK, DONE, '']);
        });

        it('reports the row it really wrote when the stored line has shifted', async () => {
            // The one case that can land on the wrong twin: the stored line no
            // longer holds the task, and the fallback takes the first row with
            // the same text. That is a `findTaskLineNumber` limitation, not
            // one this claim introduces — and the claim still describes what
            // happened to the file, so the two rows keep their identities
            // instead of the ladder swapping them on top of the misplaced
            // write.
            const b = bench([TASK, TASK, '- [ ] 別のタスク', ''].join('\n'));
            await b.writer.updateTaskInFile(
                task({ line: 2 }),
                task({ line: 2, statusChar: 'x' }),
            );

            expect(only(b.filed).edits).toEqual([{ kind: 'replaced', at: 0 }]);
            expect(b.lines()).toEqual([DONE, TASK, '- [ ] 別のタスク', '']);
        });
    });
});

describe('what the editor menu\'s line edit reports', () => {
    // `updateLine` takes a path and a line number rather than a task: it is
    // the editor's own right-click menu (TaskMenuExtension.ts:122), where a
    // status change and the conversion of a bare checkbox both come through.
    it('names the line it rewrote', async () => {
        const b = bench([TASK, ''].join('\n'));
        await b.writer.updateLine(FILE, 0, DONE);

        expect(only(b.filed).edits).toEqual([{ kind: 'replaced', at: 0 }]);
        expect(b.lines()).toEqual([DONE, '']);
    });

    it('names the twin the editor pointed at, not the first one', async () => {
        // Here the line number is the editor's own, so there is no ambiguity
        // to resolve — and the claim carries that certainty to the scan.
        const b = bench([TASK, TASK, ''].join('\n'));
        await b.writer.updateLine(FILE, 1, DONE);

        expect(only(b.filed).edits).toEqual([{ kind: 'replaced', at: 1 }]);
        expect(b.lines()).toEqual([TASK, DONE, '']);
    });

    it('says nothing when the line is past the end of the file', async () => {
        const b = bench([TASK, ''].join('\n'));
        await b.writer.updateLine(FILE, 9, DONE);

        expect(b.filed).toEqual([]);
        expect(b.lines()).toEqual([TASK, '']);
    });
});

describe('the two writes that make twins trade texts', () => {
    // The sequence the scanner's tests are built on, driven through the real
    // writer so that the lines and the reports both come from the thing that
    // writes them. Hand-built rows are how #202 nearly pinned a shape the
    // writer never produces.
    const task = (line: number, statusChar: string) => makeTask({
        file: FILE,
        line,
        content: 'ポモドーロ',
        statusChar,
        originalText: statusChar === 'x' ? DONE : TASK,
    });

    it('writes and reports exactly what the scanner tests replay', async () => {
        const b = bench([TASK, DONE, ''].join('\n'));

        // W1 checks the open row. The stored line still holds it, so the
        // write lands on the upper twin rather than on the first text match.
        await b.writer.updateTaskInFile(task(0, ' '), task(0, 'x'));
        expect(b.lines()).toEqual([DONE, DONE, '']);
        expect(only(b.filed).edits).toEqual([{ kind: 'replaced', at: 0 }]);
        b.filed.pop();

        // W2 unchecks the done row, and the file comes back to the two texts
        // it started with — in the other order.
        await b.writer.updateTaskInFile(task(1, 'x'), task(1, ' '));
        expect(b.lines()).toEqual([DONE, TASK, '']);
        expect(only(b.filed).edits).toEqual([{ kind: 'replaced', at: 1 }]);
    });
});
