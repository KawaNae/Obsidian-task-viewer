import type { FlowInstanceInsert } from './FlowInstanceLines';
import type { PropertyOp } from './PropertyUpdatePlanner';

/**
 * One thing an operation does to the row it names, in a write that may do
 * several (see `InlineTaskWriter.applyToTask`).
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
 * - `move-to-end`: the row is moved to the end of its file, reading `text`,
 *   with its children re-indented under it and without its own `- ==>`
 *   lines. The row and its children are carried, not copied: they are the
 *   rows they were (see `LineEdits.carry`).
 * - `remove`: the row and its children are taken out.
 * - `copy`: `text` goes in as the row's next sibling, past its subtree,
 *   spelled as the row is (`Placement.copyOf`): the editor menu's duplicate
 *   of a line.
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
    | { kind: 'move-to-end'; text: string }
    | { kind: 'remove' }
    | { kind: 'copy'; text: string }
    | { kind: 'update'; text: string; childOps?: readonly PropertyOp[] }
    | { kind: 'fire'; plan: (lines: readonly string[], line: number) => readonly TaskOp[] };
