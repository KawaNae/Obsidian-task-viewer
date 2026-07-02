import { describe, it, expect } from 'vitest';
import {
    flowSource,
    flowValidation,
    joinSegments,
    parseFlowSegments,
    segmentIndexAt,
    singleLineFlow,
} from '../../../src/services/flow/FlowSegments';
import { parseFlow } from '../../../src/services/flow/FlowParser';
import { serializeFlow, serializeFlowLines } from '../../../src/services/flow/FlowSerializer';
import { FlowProgram } from '../../../src/services/flow/FlowAst';

function errorCodes(raws: string[]): string[] {
    return parseFlowSegments(raws).diagnostics
        .filter(d => d.severity === 'error')
        .map(d => d.code);
}

describe('FlowSegments', () => {
    describe('joinSegments / segmentIndexAt', () => {
        it('builds a table of [start, end) spans in joined coordinates', () => {
            const { source, table } = joinSegments(['every mon', 'x3']);
            expect(source).toBe('every mon\nx3');
            expect(table.spans).toEqual([
                { start: 0, end: 9 },
                { start: 10, end: 12 },
            ]);
            expect(segmentIndexAt(table, 0)).toBe(0);
            expect(segmentIndexAt(table, 8)).toBe(0);
            expect(segmentIndexAt(table, 10)).toBe(1);
        });
    });

    describe('parseFlowSegments', () => {
        it('single segment is equivalent to parseFlow', () => {
            const single = parseFlowSegments(['every mon x3']);
            const direct = parseFlow('every mon x3');
            expect(single.program).toEqual(direct.program);
            expect(single.diagnostics).toEqual(direct.diagnostics);
        });

        it('parses one program across segments', () => {
            const { program, diagnostics } = parseFlowSegments(['every mon', 'setDue(start + 3d)', 'x3']);
            expect(diagnostics).toEqual([]);
            expect(program?.schedule?.kind).toBe('every');
            expect(program?.lifetime).toMatchObject({ count: 3 });
            expect(Object.keys(program?.sets ?? {})).toEqual(['due']);
        });

        it('accepts an empty task-line segment (flow lives only in child lines)', () => {
            const { program, diagnostics } = parseFlowSegments(['', 'every mon']);
            expect(diagnostics).toEqual([]);
            expect(program?.schedule?.kind).toBe('every');
        });

        it('resolves orphan modifiers across segments', () => {
            // 'x3' alone is an orphan; joined with a schedule segment it is valid.
            expect(errorCodes(['x3', 'every mon'])).toEqual([]);
        });

        it('rejects a node spanning a segment boundary', () => {
            expect(errorCodes(['every', 'mon'])).toContain('flow.node-spans-lines');
            expect(parseFlowSegments(['every', 'mon']).program).toBeNull();
        });

        it('detects duplicates across segments', () => {
            expect(errorCodes(['every mon', 'every tue'])).toContain('flow.duplicate-schedule');
        });
    });

    describe('flowSource / singleLineFlow', () => {
        it('flowSource joins all segments', () => {
            const flow = {
                raw: 'every mon',
                childSegments: [{ raw: 'x3', bodyLine: 5 }],
                program: null,
                diagnostics: [],
            };
            expect(flowSource(flow)).toBe('every mon\nx3');
        });

        it('singleLineFlow has no child segments', () => {
            const flow = singleLineFlow('every mon');
            expect(flow.childSegments).toEqual([]);
            expect(flow.program?.schedule?.kind).toBe('every');
        });
    });

    describe('flowValidation', () => {
        it('returns undefined for executable flows', () => {
            expect(flowValidation(singleLineFlow('every mon'))).toBeUndefined();
        });

        it('maps the first error to the validation channel', () => {
            const v = flowValidation(singleLineFlow('evry mon'));
            expect(v?.severity).toBe('error');
            expect(v?.rule).toBe('flow.unknown-head');
            expect(v?.hint).toBe('==> evry mon');
        });
    });
});

describe('serializeFlowLines (line-level canonical)', () => {
    function parsed(raws: string[]): { program: FlowProgram; table: ReturnType<typeof joinSegments>['table'] } {
        const { program, diagnostics, table } = parseFlowSegments(raws);
        if (!program) throw new Error(`parse failed: ${diagnostics.map(d => d.message).join('; ')}`);
        return { program, table };
    }

    it('degenerates to serializeFlow for a single segment', () => {
        const { program, table } = parsed(['move([[A]]) until 2026-09-28 every mon x3']);
        const lines = serializeFlowLines(program, table);
        expect(lines.taskLine).toBe(serializeFlow(program));
        expect(lines.childLines).toEqual([]);
    });

    it('keeps each node on the line it was written on', () => {
        const { program, table } = parsed(['every mon', 'setDue(start + 3d)', 'move([[Log]])']);
        expect(serializeFlowLines(program, table)).toEqual({
            taskLine: 'every mon',
            childLines: ['setDue(start + 3d)', 'move([[Log]])'],
        });
    });

    it('reorders nodes canonically WITHIN a line', () => {
        const { program, table } = parsed(['every mon', 'until 2026-09-28 x3']);
        // canonical order: xN before until
        expect(serializeFlowLines(program, table).childLines).toEqual(['x3 until 2026-09-28']);
    });

    it('supports an empty task-line segment', () => {
        const { program, table } = parsed(['', 'every mon', 'x3']);
        expect(serializeFlowLines(program, table)).toEqual({
            taskLine: '',
            childLines: ['every mon', 'x3'],
        });
    });

    it('keeps the telomere decrement on its own line (span survives the spread)', () => {
        const { program, table } = parsed(['every mon', 'x3']);
        const next: FlowProgram = { ...program, lifetime: { ...program.lifetime!, count: 2 } };
        expect(serializeFlowLines(next, table)).toEqual({
            taskLine: 'every mon',
            childLines: ['x2'],
        });
    });

    it('drops a child line whose bucket empties', () => {
        const { program, table } = parsed(['every mon', 'x1']);
        const withoutLifetime: FlowProgram = { ...program, lifetime: undefined };
        expect(serializeFlowLines(withoutLifetime, table)).toEqual({
            taskLine: 'every mon',
            childLines: [],
        });
    });
});
