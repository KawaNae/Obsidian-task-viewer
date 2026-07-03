import { describe, it, expect } from 'vitest';
import { dateBlockDiagnostics } from '../../../src/services/parsing/tv-inline/DateBlockDiagnostics';
import { TaskParser } from '../../../src/services/parsing/TaskParser';
import { DEFAULT_SETTINGS } from '../../../src/types';

const withDefaults = <T>(fn: () => T): T => TaskParser.withChain(DEFAULT_SETTINGS, fn);

/** Slice helper: the text a span selects from the line. */
const cut = (line: string, span: { start: number; end: number }) =>
    line.slice(span.start, span.end);

describe('dateBlockDiagnostics', () => {
    it('flags cross-midnight on the end segment as a warning, with hint', () => {
        const line = '- [ ] foo @2026-01-15T22:00>06:00';
        const diags = withDefaults(() => dateBlockDiagnostics(line));
        expect(diags).toHaveLength(1);
        expect(diags[0].severity).toBe('warning');
        expect(diags[0].code).toBe('cross-midnight');
        expect(cut(line, diags[0].span)).toBe('06:00');
        expect(diags[0].message).toContain('\n'); // message + hint
    });

    it('flags end-time-without-start as an error', () => {
        const line = '- [ ] foo @2026-01-15>17:00';
        const diags = withDefaults(() => dateBlockDiagnostics(line));
        expect(diags).toHaveLength(1);
        expect(diags[0].severity).toBe('error');
        expect(diags[0].code).toBe('end-time-without-start');
        expect(cut(line, diags[0].span)).toBe('17:00');
    });

    it('flags end-before-start on the end segment', () => {
        const line = '- [ ] foo @2026-01-15>2026-01-10';
        const diags = withDefaults(() => dateBlockDiagnostics(line));
        expect(diags).toHaveLength(1);
        expect(diags[0].code).toBe('end-before-start');
        expect(cut(line, diags[0].span)).toBe('2026-01-10');
    });

    it('returns nothing for a valid block', () => {
        expect(withDefaults(() =>
            dateBlockDiagnostics('- [ ] foo @2026-01-15T08:00>17:00>2026-01-20')
        )).toEqual([]);
    });

    it('returns nothing without a date block (fast path)', () => {
        expect(withDefaults(() => dateBlockDiagnostics('- [ ] plain task'))).toEqual([]);
        expect(withDefaults(() => dateBlockDiagnostics('not a task line'))).toEqual([]);
    });

    it('skips lines owned by an external parser', () => {
        // With day-planner enabled, a "HH:mm - HH:mm" line is dp-owned; the
        // trailing @time-like text must NOT be decorated.
        const line = '- [ ] 08:00 - 09:00 standup @10:00';
        const diags = TaskParser.withChain(
            { ...DEFAULT_SETTINGS, enableDayPlanner: true },
            () => dateBlockDiagnostics(line)
        );
        expect(diags).toEqual([]);
    });

    it('skips flow-origin validations (dot-namespaced codes)', () => {
        // No date block issue; the broken flow command lands on
        // Task.validation with a dot code, which flow decorations own.
        const line = '- [ ] foo @2026-01-15 ==> evry day';
        const diags = withDefaults(() => dateBlockDiagnostics(line));
        expect(diags).toEqual([]);
    });

    it('prioritizes rule errors over structural warnings (scanner parity)', () => {
        // Excess separators AND end-time-without-start: the scanner keeps
        // the rule result, so the decoration must match.
        const line = '- [ ] foo @2026-01-15>17:00>2026-01-20>18:00';
        const diags = withDefaults(() => dateBlockDiagnostics(line));
        expect(diags).toHaveLength(1);
        expect(diags[0].code).toBe('end-time-without-start');
        expect(cut(line, diags[0].span)).toBe('17:00');
    });

    it('flags excess separators on the extra tail', () => {
        const line = '- [ ] foo @2026-01-15T08:00>17:00>2026-01-20>18:00';
        const diags = withDefaults(() => dateBlockDiagnostics(line));
        expect(diags).toHaveLength(1);
        expect(diags[0].code).toBe('parse-error');
        expect(cut(line, diags[0].span)).toBe('>18:00');
    });

    it('flags each discarded extra date block', () => {
        const line = '- [ ] foo @2026-01-15 bar @2026-02-01';
        const diags = withDefaults(() => dateBlockDiagnostics(line));
        expect(diags).toHaveLength(1);
        expect(diags[0].code).toBe('parse-error');
        expect(cut(line, diags[0].span)).toBe('@2026-02-01');
    });
});
