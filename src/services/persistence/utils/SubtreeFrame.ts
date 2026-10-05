import { Outline } from '../../parsing/utils/Outline';
import { TaskLineClassifier } from '../../parsing/utils/TaskLineClassifier';
import type { SubtreeLine, SubtreeReplacement } from '../TaskOps';

/**
 * Whether a subtree opens in the source editor (`SubtreeFrame.open`): the
 * frame, or the line that keeps it shut.
 *
 * `shallow`: a line of the subtree, not blank, stands shallower than a child
 * does (the child indentation, `SubtreeFrame.childIndent`) — the row's text
 * going on at its content column above children indented past it, or a lazy
 * line. The child editor shows a child's indentation as its first column, so
 * it has no column to show such a line at. `line` is its offset from the row.
 */
export type SubtreeOpening =
    | { open: true; frame: SubtreeFrame }
    | { open: false; reason: 'shallow'; line: number };

/**
 * What the two editors hold when the draft is applied: the row's line, and
 * each child line with the line of the subtree it was when the editor opened
 * (its offset from the row, 1 for the first child line; null for a line the
 * editor made). Which line a line was is the editor's to say (`LineMap`),
 * from the changes that made the text, never guessed from the text.
 */
export interface SubtreeDraft {
    parent: string;
    children: readonly SubtreeLine[];
}

/**
 * What a draft comes to (`SubtreeFrame.check`): the replacement to write
 * (`Operations.replaceSubtree`), the subtree it was opened on unchanged,
 * or why it cannot be written.
 *
 * - `parent-break`: the row's editor holds more than one line
 * - `not-task`: the row's line is no task line
 */
export type DraftCheck =
    | { kind: 'write'; replacement: SubtreeReplacement }
    | { kind: 'same' }
    | { kind: 'refused'; reason: 'parent-break' | 'not-task' };

/**
 * A row and its subtree as the source editor shows them, and the way back to
 * the file's lines.
 *
 * The row's editor holds the row's line without its indentation. The child
 * editor holds the child lines with the child indentation `childIndent` (B)
 * taken off: a child of the row stands at its first column, and no line in
 * it can be written at the row's depth or shallower. B is the indentation a
 * new child of the row takes by the one rule of it
 * (`Placement.resolveChildIndent`): the row's first child's, or a level
 * as Obsidian's settings say (`unit`) when it has none.
 *
 * Every line the draft keeps as it opened is written back byte for byte,
 * and a line whose text changed but not its indentation keeps the
 * indentation's characters. Only a line the editor made, or whose
 * indentation it changed, is spelled anew: B and the editor's indentation.
 * So a draft changes in the file no more than its user changed in the
 * editor.
 *
 * The subtree is read by itself, away from the note, as it reads in it
 * (`Outline.readSubtree`): a nested row is not read as indented code.
 */
export class SubtreeFrame {
    private constructor(
        /** The row's line and its subtree as they were opened: `Task.subtreeLines`. */
        readonly base: readonly string[],
        /** The indentation of a new level, as Obsidian's settings say (`ObsidianConfig.indentUnit`): what Tab puts in the child editor. */
        readonly unit: string,
        /** B: the indentation the child editor's first column stands for. */
        readonly childIndent: string,
        /** The row's editor's text: the row without its indentation. */
        readonly parent: string,
        /** The child editor's lines: each child line with B taken off, a blank line empty. */
        readonly children: readonly string[],
    ) { }

    /**
     * Open the row and subtree `base` (`Task.subtreeLines`: the row, then
     * its subtree as the file writes it, no blank line at the end), a new
     * level being `unit`. Shut when a line stands shallower than B
     * ({@link SubtreeOpening}).
     */
    static open(base: readonly string[], unit: string): SubtreeOpening {
        const row = base[0];
        const alone = Outline.readSubtree(base);
        let first: number | null = null;
        for (let j = 1; j < base.length && first === null; j++) {
            if (alone.item(j)?.parent === 0) first = j;
        }
        const childIndent = Outline.childIndent(row, first === null ? null : Outline.indentOf(base[first]), unit);
        for (let i = 1; i < base.length; i++) {
            if (!Outline.isBlank(base[i]) && Outline.depthOf(base[i]) < Outline.depthOf(childIndent)) return { open: false, reason: 'shallow', line: i };
        }
        const children = base.slice(1).map(line => (Outline.isBlank(line) ? '' : Outline.shiftIndent(line, childIndent, '')));
        return { open: true, frame: new SubtreeFrame(base, unit, childIndent, Outline.dedent(row), children) };
    }

    /**
     * The lines of the file `draft` writes, and whether to write them.
     *
     * The row keeps its indentation. When its line opens its content at
     * another column (`- ` made `10. `), B is asked again of the new line
     * (`Outline.childIndent`): kept where a child still opens at it, spelled
     * anew where it does not, and every child line carried from the old B to
     * the new one (`Outline.shiftIndent`). The blank lines that end the
     * child editor are dropped: the subtree ends at its last line that is not
     * blank, and a blank line past it is the note's, not the row's.
     *
     * Every child line is written at B or deeper: the child editor has no
     * column shallower, and B opens a child of the row whatever its line
     * (`Outline.childIndent`). So every child line stands in the row's item,
     * and nothing needs reading to say so. What the lines do to the note
     * around them — a fence left open over the lines below, a paragraph
     * below taken in — is not asked here: the write asks it of the note
     * (`ReplaceSubtree`, `checkWrite`) and answers why it refused.
     *
     * A draft whose lines are the ones opened is `same`, whichever lines the
     * editor says they were: there is nothing to write.
     */
    check(draft: SubtreeDraft): DraftCheck {
        if (/[\r\n]/.test(draft.parent)) return { kind: 'refused', reason: 'parent-break' };
        const rowIndent = Outline.indentOf(this.base[0]);
        const row = rowIndent + Outline.dedent(draft.parent);
        if (!TaskLineClassifier.isTaskLine(row)) return { kind: 'refused', reason: 'not-task' };

        const from = this.childIndent;
        const to = Outline.childIndent(row, from, this.unit);
        let count = draft.children.length;
        while (count > 0 && Outline.isBlank(draft.children[count - 1].text)) count--;
        const children: SubtreeLine[] = draft.children.slice(0, count).map(child => ({
            text: this.fileLine(child, from, to),
            was: child.was,
        }));

        const lines = [row, ...children.map(child => child.text)];
        if (lines.length === this.base.length && lines.every((line, i) => line === this.base[i])) return { kind: 'same' };
        return { kind: 'write', replacement: { text: row, children } };
    }

    /**
     * The file's line for a line of the child editor, B being `to` where it
     * was `from`: the line opened, where the editor kept it; its
     * indentation's characters and the new text, where only the text
     * changed; else `to` and the editor's indentation (`Outline.shiftedIndent`,
     * which keeps the columns where a tab would reach another).
     */
    private fileLine(child: SubtreeLine, from: string, to: string): string {
        const { text, was } = child;
        if (was !== null) {
            const opened = this.base[was];
            const shown = this.children[was - 1];
            if (opened === undefined || shown === undefined || was < 1) {
                throw new RangeError(`a child line was line ${was} of a subtree of ${this.base.length} lines`);
            }
            if (text === shown) return from === to || Outline.isBlank(opened) ? opened : Outline.shiftIndent(opened, from, to);
            if (!Outline.isBlank(opened) && !Outline.isBlank(text) && Outline.indentOf(text) === Outline.indentOf(shown)) {
                return Outline.shiftedIndent(Outline.indentOf(opened), from, to) + Outline.dedent(text);
            }
        }
        if (Outline.isBlank(text)) return '';
        return Outline.shiftedIndent(Outline.indentOf(text), '', to) + Outline.dedent(text);
    }
}
