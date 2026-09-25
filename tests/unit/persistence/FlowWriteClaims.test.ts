import { describe, it, expect } from 'vitest';
import { contentKeyOf } from '../../../src/services/core/ContentKey';
import { makeTask } from '../helpers/makeTask';
import { writeBench, FILE, type Filed } from '../helpers/writeBench';
import { TaskParser } from '../../../src/services/parsing/TaskParser';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import type { Task } from '../../../src/types';

/** `applyToTask` with the one op a strip-flow write makes. */
function stripFlow(task: Task) {
    return { kind: 'strip-flow' as const, text: TaskParser.format({ ...task, flow: undefined }).trim() };
}

/**
 * What the three writes a firing makes report about the lines they wrote.
 *
 * A firing writes three times — the tick, the next instance, the `==>` coming
 * off the fired line — and the last two report here. The tick is
 * `updateTaskInFile`, which reports from stage 2-4. Through the real writers
 * and the real `processLines`, so the report is the one a scan would be
 * handed, arithmetic included.
 */

const TASK = '- [ ] ポモドーロ';
const DONE = '- [x] ポモドーロ';
const FLOW = '\t- ==> every 1d';

/** The one claim a write filed. Fails loudly when a write filed none. */
function only(filed: Filed[]): Filed {
    expect(filed).toHaveLength(1);
    return filed[0];
}

describe('what a strip-flow write reports', () => {
    // The state a firing leaves behind before the third write: the next
    // instance sits above the fired line, both carrying their `==>` child.
    const fired = [TASK, FLOW, DONE, FLOW, ''];

    it('names the flow child it removed and the line it rewrote', async () => {
        const b = await writeBench(fired.join('\n'));
        const task = b.taskAt(2);
        await b.writer.applyToTask(plannedOn(task), [stripFlow(task)]);

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
        const b = await writeBench(two.join('\n'));
        const task = b.taskAt(2);
        await b.writer.applyToTask(plannedOn(task), [stripFlow(task)]);

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
    it('names the lines it inserted above the fired one', async () => {
        const b = await writeBench([DONE, FLOW, ''].join('\n'));
        const task = b.taskAt(0);
        await b.writer.applyToTask(plannedOn(task), [
            { kind: 'insert-instance', insert: { kind: 'recurrence', content: TASK, flowLines: ['every 1d'] } },
        ]);

        const claim = only(b.filed);
        expect(claim.edits).toEqual([{ kind: 'inserted', at: 0, count: 2 }]);
        expect(b.lines()).toEqual([TASK, FLOW, DONE, FLOW, '']);
    });

    it('writes and reports nothing when the task is gone from the file', async () => {
        // The next instance used to be appended at the end of the file. With
        // no line to place it by, it is not written at all.
        const b = await writeBench([DONE, FLOW, '- [ ] 別のタスク', ''].join('\n'));
        const fired = b.taskAt(0);
        b.edit(['- [ ] 別のタスク', ''].join('\n'));
        await b.writer.applyToTask(plannedOn(fired), [
            { kind: 'insert-instance', insert: { kind: 'recurrence', content: TASK, flowLines: ['every 1d'] } },
        ]);

        expect(b.filed).toEqual([]);
        expect(b.lines()).toEqual(['- [ ] 別のタスク', '']);
        expect(b.refused).toEqual([{ file: FILE, reason: { kind: 'changed' }, subject: 'ポモドーロ' }]);
    });
});

describe('what a generated instance reports', () => {
    it('names the parent, its flow line and its children as one insert', async () => {
        const b = await writeBench([DONE, FLOW, ''].join('\n'));
        const task = b.taskAt(0);
        await b.writer.applyToTask(plannedOn(task), [
            {
                kind: 'insert-instance',
                insert: {
                    kind: 'generated',
                    parentLine: TASK,
                    flowLines: ['every 1d'],
                    children: [{ depth: 1, body: '- [ ] 子' }],
                },
            },
        ]);

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

    it('reports the strip as a rewrite of that one line', async () => {
        const b = await writeBench([LIVE, FIRED, ''].join('\n'));
        const task = b.taskAt(1);
        await b.writer.applyToTask(plannedOn(task), [stripFlow(task)]);

        expect(only(b.filed).edits).toEqual([{ kind: 'replaced', at: 1 }]);
        expect(b.lines()).toEqual([LIVE, DONE, '']);
    });

    it('reports the next instance as one inserted line', async () => {
        const b = await writeBench([FIRED, ''].join('\n'));
        const task = b.taskAt(0);
        await b.writer.applyToTask(plannedOn(task), [
            { kind: 'insert-instance', insert: { kind: 'recurrence', content: LIVE, flowLines: [] } },
        ]);

        expect(only(b.filed).edits).toEqual([{ kind: 'inserted', at: 0, count: 1 }]);
        expect(b.lines()).toEqual([LIVE, FIRED, '']);
    });
});

describe('the wiring', () => {
    // The observer reaches `InlineTaskWriter` for the first time in this
    // change, and it is handed over in exactly one place. Everything the
    // writes stage adds later depends on that one line still being there.
    it('carries a strip through the repository to whoever is listening', async () => {
        // The bench connects the repository's own observer, not the one its
        // `writer` and `cloner` are built with.
        const b = await writeBench(['- [x] ポモドーロ ==> every 1d', ''].join('\n'));
        const task = b.taskAt(0);

        await b.repo.applyToTask(plannedOn(task), [stripFlow(task)]);

        expect(b.filed.map(claim => claim.edits)).toEqual([[{ kind: 'replaced', at: 0 }]]);
        expect(b.lines()).toEqual([DONE, '']);
    });
});

describe('what an update reports', () => {
    // Every fixture below is the writer's own output: `TaskParser.format` is
    // what `updateTaskInFile` puts on the line, so a file built any other way
    // would pin a shape the writer never produces (#202).
    const bare = (statusChar: string) =>
        TaskParser.format(makeTask({ content: 'ポモドーロ', statusChar }));
    const checked = (task: Task): Task => ({ ...task, statusChar: 'x' });

    it('is the writer that decides what TASK and DONE read', () => {
        // The constants the rest of this file and the scanner's tests are
        // built from, tied to the formatter rather than to a guess at it.
        expect(bare(' ')).toBe(TASK);
        expect(bare('x')).toBe(DONE);
    });

    it('names the task line it rewrote, and nothing else', async () => {
        const b = await writeBench([TASK, ''].join('\n'));
        await b.writer.updateTaskInFile(plannedOn(b.taskAt(0)), checked(b.taskAt(0)));

        expect(only(b.filed).edits).toEqual([{ kind: 'replaced', at: 0 }]);
        expect(b.lines()).toEqual([DONE, '']);
    });

    it('says nothing when the line could not be found', async () => {
        // Nothing was written, so a claim here would be weighed against a file
        // that never changed.
        const b = await writeBench([TASK, '- [ ] 別のタスク', ''].join('\n'));
        const task = b.taskAt(0);
        b.edit(['- [ ] 別のタスク', ''].join('\n'));
        const written = (await b.writer.updateTaskInFile(plannedOn(task), checked(task))).written;

        expect(written).toBe(false);
        expect(b.filed).toEqual([]);
        expect(b.lines()).toEqual(['- [ ] 別のタスク', '']);
        expect(b.refused).toEqual([{ file: FILE, reason: { kind: 'changed' }, subject: 'ポモドーロ' }]);
    });

    describe('with child property ops', () => {
        const CHILD = '\t- 金額:: 100';

        it('names the child line it rewrote as a rewrite', async () => {
            const b = await writeBench([TASK, CHILD, ''].join('\n'));
            await b.writer.updateTaskInFile(plannedOn(b.taskAt(0)), checked(b.taskAt(0)), [
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
            const b = await writeBench([TASK, ''].join('\n'));
            await b.writer.updateTaskInFile(plannedOn(b.taskAt(0)), checked(b.taskAt(0)), [
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
            const b = await writeBench([TASK, CHILD, '\t- 金額:: 300', ''].join('\n'));
            await b.writer.updateTaskInFile(plannedOn(b.taskAt(0)), checked(b.taskAt(0)), [
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
            const b = await writeBench(fenced.join('\n'));
            await b.writer.updateTaskInFile(plannedOn(b.taskAt(0)), checked(b.taskAt(0)), [
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
        it('names the row it was asked about, not the first row that matches', async () => {
            const b = await writeBench([TASK, TASK, ''].join('\n'));
            await b.writer.updateTaskInFile(plannedOn(b.taskAt(1)), checked(b.taskAt(1)));

            // The file is the one the scan read, so the row stands where the
            // scan recorded it.
            expect(only(b.filed).edits).toEqual([{ kind: 'replaced', at: 1 }]);
            expect(b.lines()).toEqual([TASK, DONE, '']);
        });

        it('writes neither twin once the line it was read on reads otherwise', async () => {
            // The task was read below another row, and something else has since
            // moved it up beside its twin. The line it was read on now reads the
            // other row, and nothing looks for it by its text: refused.
            const b = await writeBench([TASK, '- [ ] 別のタスク', TASK, ''].join('\n'));
            const task = b.taskAt(2);
            b.edit([TASK, TASK, '- [ ] 別のタスク', ''].join('\n'));
            const written = (await b.writer.updateTaskInFile(plannedOn(task), checked(task))).written;

            expect(written).toBe(false);
            expect(b.filed).toEqual([]);
            expect(b.lines()).toEqual([TASK, TASK, '- [ ] 別のタスク', '']);
            expect(b.refused).toEqual([{ file: FILE, reason: { kind: 'changed' }, subject: 'ポモドーロ' }]);
        });
    });
});

describe('what the editor menu\'s line edit reports', () => {
    // `applyToLine` takes a path and a line number rather than a task: it is
    // the editor's own right-click menu (TaskMenuExtension.ts:122), where a
    // status change and the conversion of a bare checkbox both come through.
    it('names the line it rewrote', async () => {
        const b = await writeBench([TASK, ''].join('\n'));
        await b.writer.applyToLine(FILE, { line: 0, text: TASK, key: contentKeyOf([TASK, '']) }, [{ kind: 'update', text: DONE }]);

        expect(only(b.filed).edits).toEqual([{ kind: 'replaced', at: 0 }]);
        expect(b.lines()).toEqual([DONE, '']);
    });

    it('names the twin the editor pointed at, not the first one', async () => {
        // Here the line number is the editor's own, so there is no ambiguity
        // to resolve — and the claim carries that certainty to the scan.
        const b = await writeBench([TASK, TASK, ''].join('\n'));
        await b.writer.applyToLine(FILE, { line: 1, text: TASK, key: contentKeyOf([TASK, TASK, '']) }, [{ kind: 'update', text: DONE }]);

        expect(only(b.filed).edits).toEqual([{ kind: 'replaced', at: 1 }]);
        expect(b.lines()).toEqual([TASK, DONE, '']);
    });

    it('says nothing when the line is past the end of the file', async () => {
        const b = await writeBench([TASK, ''].join('\n'));
        await b.writer.applyToLine(FILE, { line: 9, text: TASK, key: contentKeyOf([TASK, '']) }, [{ kind: 'update', text: DONE }]);

        expect(b.filed).toEqual([]);
        expect(b.lines()).toEqual([TASK, '']);
        expect(b.refused).toEqual([{ file: FILE, reason: { kind: 'changed' }, subject: TASK }]);
    });

    it('says nothing when the line no longer reads what the editor showed', async () => {
        const b = await writeBench([TASK, ''].join('\n'));
        await b.writer.applyToLine(FILE, { line: 0, text: '- [ ] 別のタスク', key: contentKeyOf([TASK, '']) }, [{ kind: 'update', text: DONE }]);

        expect(b.filed).toEqual([]);
        expect(b.lines()).toEqual([TASK, '']);
        expect(b.refused).toEqual([{ file: FILE, reason: { kind: 'changed' }, subject: '- [ ] 別のタスク' }]);
    });
});

describe('the two writes that make twins trade texts', () => {
    // The sequence the scanner's tests are built on, driven through the real
    // writer so that the lines and the reports both come from the thing that
    // writes them. Hand-built rows are how #202 nearly pinned a shape the
    // writer never produces.
    it('writes and reports exactly what the scanner tests replay', async () => {
        const b = await writeBench([TASK, DONE, ''].join('\n'));
        const [open, done] = [b.taskAt(0), b.taskAt(1)];

        // W1 checks the open row. The file is the one the scan read, so the
        // write lands on the upper row.
        await b.writer.updateTaskInFile(plannedOn(open), { ...open, statusChar: 'x' });
        expect(b.lines()).toEqual([DONE, DONE, '']);
        expect(only(b.filed).edits).toEqual([{ kind: 'replaced', at: 0 }]);
        b.filed.pop();

        // W2 unchecks the done row, with no scan between: the lines are the
        // ones W1 left, and W1's report says which twin is which. The file
        // comes back to the two texts it started with — in the other order.
        await b.writer.updateTaskInFile(plannedOn(done), { ...done, statusChar: ' ' });
        expect(b.lines()).toEqual([DONE, TASK, '']);
        expect(only(b.filed).edits).toEqual([{ kind: 'replaced', at: 1 }]);
    });
});
