import type { FlowInstanceInsert } from './FlowInstanceLines';
import type { Refusal, WriteMade, WriteRefused } from './FileLines';
import type { PropertyOp } from './PropertyUpdatePlanner';
import type { InSection } from './utils/Placement';

/** Where a new line goes beside the row (see {@link TaskOp} `insert`). */
export type InsertPlace = 'firstChild' | 'afterSubtree' | 'afterCompletedRun';

/**
 * One thing an operation does to the row it names, in a write that may do
 * several (see `InlineTaskWriter.write`).
 *
 * Each carries finished text or a finished instance, never a task: what to
 * write is the caller's to decide, and where it goes is decided here, against
 * the lines the write is holding. That is the division the recurrence path has
 * always had, now held for every effect of a fire.
 *
 * - `insert-instance`: the next instance goes in at the head of the row's
 *   sibling group, indented from the file.
 * - `strip-flow`: the command is consumed — the row's own `- ==>` lines go,
 *   and the row reads `text` (indentation kept from the file).
 * - `move`: the row is moved within its note, reading `text`, to `to` (a
 *   heading's section, at the side the settings say: `Placement.into`), with
 *   its children re-indented under it and without its own `- ==>` lines. An
 *   ordered row is numbered where it lands (`ListNumber.at`). The row and its
 *   children are carried, not copied: they are the rows they were (see
 *   `LineEdits.carry`).
 * - `remove`: the row and its children are taken out.
 * - `insert`: `text`, a new line, goes in beside the row where `place`
 *   says (`Placement`, of the same name): at the head of its children
 *   (`firstChild`), as its next sibling past its subtree (`afterSubtree`),
 *   or past the completed siblings that follow it (`afterCompletedRun`),
 *   spelled as the item next to it. A timer's record, the one insert every
 *   timer line takes (`TaskIndex.insertLine`).
 * - `copies`: copies of the row go in as its siblings, on `side`: just
 *   above it, or past its subtree, spelled as the row is
 *   (`Placement.copyOf`). `lines` are the copies' own lines, finished
 *   ({@link CopyLines}); with `children`, each copy is followed by the row's
 *   children, without their `^id`s and otherwise as they stand. A card's,
 *   the API's and the CLI's duplicate of a row (`planDuplicate`), and the
 *   editor menu's duplicate of a line (one line, no children).
 * - `update`: the row reads `text` (indentation kept from the file), and
 *   its own property lines change by `childOps`. A card's, the API's and a
 *   timer's rewrite of a row, and the editor menu's rewrite of a line.
 * - `fire`: the row's flow fires. What it does is planned here, inside the
 *   write, from the lines as the ops before it left them (`plan`, which the
 *   flow layer hands in), and the ops it answers are applied in its place.
 *   Only a write that completes the row carries it (`completes`): a fire is
 *   what completing a task does, never what a later reading of it finds.
 */
export type TaskOp =
    | { kind: 'insert-instance'; insert: FlowInstanceInsert }
    | { kind: 'strip-flow'; text: string }
    | { kind: 'move'; text: string; to: InSection }
    | { kind: 'remove' }
    | { kind: 'copies'; side: 'above' | 'below'; lines: CopyLines; children: boolean }
    | { kind: 'insert'; place: InsertPlace; text: string }
    | { kind: 'update'; text: string; childOps?: readonly PropertyOp[] }
    | { kind: 'fire'; plan: (lines: readonly string[], line: number) => readonly TaskOp[] };

/**
 * The lines of a {@link TaskOp} `copies`, in file order: finished lines, or
 * `verbatim`, that many repeats of the row's own line as the file holds it,
 * without its `^id` (the id names the row, not a copy of it), so a copy that
 * is not moved is not reworded either. Which to write is the caller's
 * question, which needs the task's dates; this layer only puts them.
 */
export type CopyLines = readonly string[] | { verbatim: number };

/**
 * The fire of a write that completes a row, handed in with the op by the flow
 * layer (`FlowExecutor.fireOp`).
 *
 * The completion is the user's and the fire follows from it, so a fire that
 * writes lines never takes the completion down with it: a write refused with
 * the fire in it, whatever it was refused for, is tried without it, as the
 * editor writes the fire apart from the completion it follows
 * (`FlowFireExtension`). A refusal of the completion's own is met again
 * without the fire, and nothing is written. Where one write completes several
 * rows, each row's fire stands or is set aside on its own, as the editor's do
 * (`InlineTaskWriter.writeFiring`).
 */
export interface CompletionFire {
    op: Extract<TaskOp, { kind: 'fire' }>;
    /** Whether the fire, as the write's last run planned it, writes lines. */
    writes(): boolean;
}

/**
 * What came of a write that may complete rows: refused whole, and nothing
 * written; or made, with each fire of a row it completed, in the order the
 * rows stand, and the refusal the write met with that fire in it when it was
 * set aside (`setAside`: the completion is written without it, and the user
 * is owed a word of it), else null.
 */
export type FiringOutcome<F extends CompletionFire = CompletionFire> =
    | WriteRefused
    | (WriteMade & { fires: ReadonlyArray<{ fire: F; setAside: Refusal | null }> });

/**
 * A row and its subtree written anew from a draft of their text: the hub's
 * source mode (`TaskIndex.replaceSubtree`). `text` is the row's line, its
 * indentation aside (the row keeps the file's). `children` are the lines of
 * its subtree, in order, each as the file is to read it, indentation
 * included, and each with the line of the subtree it was when the draft was
 * opened: what the editor's own map of its changes says (`LineMap`), never
 * a guess from the text.
 *
 * Not a {@link TaskOp}: it is a write of its own, never one effect among
 * others, and what it answers (the rows it completed) is what the write's
 * fires are planned on (`ReplaceSubtree`).
 */
export interface SubtreeReplacement {
    text: string;
    children: readonly SubtreeLine[];
}

/** A line of a {@link SubtreeReplacement}'s subtree. */
export interface SubtreeLine {
    /** The line as the file is to read it, indentation included. */
    text: string;
    /**
     * Where it was in the subtree the draft was opened on: its offset from the
     * row (1 for the row's first child line; 0 is the row itself, which no
     * child is). Null for a line the draft made.
     */
    was: number | null;
}
