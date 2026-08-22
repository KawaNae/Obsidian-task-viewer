import type { Diagnostic } from '../services/lang/Diagnostic';
import type { FlowProgram } from '../services/flow/FlowAst';

/**
 * One `- ==> ...` child line owned by the task's flow program.
 * `raw` is the verbatim text after the line's `==>` marker (trimmed);
 * `bodyLine` is the absolute file line (same convention as
 * ChildLine.bodyLine), or -1 for a not-yet-written new instance.
 */
export interface FlowChildSegment {
    raw: string;
    bodyLine: number;
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
 *   flow lives only in child lines). format() re-emits it unchanged for
 *   round-trip safety, even when parsing failed. Child segments are never
 *   rewritten by format() — they are physical lines of their own.
 * - `program` is non-null iff parsing AND checking the joined source
 *   produced no error diagnostics — i.e. the command is executable.
 * - `diagnostics` spans are offsets into the joined source (see
 *   services/flow/FlowSegments.ts for the segment table mapping).
 */
export interface TaskFlow {
    raw: string;
    childSegments: FlowChildSegment[];
    program: FlowProgram | null;
    diagnostics: Diagnostic[];
}
