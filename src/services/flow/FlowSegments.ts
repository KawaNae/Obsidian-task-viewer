import type { DiagnosticCode, Task, TaskFlow } from '../../types';
import { type Diagnostic, type Span, error } from '../lang/Diagnostic';
import type { FlowProgram } from './FlowAst';
import { type ParseFlowResult, parseFlow } from './FlowParser';
import { diagnosticText } from './diagnosticText';

/**
 * Segment assembly for multi-line flow programs.
 *
 * A flow program is written across segments: the task line's `==>` tail
 * (segment 0, possibly '') plus each `- ==>` child line. The segments are
 * joined with '\n' (the lexer skips it as whitespace, and no legal token
 * contains it) and parsed as ONE node stream — the grammar is order-free,
 * so line-splitting is purely presentational.
 *
 * The SegmentTable records each segment's [start, end) span in the joined
 * source, letting consumers map joined-coordinate diagnostic spans back to
 * (segment, column) and derive each AST node's line assignment
 * (FlowSerializer.serializeFlowLines).
 */

export interface SegmentTable {
    /** Per-segment [start, end) spans in joined coordinates. */
    spans: Span[];
}

export const SEGMENT_SEPARATOR = '\n';

export function joinSegments(raws: string[]): { source: string; table: SegmentTable } {
    const spans: Span[] = [];
    let offset = 0;
    for (const raw of raws) {
        spans.push({ start: offset, end: offset + raw.length });
        offset += raw.length + SEGMENT_SEPARATOR.length;
    }
    return { source: raws.join(SEGMENT_SEPARATOR), table: { spans } };
}

/** Index of the segment containing the joined-coordinate offset. */
export function segmentIndexAt(table: SegmentTable, offset: number): number {
    for (let i = table.spans.length - 1; i >= 0; i--) {
        if (offset >= table.spans[i].start) return i;
    }
    return 0;
}

export interface ParseFlowSegmentsResult extends ParseFlowResult {
    table: SegmentTable;
}

/**
 * Parse a multi-segment flow source. On top of parseFlow, enforces that
 * every node is written within a single segment — a node whose span crosses
 * a segment boundary (e.g. `every` on the task line, `mon` on a child
 * line) is an error, not a silent join.
 */
export function parseFlowSegments(raws: string[]): ParseFlowSegmentsResult {
    const { source, table } = joinSegments(raws);
    const result = parseFlow(source);

    if (result.program) {
        const spanning = nodeSpans(result.program).filter(span => crossesBoundary(span, table));
        if (spanning.length > 0) {
            const diagnostics: Diagnostic[] = [...result.diagnostics];
            for (const span of spanning) {
                diagnostics.push(error(
                    'flow.node-spans-lines',
                    'A clause must be written within a single line',
                    span,
                ));
            }
            return { program: null, diagnostics, table };
        }
    }

    return { ...result, table };
}

function nodeSpans(program: FlowProgram): Span[] {
    const spans: Span[] = [];
    if (program.schedule) spans.push(program.schedule.span);
    if (program.lifetime) spans.push(program.lifetime.span);
    if (program.until) spans.push(program.until.span);
    if (program.nochildren) spans.push(program.nochildren.span);
    if (program.sets) {
        for (const node of Object.values(program.sets)) {
            if (node) spans.push(node.span);
        }
    }
    if (program.move) spans.push(program.move.span);
    return spans;
}

function crossesBoundary(span: Span, table: SegmentTable): boolean {
    const seg = segmentIndexAt(table, span.start);
    return span.end > table.spans[seg].end;
}

/** All segment raws of a flow, document order (task line first). */
export function flowRaws(flow: TaskFlow): string[] {
    return [flow.raw, ...flow.childSegments.map(s => s.raw)];
}

/**
 * Joined source of a flow — the completion-detection signature component
 * (TaskScanner) and log form. Editing or consuming ANY segment changes it.
 */
export function flowSource(flow: TaskFlow): string {
    return flowRaws(flow).join(SEGMENT_SEPARATOR);
}

/** TaskFlow for a lone task-line command (line-level parser, tests). */
export function singleLineFlow(raw: string): TaskFlow {
    return { raw, childSegments: [], ...parseFlow(raw) };
}

/**
 * Map a flow's first error (or first diagnostic) onto the Task.validation
 * channel so a broken command is never a silent no-op, even for users who
 * never see editor decorations. Returns undefined for executable flows.
 */
export function flowValidation(flow: TaskFlow): Task['validation'] {
    if (flow.program) return undefined;
    const first = flow.diagnostics.find(d => d.severity === 'error') ?? flow.diagnostics[0];
    if (!first) return undefined;
    return {
        severity: first.severity,
        // Diagnostic codes are namespaced (`flow.` / `lex.` / `expr.` /
        // `type.`) by construction — see the ValidationRule union.
        rule: first.code as DiagnosticCode,
        message: diagnosticText(first),
        hint: `==> ${flowRaws(flow).filter(r => r !== '').join(' ')}`,
    };
}
