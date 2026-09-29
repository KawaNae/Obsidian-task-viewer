import { ChangeSet, MapMode, StateField, type EditorState, type Extension, type Text } from '@codemirror/state';

/**
 * Which line of an editor continues which line it was opened with, told by
 * the editor's own record of its changes rather than by comparing the texts
 * before and after: two lines of the same text are told apart by where the
 * user's edits put them, not by a guess.
 *
 * A line opened at `[head, end]` continues as the line now at `M` when
 *
 * - neither its head nor its end is inside a deleted range: the line was not
 *   cut into from outside, nor deleted with its break;
 * - its head (mapped past text inserted there) and its end (mapped before
 *   text inserted there) are both on `M`: the line was not split;
 * - no character of `M` that was there when the editor opened came from
 *   outside the line: the line was not joined to another.
 *
 * Editing within the line, even replacing all of its text, keeps it. A line
 * cut and pasted, split, joined, or deleted and restored by undo is a new
 * line, and the line pasted is new too: as the editor's fire counts a
 * completion (`FlowFireExtension.completedRows`), a change across lines
 * continues no line it touches. Only empty lines can claim one line at once
 * (one of two empty lines deleted); the first keeps it.
 */
export class LineMap {
    private constructor(
        /** Per line opened (index 0 = line 1), the line it is now (1-based), or null. */
        private readonly toNow: readonly (number | null)[],
        /** Per line now (index 0 = line 1), the line it was opened as (1-based), or null. */
        private readonly toWas: readonly (number | null)[],
    ) {}

    /**
     * The map over `changes`, from the first `opened` lines of `start` to the
     * lines of `doc`. `opened` is less than `start.lines` only when the editor
     * opened with no lines at all (an empty document still has one).
     */
    static of(start: Text, doc: Text, changes: ChangeSet, opened: number = start.lines): LineMap {
        const gaps: { a: number; b: number; len: number }[] = [];
        changes.iterGaps((a, b, len) => gaps.push({ a, b, len }));

        const toNow: (number | null)[] = [];
        const toWas: (number | null)[] = new Array(doc.lines).fill(null);
        for (let n = 1; n <= opened; n++) {
            const line = start.line(n);
            const now = continuedAs(line.from, line.to, doc, changes, gaps);
            if (now === null || toWas[now - 1] !== null) {
                toNow.push(null);
                continue;
            }
            toNow.push(now);
            toWas[now - 1] = n;
        }
        return new LineMap(toNow, toWas);
    }

    /** The line (1-based) the opened line `line` is now, or null if it is gone. */
    now(line: number): number | null {
        return this.toNow[line - 1] ?? null;
    }

    /** The opened line (1-based) the line `line` now continues, or null if it is new. */
    was(line: number): number | null {
        return this.toWas[line - 1] ?? null;
    }
}

function continuedAs(
    head: number, end: number, doc: Text, changes: ChangeSet,
    gaps: readonly { a: number; b: number; len: number }[],
): number | null {
    if (changes.mapPos(head, 1, MapMode.TrackDel) === null) return null;
    if (changes.mapPos(end, -1, MapMode.TrackDel) === null) return null;
    const line = doc.lineAt(changes.mapPos(head, 1));
    if (doc.lineAt(changes.mapPos(end, -1)).number !== line.number) return null;
    for (const gap of gaps) {
        const from = Math.max(line.from, gap.b);
        const to = Math.min(line.to, gap.b + gap.len);
        if (from >= to) continue;
        const oldFrom = gap.a + (from - gap.b);
        const oldTo = gap.a + (to - gap.b);
        if (oldFrom < head || oldTo > end) return null;
    }
    return line.number;
}

interface Opened {
    start: Text;
    lines: number;
    changes: ChangeSet;
}

const openedField = StateField.define<Opened>({
    create: (state) => ({ start: state.doc, lines: state.doc.lines, changes: ChangeSet.empty(state.doc.length) }),
    update: (value, tr) => (tr.docChanged ? { ...value, changes: value.changes.compose(tr.changes) } : value),
});

/**
 * Keeps the editor's changes since it was created, for `lineMapOf`. `lines`
 * is how many lines it opened with: all of its document, or 0 when the
 * document stands for no lines (it opened empty).
 */
export function trackLines(lines?: number): Extension {
    return openedField.init((state) => ({
        start: state.doc,
        lines: lines ?? state.doc.lines,
        changes: ChangeSet.empty(state.doc.length),
    }));
}

/** The map from the lines the editor opened with to its lines now (`trackLines`). */
export function lineMapOf(state: EditorState): LineMap {
    const opened = state.field(openedField);
    return LineMap.of(opened.start, state.doc, opened.changes, opened.lines);
}
