import { describe, it, expect } from 'vitest';
import { contentKeyOf } from '../../../src/services/core/ContentKey';
import { writeBench, FILE, type Filed } from '../helpers/writeBench';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';

/**
 * What the two deleting writes report about the lines they removed.
 *
 * A delete is the one write that cannot describe itself wrongly by accident:
 * it files what the splice actually took out, and `processLines` refuses a
 * report that does not account for the file it produced. So these tests are
 * about the one thing the arithmetic cannot settle — how far a subtree
 * reaches — and about a move's origin, which says what it did like any other.
 */

/** The one claim a write filed. Fails loudly when a write filed none. */
function only(filed: Filed[]): Filed {
    expect(filed).toHaveLength(1);
    return filed[0];
}

describe('what deleteTaskFromFile reports', () => {
    const parent = '- [ ] 親 @2026-09-21';

    it('says the task line and its children went, as one removal', async () => {
        const b = await writeBench([
            '# note',
            parent,
            '\t- [ ] 子1',
            '\t- [ ] 子2',
            '- [ ] 次の親 @2026-09-21',
        ]);

        const removed = await b.writer.deleteTaskFromFile(plannedOn(b.taskAt(1), { subtree: true }));

        expect(removed.written).toBe(true);
        expect(only(b.filed).edits).toEqual([{ kind: 'removed', at: 1, count: 3 }]);
        expect(b.lines()).toEqual(['# note', '- [ ] 次の親 @2026-09-21']);
    });

    it('counts what the splice took, not what the subtree looked like', async () => {
        // The subtree goes on past the blank line inside it and stops before
        // the blank line after it, which stays with the task that follows. A
        // claim that counted to the next task would say five and be refused by
        // `explains`; this one says four because four lines left the array.
        const b = await writeBench([
            parent,
            '\t- [ ] 子1',
            '',
            '\t- [ ] 空行の下の子',
            '',
            '- [ ] 次のタスク',
        ]);

        await b.writer.deleteTaskFromFile(plannedOn(b.taskAt(0), { subtree: true }));

        expect(only(b.filed).edits).toEqual([{ kind: 'removed', at: 0, count: 4 }]);
        expect(b.lines()).toEqual(['', '- [ ] 次のタスク']);
    });

    it('files nothing when the line cannot be resolved', async () => {
        // The task was read, then taken out of the file by something else.
        const b = await writeBench(['# note', parent, '- [ ] 別のタスク @2026-09-21']);
        const task = b.taskAt(1);
        b.edit(['# note', '- [ ] 別のタスク @2026-09-21']);

        const removed = await b.writer.deleteTaskFromFile(plannedOn(task, { subtree: true }));

        expect(removed.written).toBe(false);
        expect(b.filed).toEqual([]);
        expect(b.lines()).toEqual(['# note', '- [ ] 別のタスク @2026-09-21']);
        expect(b.refused).toEqual([{ file: FILE, reason: { kind: 'changed' }, subject: '親' }]);
    });
});

describe('the origin half of a move says what it did', () => {
    const moving = '- [ ] 移動する @2026-09-21';

    it('says the lines went, when they were written to another file', async () => {
        // Before F3 this half stayed quiet, so that a move within one file
        // would not call its living rows dead. That move is now one write that
        // carries them, and across files "gone" is true: the row in the other
        // file is another row, as the ladder would also say.
        const b = await writeBench(['# note', moving, '\t- [ ] 子']);

        const outcome = await b.writer.applyToTask(plannedOn(b.taskAt(1)), [{ kind: 'remove' }]);

        expect(outcome.written).toBe(true);
        expect(b.lines()).toEqual(['# note']);
        expect(only(b.filed).edits).toEqual([{ kind: 'removed', at: 1, count: 2 }]);
    });

    it('says the lines were carried, when the destination is this same file', async () => {
        const b = await writeBench(['# note', moving, '## archive', '']);

        await b.writer.applyToTask(plannedOn(b.taskAt(1)), [{ kind: 'move-to-end', text: '- [x] 移動する @2026-09-21' }]);

        expect(b.lines()).toEqual(['# note', '## archive', '- [x] 移動する @2026-09-21', '']);
        expect(only(b.filed).edits.map(edit => edit.kind)).toEqual(['carried', 'replaced', 'removed']);
    });
});

describe('what the editor menu delete reports (applyToLine, remove)', () => {
    it('says the line and its subtree went, as a card\'s delete does (P1)', async () => {
        const b = await writeBench([
            '- [ ] 親 @2026-09-21',
            '\t- [ ] 子 @2026-09-21',
            '- [ ] 次 @2026-09-21',
        ]);

        await b.writer.applyToLine(FILE, { line: 0, text: b.lines()[0], subtree: b.lines().slice(0, 2), key: contentKeyOf(b.lines()) }, [{ kind: 'remove' }]);

        expect(only(b.filed).edits).toEqual([{ kind: 'removed', at: 0, count: 2 }]);
        expect(b.lines()).toEqual(['- [ ] 次 @2026-09-21']);
    });

    it('reports a line that is not a task at all', async () => {
        // The editor's menu reaches this with a raw checkbox, and the rows
        // around it may be anything. The claim is about a row of text, so it
        // holds for frontmatter, prose, a blank and a fenced sample alike —
        // including the sample, which no task ever lived on.
        const note = ['---', 'tags: a', '---', 'ただの文', '', '```', '- [ ] 見本', '```'];

        for (const at of [1, 3, 4, 6]) {
            const b = await writeBench(note);

            await b.writer.applyToLine(FILE, { line: at, text: note[at], subtree: [note[at]], key: contentKeyOf(note) }, [{ kind: 'remove' }]);

            expect(only(b.filed).edits).toEqual([{ kind: 'removed', at, count: 1 }]);
            expect(b.lines()).toEqual(note.filter((_, i) => i !== at));
        }
    });

    it('files nothing when the coordinate is past the end', async () => {
        const b = await writeBench(['- [ ] 親 @2026-09-21']);

        await b.writer.applyToLine(FILE, { line: 5, text: '- [ ] 親 @2026-09-21', subtree: ['- [ ] 親 @2026-09-21'], key: contentKeyOf(b.lines()) }, [{ kind: 'remove' }]);

        expect(b.filed).toEqual([]);
        expect(b.refused).toEqual([{ file: FILE, reason: { kind: 'changed' }, subject: '- [ ] 親 @2026-09-21' }]);
        expect(b.lines()).toEqual(['- [ ] 親 @2026-09-21']);
    });
});
