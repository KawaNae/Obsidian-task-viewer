import type { Task, TaskViewerSettings } from '../../types';
import { namesOutsideIndex } from '../core/RowNames';
import type { RowSnapshot } from '../operations/Operations';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import { Outline, type OutlineReading } from '../parsing/utils/Outline';
import { draftOver, replayEdits, UnfollowableDraft, type RefusalReason } from '../persistence/FileLines';
import type { SubtreeReplacement } from '../persistence/TaskOps';
import { planUpdate } from '../persistence/UpdatePlan';
import { updateRow } from '../persistence/UpdateRow';
import type { PropertyRefusal } from '../persistence/utils/ChildPropertyLineEditor';

/**
 * Why a change was not taken into a {@link RowDraft}, which stays as it
 * was: a property whose lines the reading finds wrong (`property`, as a
 * write to the note refuses it), or a source draft whose lines are not the
 * row's subtree once in the note — the row's line read as no task there
 * (`not-task`, as the source's own check of the line says it:
 * `SubtreeFrame.check`), a line that ends the row's item (`unplaceable`),
 * lines below it taken in (`disturbs`), as a write of the same replacement
 * refuses the last two (`replaceSubtree`).
 *
 * The row's line can read as a task alone and as none among the note's
 * lines: an ordered list that starts at another number than 1 cannot
 * interrupt a paragraph, so under a parent's text, or right after a
 * paragraph, it goes on that paragraph.
 */
export type RowDraftRefusal =
    | PropertyRefusal
    | { kind: 'not-task' }
    | Extract<RefusalReason, { kind: 'unplaceable' | 'disturbs' }>;

/**
 * A {@link RowDraft} as a source editor was opened on it (`RowDraft.mark`):
 * the row and its subtree then, which the editor opens on
 * (`SubtreeFrame.open`), and for each child line the line of the disk's
 * subtree it is (null: a line the draft made).
 *
 * The editor says which line each of its lines was by these lines, however
 * many of its drafts are taken in (`RowDraft.take`): a mark is what a draft
 * of the editor is told against, for as long as the editor stays open.
 */
export interface DraftMark {
    readonly rows: readonly string[];
    readonly was: readonly (number | null)[];
}

/** What a {@link RowDraft} reads as: the row, and the rows of its subtree. */
interface DraftReading {
    task: Task;
    descendants: Task[];
}

/**
 * A draft of a row that is in a note, and of its subtree, which no write
 * holds: what the fields and the source write of it while nothing is
 * written, and the replacement of the row on the disk that writes it all
 * at once (`SubtreeReplacement`, for `Operations.replaceSubtree` and a
 * send's row, `SendRow.draft`).
 *
 * It holds the note's lines as they were read when it was opened, the
 * row's lines now in place of the row's subtree, and for each child line
 * the line of the subtree on the disk it is (`SubtreeLine.was`, null for a
 * line the draft made). The lines around the row's subtree never change.
 *
 * A field's change is written to the lines as a write to the note writes
 * it (`planUpdate`, `updateRow`), over the whole note's lines: the row is
 * read where it stands, so a row indented under a parent is not read as
 * code, and what it inherits from its sections is what the index reads.
 * What the fields do not show — the list marker, the date blocks that do
 * not read, `==>`, `^id`, the child lines and child tasks — is kept as a
 * write to the note keeps it.
 *
 * What the draft does not ask is what only the write asks: whether every
 * other line of the note reads as it did once written (`checkWrite`). A
 * draft taken in here can still be refused when written.
 */
export class RowDraft {
    private reading: DraftReading | null = null;
    /** How many times the lines have changed. */
    private changes = 0;
    /**
     * For each mark this draft made, the count of {@link changes} after the
     * last change taken in on it, or when it was made: while that is the
     * count now, the draft is as the mark and its own drafts left it.
     */
    private readonly marks = new WeakMap<DraftMark, number>();

    private constructor(
        private readonly settings: TaskViewerSettings,
        /** One level of indentation (`ObsidianConfig.indentUnit`): the first child of a line with none. */
        private readonly unit: string,
        /** The name of the row the draft is of: the one the values are given. */
        private readonly name: string,
        private readonly path: string,
        /** The note's lines above the row. */
        private readonly above: readonly string[],
        /** The note's lines below the row's subtree. */
        private readonly below: readonly string[],
        /** The row and its subtree as the disk holds them. */
        private readonly base: readonly string[],
        /** The row and its subtree as the draft has them now. */
        private rows: readonly string[],
        /** For each child line of {@link rows}, the line of {@link base} it is (its offset from the row), or null. */
        private was: readonly (number | null)[],
    ) { }

    /**
     * A draft of the row of `snapshot` (`Operations.rowSnapshot`): the copy
     * of it that is the row on the disk, and the note's lines it was read
     * in. The draft opens as the disk holds the row and its subtree
     * (`Task.subtreeLines`), at the row's line.
     */
    static of(snapshot: RowSnapshot, settings: TaskViewerSettings, unit: string): RowDraft {
        const { task, lines } = snapshot;
        const base = task.subtreeLines;
        const line = task.line;
        if (!base || base.length === 0 || !base.every((text, i) => lines[line + i] === text)) {
            throw new RangeError(`the row's subtree is not the note's lines at line ${line}`);
        }
        return new RowDraft(
            settings, unit, task.id, task.file,
            lines.slice(0, line), lines.slice(line + base.length), base,
            base, base.slice(1).map((_, i) => i + 1),
        );
    }

    /** The row's line in the note. */
    private get line(): number {
        return this.above.length;
    }

    /** The note's lines as the draft would leave them. */
    lines(): string[] {
        return [...this.above, ...this.rows, ...this.below];
    }

    /** The row and its subtree as the draft has them now. */
    subtree(): readonly string[] {
        return this.rows;
    }

    /**
     * The draft as a source editor opens on it now: the mark its drafts are
     * taken in on ({@link take}). A mark holds while only drafts taken in on
     * it change the draft; a field's change ({@link apply}), or a draft taken
     * in on another mark, ends it.
     */
    mark(): DraftMark {
        const mark: DraftMark = { rows: this.rows, was: this.was };
        this.marks.set(mark, this.changes);
        return mark;
    }

    /**
     * The row as the draft's lines read, under the row's name. What the
     * fields and the card show, and what the next change is planned from.
     */
    task(): Task {
        return this.read().task;
    }

    /**
     * The rows of the row's subtree as the draft's lines read, in the
     * note's order. Named as rows read outside the index are
     * (`namesOutsideIndex`), which no name of the index is; a child of the
     * row names it by the row's name.
     */
    descendants(): readonly Task[] {
        return this.read().descendants;
    }

    /**
     * Take in a field's change (`Partial<Task>`, as the fields hand it,
     * `TaskUpdateBuilder`): the lines are those a write of the same change
     * to the note leaves, for a row the disk holds as the draft does.
     *
     * @returns null when taken in; else why not, and the draft is as it was.
     */
    apply(updates: Partial<Task>): RowDraftRefusal | null {
        const op = planUpdate(this.task(), updates, this.settings.scopeKeys);
        // The draft changes the lines it is handed: a copy, so a refusal leaves these as they were.
        const handed = this.lines();
        const before = handed.length;
        const { draft, reported, placedBy } = draftOver(handed);
        const refused = updateRow(draft, this.line, op, this.unit);
        if (refused) return refused;

        const origins = replayEdits(before, reported, placedBy);
        if (!origins) throw new UnfollowableDraft('a field\'s change reported edits no lines could follow');
        // Every line the change makes or takes out is in the row's subtree.
        const end = this.line + this.rows.length + (draft.lines.length - before);
        if (draft.reading().subtreeEnd(this.line) !== end) return { kind: 'disturbs', fence: null };
        const was: (number | null)[] = [];
        for (let n = this.line + 1; n < end; n++) was.push(this.wasOf(origins.origin[n]));
        this.set(draft.lines.slice(this.line, end), was);
        return null;
    }

    /**
     * Take in a draft of the source (`SubtreeFrame.check`'s `write`, or
     * `SubtreeFrame.unchanged` to go back to the lines it opened on) from an
     * editor opened on `mark`: its `was` say which line of `mark.rows` each
     * line is, which is told here as the line of the disk's subtree it is.
     * The same editor's drafts are taken in on the same mark, one after
     * another, each in place of the one before.
     *
     * The lines are read once, as {@link task} reads them, and taken in
     * only when the row's line reads as a row there: a draft taken in
     * always has values.
     *
     * A mark this draft did not make, or one whose draft has changed by
     * other means since ({@link mark}), would tell the lines as the wrong
     * ones of the disk: a caller's bug, thrown.
     *
     * @returns null when taken in; else why its lines are not the row's
     * subtree in the note, and the draft and the mark are as they were.
     */
    take(replacement: SubtreeReplacement, mark: DraftMark): RowDraftRefusal | null {
        const since = this.marks.get(mark);
        if (since === undefined) throw new UnfollowableDraft('a source draft was taken in on a mark this draft did not make');
        if (since !== this.changes) throw new UnfollowableDraft('a source draft was taken in on a mark the draft has changed past');
        const rows = [Outline.indentOf(mark.rows[0]) + Outline.dedent(replacement.text), ...replacement.children.map(child => child.text)];
        const was = replacement.children.map(child => {
            if (child.was === null) return null;
            if (!Number.isInteger(child.was) || child.was < 1 || child.was >= mark.rows.length) {
                throw new UnfollowableDraft(`a subtree line was line ${child.was} of a subtree of ${mark.rows.length} lines`);
            }
            return mark.was[child.was - 1];
        });
        const lines = [...this.above, ...rows, ...this.below];
        const outline = Outline.read(lines);
        const reading = this.readOf(lines, rows.length, outline);
        if (!reading) return { kind: 'not-task' };
        const end = outline.subtreeEnd(this.line);
        const last = this.line + rows.length;
        if (end < last) return { kind: 'unplaceable', fence: null };
        if (end > last) return { kind: 'disturbs', fence: null };
        this.set(rows, was, reading);
        this.marks.set(mark, this.changes);
        return null;
    }

    /**
     * The draft as the replacement of the row and its subtree on the disk:
     * null when its lines are the disk's, and there is nothing to write.
     */
    replacement(): SubtreeReplacement | null {
        if (this.rows.length === this.base.length && this.rows.every((text, i) => text === this.base[i])) return null;
        return {
            text: Outline.dedent(this.rows[0]),
            children: this.rows.slice(1).map((text, i) => ({ text, was: this.was[i] })),
        };
    }

    /** The lines now, and what they read as when that is known already. */
    private set(rows: readonly string[], was: readonly (number | null)[], reading: DraftReading | null = null): void {
        this.rows = rows;
        this.was = was;
        this.reading = reading;
        this.changes++;
    }

    /**
     * The line of the disk's subtree that the line `origin` of the draft's
     * lines is (null: a line the draft made). A line outside the row's
     * subtree is none of the row's: a change that moves one there is a bug.
     */
    private wasOf(origin: number | null): number | null {
        if (origin === null) return null;
        const offset = origin - this.line;
        if (offset < 1 || offset >= this.rows.length) {
            throw new UnfollowableDraft(`a line of the row's subtree came from line ${origin}, outside it`);
        }
        return this.was[offset - 1];
    }

    private read(): DraftReading {
        if (this.reading) return this.reading;
        const reading = this.readOf(this.lines(), this.rows.length);
        if (!reading) throw new RangeError(`the draft's line ${this.line} does not read as a row`);
        this.reading = reading;
        return reading;
    }

    /**
     * What `lines`, the note's lines with a subtree of `count` lines at the
     * row's line, read as (`outline`, their reading, when it is made
     * already): null when the row's line reads as no row there.
     */
    private readOf(lines: string[], count: number, outline?: OutlineReading): DraftReading | null {
        const line = this.line;
        const end = line + count;
        const { tasks } = FileParsePipeline.parse(this.path, lines, this.settings, namesOutsideIndex(this.path), outline);
        const read = tasks.find(task => task.line === line);
        if (!read) return null;
        const named = (task: Task): Task => (task.parentId === read.id ? { ...task, parentId: this.name } : task);
        return {
            task: { ...read, id: this.name },
            descendants: tasks.filter(task => task.line > line && task.line < end).map(named),
        };
    }
}
