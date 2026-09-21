import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { InlineTaskWriter } from '../../../src/services/persistence/writers/InlineTaskWriter';
import { WriteObserver } from '../../../src/services/persistence/WriteObserver';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { makeTask } from '../helpers/makeTask';
import type { LineEdit } from '../../../src/utils/FileLines';

/**
 * What the two deleting writes report about the lines they removed.
 *
 * A delete is the one write that cannot describe itself wrongly by accident:
 * it files what the splice actually took out, and `processLines` refuses a
 * report that does not account for the file it produced. So these tests are
 * about the two things the arithmetic cannot settle — how far a subtree
 * reaches, and which deletes are supposed to stay quiet.
 */

const FILE = 'note.md';

interface Filed {
    before: string[];
    after: string[];
    edits: LineEdit[];
}

function bench(lines: string[]) {
    let content = lines.join('\n');
    const file = new TFile();
    file.path = FILE;
    const app = {
        vault: {
            getAbstractFileByPath: (path: string) => (path === FILE ? file : null),
            process: async (_f: TFile, fn: (data: string) => string) => { content = fn(content); },
        },
    } as any;

    const filed: Filed[] = [];
    const writes = new WriteObserver();
    writes.connect(() => (before, after, edits) => {
        filed.push({ before: [...before], after: [...after], edits: [...edits] });
        return () => { filed.pop(); };
    });

    return {
        writer: new InlineTaskWriter(app, new FileOperations(app), writes),
        filed,
        lines: () => content.split('\n'),
    };
}

/** The one claim a write filed. Fails loudly when a write filed none. */
function only(filed: Filed[]): Filed {
    expect(filed).toHaveLength(1);
    return filed[0];
}

describe('what deleteTaskFromFile reports', () => {
    const parent = '- [ ] 親 @2026-09-21';

    it('says the task line and its children went, as one removal', async () => {
        const b = bench([
            '# note',
            parent,
            '\t- [ ] 子1',
            '\t- [ ] 子2',
            '- [ ] 次の親 @2026-09-21',
        ]);

        const removed = await b.writer.deleteTaskFromFile(makeTask({
            file: FILE, line: 1, content: '親', originalText: parent, startDate: '2026-09-21',
        }));

        expect(removed).toBe(true);
        expect(only(b.filed).edits).toEqual([{ kind: 'removed', at: 1, count: 3 }]);
        expect(b.lines()).toEqual(['# note', '- [ ] 次の親 @2026-09-21']);
    });

    it('counts what the splice took, not what the subtree looked like', async () => {
        // The subtree stops at the blank line, so the blank and the task after
        // it stay. A claim that counted to the end of the indented run would
        // say four and be refused by `explains`; this one says two because two
        // lines left the array.
        const b = bench([
            parent,
            '\t- [ ] 子1',
            '',
            '\t- [ ] 別の塊の行',
        ]);

        await b.writer.deleteTaskFromFile(makeTask({
            file: FILE, line: 0, content: '親', originalText: parent, startDate: '2026-09-21',
        }));

        expect(only(b.filed).edits).toEqual([{ kind: 'removed', at: 0, count: 2 }]);
        expect(b.lines()).toEqual(['', '\t- [ ] 別の塊の行']);
    });

    it('files nothing when the line cannot be resolved', async () => {
        const b = bench(['# note', '- [ ] 別のタスク @2026-09-21']);

        const removed = await b.writer.deleteTaskFromFile(makeTask({
            file: FILE, line: 1, content: '親', originalText: parent, startDate: '2026-09-21',
        }));

        expect(removed).toBe(false);
        expect(b.filed).toEqual([]);
    });
});

describe('the origin half of a move stays quiet', () => {
    const moving = '- [ ] 移動する @2026-09-21';

    it('files nothing when the lines were written to another file', async () => {
        const b = bench(['# note', moving, '\t- [ ] 子']);

        const removed = await b.writer.deleteTaskFromFile(makeTask({
            file: FILE, line: 1, content: '移動する', originalText: moving, startDate: '2026-09-21',
        }), { to: 'archive/2026-09.md' });

        expect(removed).toBe(true);
        expect(b.lines()).toEqual(['# note']);
        expect(b.filed).toEqual([]);
    });

    it('files nothing when the destination is this same file', async () => {
        // The reason the whole half is silent. `archive-to` has already written
        // the task further down this file, so those rows are alive; a `removed`
        // here would be a claim that they are not, and the next scan would mint
        // a new ID for a row the ladder could have carried.
        const b = bench(['# note', moving, '## archive', moving]);

        await b.writer.deleteTaskFromFile(makeTask({
            file: FILE, line: 1, content: '移動する', originalText: moving, startDate: '2026-09-21',
        }), { to: FILE });

        expect(b.filed).toEqual([]);
    });
});

describe('what deleteLine reports', () => {
    it('says one line went, and leaves the children where they are', async () => {
        const b = bench([
            '- [ ] 親 @2026-09-21',
            '\t- [ ] 子 @2026-09-21',
            '- [ ] 次 @2026-09-21',
        ]);

        await b.writer.deleteLine(FILE, 0);

        expect(only(b.filed).edits).toEqual([{ kind: 'removed', at: 0, count: 1 }]);
        expect(b.lines()).toEqual(['\t- [ ] 子 @2026-09-21', '- [ ] 次 @2026-09-21']);
    });

    it('reports a line that is not a task at all', async () => {
        // The editor's menu reaches this with a raw checkbox, and the rows
        // around it may be anything. The claim is about a row of text, so it
        // holds for frontmatter, prose, a blank and a fenced sample alike —
        // including the sample, which no task ever lived on.
        const note = ['---', 'tags: a', '---', 'ただの文', '', '```', '- [ ] 見本', '```'];

        for (const at of [1, 3, 4, 6]) {
            const b = bench(note);

            await b.writer.deleteLine(FILE, at);

            expect(only(b.filed).edits).toEqual([{ kind: 'removed', at, count: 1 }]);
            expect(b.lines()).toEqual(note.filter((_, i) => i !== at));
        }
    });

    it('files nothing when the coordinate is past the end', async () => {
        const b = bench(['- [ ] 親 @2026-09-21']);

        await b.writer.deleteLine(FILE, 5);

        expect(b.filed).toEqual([]);
        expect(b.lines()).toEqual(['- [ ] 親 @2026-09-21']);
    });
});
