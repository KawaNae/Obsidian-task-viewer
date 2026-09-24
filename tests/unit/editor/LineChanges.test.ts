import { describe, it, expect } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { lineChanges } from '../../../src/editor/LineChanges';
import { draftOver, type LineDraft, type LineEdit } from '../../../src/utils/FileLines';

/** The lines a draft's changes leave, and its report. */
function written(before: readonly string[], write: (draft: LineDraft) => void): { after: string[]; edits: LineEdit[] } {
    const lines = [...before];
    const { draft, reported } = draftOver(lines);
    write(draft);
    return { after: lines, edits: reported };
}

/** The editor's document and cursor once the changes are made to `before` with the cursor at `cursor`. */
function applied(before: readonly string[], after: readonly string[], edits: readonly LineEdit[], cursor = 0) {
    const changes = lineChanges(before, after, edits);
    if (changes === null) throw new Error('no changes');
    const state = EditorState.create({ doc: before.join('\n'), selection: EditorSelection.cursor(cursor) });
    const next = state.update({ changes }).state;
    return { changes, doc: next.doc.toString(), cursor: next.selection.main.head };
}

/** Where column `column` of line `line` stands in the lines joined by `\n`. */
function at(lines: readonly string[], line: number, column: number): number {
    return lines.slice(0, line).reduce((sum, text) => sum + text.length + 1, 0) + column;
}

describe('lineChanges', () => {
    it('changes a rewritten line only where it differs, and leaves the cursor on it', () => {
        const before = ['# N', '- [x] T ==> next', '    - c', '- [ ] U'];
        const { after, edits } = written(before, (draft) => {
            draft.rewrite(1, '- [x] T');
            draft.splice(3, 0, '- [ ] T ==> next', '    - c');
        });
        const cursor = at(before, 1, 4);
        const result = applied(before, after, edits, cursor);
        expect(result.doc).toBe(after.join('\n'));
        expect(result.cursor).toBe(cursor);
        expect(result.changes).toEqual([
            { from: at(before, 1, 7), to: at(before, 1, 16), insert: '' },
            { from: at(before, 3, 0), to: at(before, 3, 0), insert: '- [ ] T ==> next\n    - c\n' },
        ]);
    });

    it('takes away the lines the write took away, and nothing else', () => {
        const before = ['a', 'b', 'c', 'd'];
        const { after, edits } = written(before, (draft) => draft.splice(1, 2));
        const result = applied(before, after, edits, at(before, 3, 1));
        expect(result.doc).toBe('a\nd');
        expect(result.cursor).toBe(at(after, 1, 1));
        expect(result.changes).toEqual([{ from: 2, to: 6, insert: '' }]);
    });

    it('puts lines in past the last line, and above the first', () => {
        const before = ['a', 'b'];
        const { after, edits } = written(before, (draft) => {
            draft.splice(2, 0, 'c', 'd');
            draft.splice(0, 0, 'z');
        });
        const result = applied(before, after, edits, at(before, 1, 1));
        expect(result.doc).toBe('z\na\nb\nc\nd');
        expect(result.cursor).toBe(at(after, 2, 1));
        expect(result.changes).toEqual([{ from: 0, to: 0, insert: 'z\n' }, { from: 3, to: 3, insert: '\nc\nd' }]);
    });

    it('replaces a run the write took away and put new lines in', () => {
        const before = ['a', 'b', 'c', 'd'];
        const { after, edits } = written(before, (draft) => draft.splice(1, 2, 'x'));
        const result = applied(before, after, edits);
        expect(result.doc).toBe('a\nx\nd');
        expect(result.changes).toEqual([{ from: 2, to: 6, insert: 'x\n' }]);
    });

    it('replaces the whole document when no line stays', () => {
        const before = ['a', 'b'];
        const { after, edits } = written(before, (draft) => draft.splice(0, 2, 'x', 'y'));
        const result = applied(before, after, edits);
        expect(result.doc).toBe('x\ny');
        expect(result.changes).toEqual([{ from: 0, to: 3, insert: 'x\ny' }]);
    });

    it('leaves standing the most lines that keep their order when a line moves', () => {
        const before = ['a', 'b', 'c', 'd', 'e'];
        // `d` carried up above `b`, and taken away where it stood.
        const { after, edits } = written(before, (draft) => {
            draft.put({ at: 1, parent: null, indent: '' }, [{ from: 3, text: 'd', kind: 'text' }]);
            draft.splice(4, 1);
        });
        expect(after).toEqual(['a', 'd', 'b', 'c', 'e']);
        const cursor = at(before, 2, 1);
        const result = applied(before, after, edits, cursor);
        expect(result.doc).toBe(after.join('\n'));
        // `a`, `b`, `c` and `e` stay; `d` goes and comes back.
        expect(result.cursor).toBe(at(after, 3, 1));
        expect(result.changes).toEqual([{ from: 2, to: 2, insert: 'd\n' }, { from: 6, to: 8, insert: '' }]);
    });

    it('changes nothing for a write that changed nothing', () => {
        expect(lineChanges(['a', 'b'], ['a', 'b'], [])).toEqual([]);
    });

    it('answers null for a report no document could follow, or one that leaves other lines', () => {
        expect(lineChanges(['a'], ['a'], [{ kind: 'removed', at: 0, count: 2 }])).toBeNull();
        expect(lineChanges(['a'], ['a', 'b'], [])).toBeNull();
    });

    it('turns any run of splices and rewrites into the document they leave', () => {
        let seed = 7;
        const random = (n: number) => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % n;
        };
        for (let round = 0; round < 300; round++) {
            const before = Array.from({ length: 1 + random(6) }, (_, i) => `l${i}${'x'.repeat(random(3))}`);
            const { after, edits } = written(before, (draft) => {
                for (let step = random(4); step >= 0; step--) {
                    const length = draft.lines.length;
                    if (length > 0 && random(3) === 0) {
                        draft.rewrite(random(length), `r${round}-${step}${'y'.repeat(random(2))}`);
                    } else {
                        const where = random(length + 1);
                        const went = random(Math.min(2, length - where) + 1);
                        const came = Array.from({ length: random(3) }, (_, i) => `n${round}-${step}-${i}`);
                        if (length - went + came.length === 0) continue;
                        draft.splice(where, went, ...came);
                    }
                }
            });
            expect(applied(before, after, edits).doc).toBe(after.join('\n'));
        }
    });
});
