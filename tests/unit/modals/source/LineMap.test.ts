import { describe, it, expect } from 'vitest';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { history, isolateHistory, moveLineDown, redo, undo } from '@codemirror/commands';
import { lineMapOf, trackLines } from '../../../../src/modals/form/source/LineMap';

/**
 * The map from the lines an editor opened with to its lines now, as edits
 * leave it. Each state is shown as its lines with the line each continues:
 * `2:text` continues opened line 2, `+:text` is new.
 */
function open(lines: string[], opened?: number): EditorState {
    return EditorState.create({ doc: lines.join('\n'), extensions: [trackLines(opened), history()] });
}

function apply(state: EditorState, ...specs: TransactionSpec[]): EditorState {
    for (const spec of specs) state = state.update({ ...spec, annotations: isolateHistory.of('full') }).state;
    return state;
}

function run(state: EditorState, command: (t: { state: EditorState; dispatch: (tr: any) => void }) => boolean): EditorState {
    let next = state;
    command({ state, dispatch: (tr) => { next = tr.state; } });
    return next;
}

/** The change CodeMirror's deleteLine makes (it needs a view): the line and its break, or the break before the last line. */
function deleteLine(state: EditorState, n: number): EditorState {
    const line = state.doc.line(n);
    const changes = n < state.doc.lines ? { from: line.from, to: line.to + 1 } : { from: line.from - 1, to: line.to };
    return apply(state, { changes, userEvent: 'delete.line' });
}

function shown(state: EditorState): string[] {
    const map = lineMapOf(state);
    const out: string[] = [];
    for (let n = 1; n <= state.doc.lines; n++) out.push(`${map.was(n) ?? '+'}:${state.doc.line(n).text}`);
    return out;
}

/** Position of `line` (1-based) + `col` in the state. */
function at(state: EditorState, line: number, col = 0): number {
    return state.doc.line(line).from + col;
}

describe('LineMap: edits within lines keep them', () => {
    it('keeps every line when nothing changed', () => {
        expect(shown(open(['- [ ] a', '- [ ] b']))).toEqual(['1:- [ ] a', '2:- [ ] b']);
    });

    it('keeps a line whose text was edited, even all of it', () => {
        let s = open(['- [ ] a', '- [ ] b']);
        s = apply(s, { changes: { from: at(s, 1, 3), to: at(s, 1, 4), insert: 'x' } });
        s = apply(s, { changes: { from: at(s, 2), to: s.doc.line(2).to, insert: 'other' } });
        expect(shown(s)).toEqual(['1:- [x] a', '2:other']);
    });

    it('keeps a line emptied of its text', () => {
        let s = open(['a', 'b', 'c']);
        s = apply(s, { changes: { from: at(s, 2), to: s.doc.line(2).to } });
        expect(shown(s)).toEqual(['1:a', '2:', '3:c']);
    });

    it('keeps lines that a line is added before, between or after', () => {
        let s = open(['a', 'b']);
        s = apply(s, { changes: { from: at(s, 1), insert: 'top\n' } });      // Enter at a line's start
        s = apply(s, { changes: { from: s.doc.line(2).to, insert: '\nmid' } }); // Enter at a line's end
        s = apply(s, { changes: { from: s.doc.length, insert: '\nend' } });
        expect(shown(s)).toEqual(['+:top', '1:a', '+:mid', '2:b', '+:end']);
    });

    it('keeps the other lines when one is deleted, as deleteLine does', () => {
        const s = deleteLine(open(['a', 'b', 'c']), 2);
        expect(shown(s)).toEqual(['1:a', '3:c']);
        const t = deleteLine(open(['a', 'b', 'c']), 3); // the last line goes with the break before it
        expect(shown(t)).toEqual(['1:a', '2:b']);
    });

    it('tells apart two lines of the same text by the edits', () => {
        let s = open(['- [ ] same', '- [ ] same']);
        s = apply(s, { changes: { from: at(s, 1), to: at(s, 2) } }); // the first goes, with its break
        expect(shown(s)).toEqual(['2:- [ ] same']);
        let t = open(['- [ ] same', '- [ ] same']);
        t = apply(t, { changes: { from: t.doc.line(1).to, to: t.doc.length } }); // the second goes
        expect(shown(t)).toEqual(['1:- [ ] same']);
    });
});

describe('LineMap: changes across lines make new lines', () => {
    it('makes both halves of a split line new', () => {
        let s = open(['ab', 'c']);
        s = apply(s, { changes: { from: at(s, 1, 1), insert: '\n' } });
        expect(shown(s)).toEqual(['+:a', '+:b', '2:c']);
    });

    it('makes a joined line new', () => {
        let s = open(['a', 'b', 'c']);
        s = apply(s, { changes: { from: s.doc.line(1).to, to: at(s, 2) } }); // Backspace at b's start
        expect(shown(s)).toEqual(['+:ab', '3:c']);
    });

    it('keeps a nonempty line joined to an empty one above it', () => {
        let s = open(['', 'b']);
        s = apply(s, { changes: { from: 0, to: 1 } });
        expect(shown(s)).toEqual(['2:b']);
    });

    it('makes a line cut into from the line above new', () => {
        let s = open(['a', 'bcd', 'e']);
        s = apply(s, { changes: { from: at(s, 1), to: at(s, 2, 1) } });
        expect(shown(s)).toEqual(['+:cd', '3:e']);
    });

    it('makes a line cut and pasted new, and keeps the lines it left', () => {
        let s = open(['a', 'b', 'c']);
        s = apply(s, { changes: { from: at(s, 1), to: at(s, 2) } }); // cut "a\n"
        s = apply(s, { changes: { from: s.doc.length, insert: '\na' } });
        expect(shown(s)).toEqual(['2:b', '3:c', '+:a']);
    });

    it('makes a pasted completed line new', () => {
        let s = open(['- [ ] a']);
        s = apply(s, { changes: { from: s.doc.length, insert: '\n- [x] a' } });
        expect(shown(s)).toEqual(['1:- [ ] a', '+:- [x] a']);
    });

    it('keeps a line moved by the editor, and makes the line it moved over new', () => {
        let s = open(['a', 'b', 'c']);
        s = apply(s, { selection: EditorSelection.cursor(at(s, 1)) });
        s = run(s, moveLineDown); // CodeMirror writes "b" again above "a" and deletes it below
        expect(shown(s)).toEqual(['+:b', '1:a', '3:c']);
    });
});

describe('LineMap: undo and redo', () => {
    it('makes a line deleted and restored by undo new', () => {
        let s = deleteLine(open(['a', 'b', 'c']), 2);
        s = run(s, undo);
        expect(s.doc.toString()).toBe('a\nb\nc');
        expect(shown(s)).toEqual(['1:a', '+:b', '3:c']);
    });

    it('keeps a line whose edit was undone, and after its redo', () => {
        let s = open(['- [ ] a', 'b']);
        s = apply(s, { changes: { from: 3, to: 4, insert: 'x' } });
        s = run(s, undo);
        expect(shown(s)).toEqual(['1:- [ ] a', '2:b']);
        s = run(s, redo);
        expect(shown(s)).toEqual(['1:- [x] a', '2:b']);
    });

    it('keeps a line through an Enter undone', () => {
        let s = open(['ab', 'c']);
        s = apply(s, { changes: { from: 1, insert: '\n' } });
        s = run(s, undo);
        expect(shown(s)).toEqual(['1:ab', '2:c']);
    });
});

describe('LineMap: empty lines and an editor opened empty', () => {
    it('lets only one line continue when one of two empty lines is deleted', () => {
        let s = open(['a', '', '', 'b']);
        s = apply(s, { changes: { from: at(s, 2), to: at(s, 3) } });
        expect(shown(s)).toEqual(['1:a', '2:', '4:b']);
        const map = lineMapOf(s);
        expect([map.now(2), map.now(3)]).toEqual([2, null]);
    });

    it('gives an empty line to the empty line, not to a line deleted into it', () => {
        const s = deleteLine(open(['a', 'b', '', 'c']), 2);
        expect(shown(s)).toEqual(['1:a', '3:', '4:c']);
        const t = deleteLine(open(['a', '', 'b']), 3);
        expect(shown(t)).toEqual(['1:a', '2:']);
    });

    it('opened with no lines, has every line new', () => {
        let s = open([], 0);
        expect(shown(s)).toEqual(['+:']);
        s = apply(s, { changes: { from: 0, insert: 'a\nb' } });
        expect(shown(s)).toEqual(['+:a', '+:b']);
    });

    it('answers where each opened line is now', () => {
        let s = open(['a', 'b', 'c']);
        s = apply(s, { changes: { from: 0, insert: 'new\n' } });
        s = apply(s, { changes: { from: at(s, 3), to: at(s, 4) } });
        const map = lineMapOf(s);
        expect([map.now(1), map.now(2), map.now(3)]).toEqual([2, null, 3]);
    });
});
