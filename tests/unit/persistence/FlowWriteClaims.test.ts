import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { TaskCloner } from '../../../src/services/persistence/TaskCloner';
import { InlineTaskWriter } from '../../../src/services/persistence/writers/InlineTaskWriter';
import { WriteObserver } from '../../../src/services/persistence/WriteObserver';
import { TaskRepository } from '../../../src/services/persistence/TaskRepository';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { makeTask } from '../helpers/makeTask';
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
