import type { Diagnostic } from '../services/lang/Diagnostic';
import type { FlowProgram } from '../services/lang/flow/FlowAst';

/**
 * One `- ==> ...` child line owned by the task's flow program.
 * `raw` is the verbatim text after the line's `==>` marker (trimmed).
 */
export interface FlowChildSegment {
    raw: string;
    /**
     * The absolute file line it was read from (same convention as
     * ChildLine.bodyLine). None on a segment the plugin has planned and not
     * written yet: a next instance's (`FlowPlanner`). A flow read off a note
     * has one on every segment (`ReadFlow`).
     */
    bodyLine?: number;
}

/** A flow as a note writes it (`readFlow`): every segment stands on its line. */
export interface ReadFlow extends TaskFlow {
    childSegments: Required<FlowChildSegment>[];
}

/**
 * Parsed flow command state carried on a Task.
 *
 * A flow program is physically written across a group of lines: the task
 * line's `==>` tail plus any direct `- ==> ...` child lines. The program is
 * parsed from all segments joined in document order (grammar is order-free,
 * so splitting is purely presentational).
 *
 * Invariants:
 * - `raw` is the verbatim task-line text after `==>` (trimmed; '' when the
 *   flow lives only in child lines). formatTaskLine re-emits it unchanged for
 *   round-trip safety, even when parsing failed. Child segments are never
 *   rewritten by formatTaskLine — they are physical lines of their own.
 * - `program` is non-null iff parsing AND checking the joined source
 *   produced no error diagnostics — i.e. the command is executable.
 * - `diagnostics` spans are offsets into the joined source (see
 *   services/lang/flow/FlowSegments.ts for the segment table mapping).
 */
export interface TaskFlow {
    raw: string;
    childSegments: FlowChildSegment[];
    program: FlowProgram | null;
    diagnostics: Diagnostic[];
}
