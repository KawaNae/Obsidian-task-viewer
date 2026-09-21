import type { FlowInstanceInsert } from './FlowInstanceLines';

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
 * - `remove`: the row and its children are taken out.
 */
export type TaskOp =
    | { kind: 'insert-instance'; insert: FlowInstanceInsert }
    | { kind: 'strip-flow'; text: string }
    | { kind: 'remove' };
