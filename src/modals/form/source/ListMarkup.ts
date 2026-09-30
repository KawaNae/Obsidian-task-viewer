import { indentMore, moveLineDown, moveLineUp } from '@codemirror/commands';
import {
    Annotation, countColumn, EditorSelection, EditorState,
    type ChangeSpec, type Extension, type Line, type SelectionRange, type StateCommand, type Text, type Transaction,
} from '@codemirror/state';

/**
 * Lists in the source editor, as Obsidian's editor keeps them: Enter goes on
 * with the list markup of the line it breaks, an empty item gives up a level
 * or its markup, and numbered lists are numbered again after every change.
 * What Obsidian's editor does was measured in it (source-mode-design.md,
 * 段 4b); each rule below says which case it follows.
 *
 * Lines are read one by one, not parsed as CommonMark. The source holds a
 * row's subtree, lists of tasks and the lines under them, and the measured
 * cases read as lines do: an item a tab under `1. a` is its child, where
 * CommonMark's parser (`@codemirror/lang-markdown`) finds none and goes on
 * with no markup, and a status other than ` ` or `x` is still a checkbox.
 */

/** A list item's markup at the head of a line. */
export interface ListMarkup {
    /** The indent, as the line spells it. */
    indent: string;
    /** `-`, `*` or `+` for a bullet; null for a number. */
    bullet: string | null;
    /** The number of an ordered item; null for a bullet. */
    number: number | null;
    /** `.` or `)` after the number; null for a bullet. */
    delimiter: string | null;
    /** Whether a checkbox (`[ ]`, `[x]`, or any other status) follows the marker. */
    checkbox: boolean;
    /** The offset of the item's content: past the indent, the marker, its space, and a checkbox with its space. */
    end: number;
    /** The offset past the indent and the marker (with its number and delimiter). */
    markerEnd: number;
}

const ITEM = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)/;
const CHECKBOX = /^\[[^\]]\][ \t]+/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;

/**
 * The list markup `text` opens with, or null. A marker needs the whitespace
 * after it (`-` alone, `2.` alone are text), and so does a checkbox: `- [ ]`
 * at the end of a line is a bullet whose text is `[ ]`, as Obsidian reads it.
 */
export function listMarkup(text: string): ListMarkup | null {
    const m = ITEM.exec(text);
    if (!m) return null;
    const markerEnd = m[1].length + (m[2] ?? m[3] + m[4]).length;
    const box = CHECKBOX.exec(text.slice(m[0].length));
    return {
        indent: m[1],
        bullet: m[2] ?? null,
        number: m[3] !== undefined ? Number(m[3]) : null,
        delimiter: m[4] ?? null,
        checkbox: box !== null,
        end: m[0].length + (box ? box[0].length : 0),
        markerEnd,
    };
}

/**
 * The markup of an item going on after `item` in its list: the same bullet,
 * or the next number with the same delimiter, one space after it, and an
 * open checkbox where `item` has one, whatever its status (Obsidian: `- [x]`
 * and `- [/]` go on as `- [ ] `).
 */
export function nextMarkup(item: ListMarkup): string {
    const marker = item.bullet ?? `${item.number! + 1}${item.delimiter}`;
    return `${marker} ${item.checkbox ? '[ ] ' : ''}`;
}

/**
 * `indent` a level shallower, as Obsidian gives up a level of an empty
 * item: its last tab, or else up to `tabSize` of its trailing spaces. What
 * is left keeps its spelling (`\t  ` → `\t`, six spaces → two).
 */
export function outdented(indent: string, tabSize: number): string {
    if (indent.endsWith('\t')) return indent.slice(0, -1);
    let cut = indent.length;
    while (cut > 0 && indent.length - cut < tabSize && indent[cut - 1] === ' ') cut--;
    return indent.slice(0, cut);
}

/**
 * Where a break at `from`-`to` in `line` cuts it: from `from` to past the
 * whitespace the text sent to the new line starts with (Obsidian: `- a| b`
 * → `- |b`). Before whitespace alone up to the end of the line, the break
 * goes after it and the whitespace stays, though Obsidian drops it: taking
 * it off, or sending it on, would change the line's end, and the line would
 * no longer be the one it was (`LineMap`), losing the row it stands for.
 */
function cutAt(line: Line, from: number, to: number): { from: number; to: number } {
    const at = to - line.from;
    const space = /^[ \t]*/.exec(line.text.slice(at))![0].length;
    return at + space < line.text.length ? { from, to: to + space } : { from: from === to ? line.to : from, to: line.to };
}

/**
 * A line break that keeps the indent of the line it breaks, spelled as that
 * line spells it (a break inside the indent keeps the part before it): a
 * new line at the same depth takes the spelling of the line it follows
 * (source-mode-design.md, 3「字下げの綴り」).
 */
function breakKeepingIndent(state: EditorState, range: SelectionRange) {
    const line = state.doc.lineAt(range.from);
    const lead = /^[ \t]*/.exec(line.text)![0];
    const indent = lead.slice(0, range.from - line.from);
    const cut = range.to <= line.to && range.from - line.from >= lead.length
        ? cutAt(line, range.from, range.to)
        : { from: range.from, to: range.to };
    const insert = state.lineBreak + indent;
    return {
        changes: { ...cut, insert } as ChangeSpec,
        range: EditorSelection.cursor(cut.from + insert.length),
    };
}

/**
 * A line break as Obsidian's editor makes one in a list (measured there):
 *
 * - In an item's content, the text after the caret goes to a new item under
 *   it with `nextMarkup`, at the same indent as the line spells it, less the
 *   whitespace it starts with (`- a| b` → `- a` and `- |b`; `cutAt`).
 * - In an empty item (nothing but markup and whitespace), no line is made:
 *   an indented item gives up a level (`outdented`), keeping its own
 *   markup, and an item at no indent loses its markup.
 * - A line of whitespace alone is emptied, and no line is made.
 * - Elsewhere (in the markup, on a line that is no item, across lines), the
 *   break keeps the indent of the line it breaks.
 *
 * Numbers after the new item are put right by `listNumbering`.
 */
export const newlineContinuingList: StateCommand = ({ state, dispatch }) => {
    if (state.readOnly) return false;
    dispatch(state.update(state.changeByRange((range) => breakInList(state, range)), {
        scrollIntoView: true,
        userEvent: 'input',
    }));
    return true;
};

function breakInList(state: EditorState, range: SelectionRange) {
    const line = state.doc.lineAt(range.from);
    if (range.to > line.to) return breakKeepingIndent(state, range);
    const text = line.text;
    if (/^[ \t]+$/.test(text)) {
        return { changes: { from: line.from, to: line.to } as ChangeSpec, range: EditorSelection.cursor(line.from) };
    }
    const item = listMarkup(text);
    const at = range.from - line.from;
    if (!item || at < item.end) return breakKeepingIndent(state, range);

    const content = text.slice(item.end, at) + text.slice(range.to - line.from);
    if (!/\S/.test(content)) {
        const changes = item.indent
            ? state.changes([
                { from: line.from, to: line.from + item.indent.length, insert: outdented(item.indent, state.tabSize) },
                { from: range.from, to: range.to },
            ])
            : state.changes({ from: line.from, to: line.to });
        return { changes, range: EditorSelection.cursor(changes.mapPos(line.to, 1)) };
    }

    const cut = cutAt(line, range.from, range.to);
    const insert = state.lineBreak + item.indent + nextMarkup(item);
    return {
        changes: { ...cut, insert } as ChangeSpec,
        range: EditorSelection.cursor(cut.from + insert.length),
    };
}

/**
 * Lines (1-based) whose ordered item starts its list at 1 when it has no
 * item before it in the list: the lines just indented by Tab (Obsidian: an
 * item indented under another starts its list at 1, where an item already
 * first in its list keeps its number).
 */
const restartLists = Annotation.define<ReadonlySet<number>>();

interface Level {
    /** The column an item's content starts at: a line indented this far is under it. */
    content: number;
    /** The last item of the list at this level: its number, or null for a bullet. */
    last: { number: number | null } | null;
}

/**
 * The changes that number the ordered lists of `doc` as Obsidian's editor
 * numbers them after any change to a note (measured there):
 *
 * - An item is under the item before it when it is indented at least to
 *   that item's content; else it is in the list of the level it reaches.
 * - An ordered item after an ordered item of its list takes the next
 *   number (`1)` and `2.` are one list); after a bullet of its list, 1. The
 *   first item of a list keeps its number (`5.` stays `5.`), unless it was
 *   just indented (`restart`).
 * - Blank lines do not end a list, nor does a line right under an item (a
 *   lazy line). After a blank line, a line of text that is not indented to
 *   an item's content ends the lists it is not under; a heading ends them
 *   all.
 */
export function renumberLists(doc: Text, tabSize: number, restart: ReadonlySet<number> = new Set()): ChangeSpec[] {
    const changes: ChangeSpec[] = [];
    const levels: Level[] = [{ content: -1, last: null }];
    let blank = false;
    for (let n = 1; n <= doc.lines; n++) {
        const line = doc.line(n);
        const text = line.text;
        if (!/\S/.test(text)) {
            blank = true;
            continue;
        }
        const item = listMarkup(text);
        const column = countColumn(/^[ \t]*/.exec(text)![0], tabSize);
        if (!item) {
            if (HEADING.test(text)) {
                levels.length = 1;
                levels[0].last = null;
            } else if (blank) {
                while (levels.length > 1 && column < levels[levels.length - 1].content) levels.pop();
                levels[levels.length - 1].last = null;
            }
            blank = false;
            continue;
        }
        blank = false;
        while (levels.length > 1 && column < levels[levels.length - 1].content) levels.pop();
        const level = levels[levels.length - 1];
        let number = item.number;
        if (number !== null) {
            const last = level.last;
            const want = last ? (last.number !== null ? last.number + 1 : 1) : (restart.has(n) ? 1 : number);
            if (want !== number) {
                const from = line.from + item.indent.length;
                changes.push({ from, to: from + String(number).length, insert: String(want) });
                number = want;
            }
        }
        level.last = { number };
        levels.push({ content: countColumn(text.slice(0, item.markerEnd), tabSize) + 1, last: null });
    }
    return changes;
}

/** Numbers the editor's ordered lists again after each change, in the same transaction (`renumberLists`). */
export const listNumbering: Extension = EditorState.transactionFilter.of((tr: Transaction) => {
    if (!tr.docChanged) return tr;
    const changes = renumberLists(tr.newDoc, tr.startState.tabSize, tr.annotation(restartLists));
    return changes.length > 0 ? [tr, { changes, sequential: true }] : tr;
});

/**
 * Tab: `indentMore`, with each line it indents starting its list at 1 when
 * the line is now first in it (Obsidian: `2. b` indented under `1. a` is
 * `1. b`).
 */
export const indentMoreRestartingLists: StateCommand = ({ state, dispatch }) => {
    let indented: Transaction | null = null;
    if (!indentMore({ state, dispatch: (tr) => { indented = tr; } }) || !indented) return false;
    const tr: Transaction = indented;
    const lines = new Set<number>();
    for (const range of tr.state.selection.ranges) {
        const last = tr.state.doc.lineAt(range.to).number;
        for (let n = tr.state.doc.lineAt(range.from).number; n <= last; n++) lines.add(n);
    }
    dispatch(state.update({
        changes: tr.changes,
        selection: tr.selection,
        scrollIntoView: true,
        userEvent: 'input.indent',
        annotations: restartLists.of(lines),
    }));
    return true;
};

/**
 * Alt+ArrowUp and Alt+ArrowDown: `moveLineUp` and `moveLineDown`, with the
 * numbers of ordered items left where they were, as Obsidian's "move line
 * up/down" leaves them (`1. a`, `2. b` with `b` moved up is `1. b`, `2. a`).
 * Moving lines by cut and paste goes through `listNumbering` alone, as it
 * does there (`2. b` pasted above `1. a` is `2. b`, `3. a`).
 */
export const moveLineUpKeepingNumbers: StateCommand = keepingNumbers(moveLineUp);
export const moveLineDownKeepingNumbers: StateCommand = keepingNumbers(moveLineDown);

function keepingNumbers(move: StateCommand): StateCommand {
    return ({ state, dispatch }) => {
        let captured: Transaction | null = null;
        if (!move({ state, dispatch: (tr) => { captured = tr; } }) || !captured) return false;
        const moved: Transaction = captured;
        const numbers: ChangeSpec[] = [];
        let from = Infinity;
        let to = -1;
        moved.changes.iterChangedRanges((fromA, toA) => {
            from = Math.min(from, fromA);
            to = Math.max(to, toA);
        });
        // A move keeps the count of lines, and the moved lines stay within the span it changed.
        if (to >= 0 && moved.newDoc.lines === state.doc.lines) {
            const last = state.doc.lineAt(to).number;
            for (let n = state.doc.lineAt(from).number; n <= last; n++) {
                const was = listMarkup(state.doc.line(n).text);
                const line = moved.newDoc.line(n);
                const now = listMarkup(line.text);
                if (was?.number == null || now?.number == null || was.number === now.number) continue;
                const at = line.from + now.indent.length;
                numbers.push({ from: at, to: at + String(now.number).length, insert: String(was.number) });
            }
        }
        dispatch(state.update(
            { changes: moved.changes, selection: moved.selection, scrollIntoView: true, userEvent: 'move.line' },
            { changes: numbers, sequential: true },
        ));
        return true;
    };
}

/** What Enter in the parent's line sends to the children, and what it leaves of the line. */
export interface ParentBreak {
    /** Where the parent's line is cut: it keeps the text before. Null to leave it whole. */
    cut: number | null;
    /** The line put first among the children. */
    child: string;
    /** Where the caret goes in that line. */
    caret: number;
}

/**
 * Enter in the parent's line at `[from, to]`: the text after the caret goes
 * to a new first child line, less the whitespace it starts with, behind the
 * markup of the parent's list (a bullet stays itself, a number starts at 1,
 * a checkbox is open whatever the parent's status), and the caret goes to
 * the start of that text. At the end of the line the child line is empty
 * markup. In the parent's markup, the line is left whole and an empty child
 * line is made, since there is no text to send. The parent's line has no
 * indent (the source takes it off), so its markup is read from it as it is.
 */
export function breakParent(parent: string, from: number, to: number): ParentBreak {
    const item = listMarkup(parent);
    const markup = item ? `${item.bullet ?? `1${item.delimiter}`} ${item.checkbox ? '[ ] ' : ''}` : '';
    if (item && from < item.end) return { cut: null, child: markup, caret: markup.length };
    const after = parent.slice(to).replace(/^[ \t]+/, '');
    return { cut: from, child: markup + after, caret: markup.length };
}
