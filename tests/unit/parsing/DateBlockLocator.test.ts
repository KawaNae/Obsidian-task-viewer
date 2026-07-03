import { describe, it, expect } from 'vitest';
import {
    locateDateBlock,
    spansForRule,
    type DateBlockLocation,
} from '../../../src/services/parsing/tv-inline/DateBlockLocator';

/** Slice helper: the text a span selects from the line. */
const cut = (line: string, span: { start: number; end: number }) =>
    line.slice(span.start, span.end);

describe('locateDateBlock', () => {
    it('locates the block at raw line columns (checkbox prefix)', () => {
        const line = '- [ ] foo @2026-01-15T08:00>17:00';
        const loc = locateDateBlock(line)!;
        expect(cut(line, loc.block)).toBe('@2026-01-15T08:00>17:00');
        expect(cut(line, loc.start)).toBe('2026-01-15T08:00');
        expect(cut(line, loc.end!)).toBe('17:00');
        expect(loc.due).toBeUndefined();
    });

    it('handles indent and ordered-list markers', () => {
        const line = '\t1. [x] foo @2026-01-15';
        const loc = locateDateBlock(line)!;
        expect(cut(line, loc.block)).toBe('@2026-01-15');
        expect(cut(line, loc.start)).toBe('2026-01-15');
    });

    it('is unaffected by a trailing block id', () => {
        const line = '- [ ] foo @2026-01-15 ^abc-123';
        const loc = locateDateBlock(line)!;
        expect(cut(line, loc.block)).toBe('@2026-01-15');
    });

    it('gives the empty end of @start>>due a zero-width span', () => {
        const line = '- [ ] foo @2026-01-15>>2026-01-20';
        const loc = locateDateBlock(line)!;
        expect(loc.end).toBeDefined();
        expect(loc.end!.start).toBe(loc.end!.end);
        expect(cut(line, loc.due!)).toBe('2026-01-20');
    });

    it('ignores date-like text in the flow tail after ==>', () => {
        const line = '- [ ] foo ==> until @2026-01-15';
        expect(locateDateBlock(line)).toBeNull();
    });

    it('does not treat a bare @ as a block', () => {
        expect(locateDateBlock('- [ ] mail @alice about it')).toBeNull();
        expect(locateDateBlock('- [ ] plain task')).toBeNull();
    });

    it('spans the 3rd separator onward as extraSeparators', () => {
        const line = '- [ ] foo @2026-01-15>17:00>2026-01-20>18:00';
        const loc = locateDateBlock(line)!;
        expect(cut(line, loc.extraSeparators!)).toBe('>18:00');
    });

    it('collects extra blocks beyond the first', () => {
        const line = '- [ ] foo @2026-01-15 bar @2026-02-01';
        const loc = locateDateBlock(line)!;
        expect(cut(line, loc.block)).toBe('@2026-01-15');
        expect(loc.extraBlocks).toHaveLength(1);
        expect(cut(line, loc.extraBlocks[0])).toBe('@2026-02-01');
    });
});

describe('spansForRule', () => {
    const line = '- [ ] foo @2026-01-15T08:00>07:00>2026-01-20';
    const loc = locateDateBlock(line)!;

    it('maps time/date-order rules to the end segment', () => {
        for (const rule of [
            'cross-midnight', 'same-day-inversion',
            'end-before-start', 'end-time-without-start',
        ] as const) {
            const spans = spansForRule(rule, loc);
            expect(spans).toHaveLength(1);
            expect(cut(line, spans[0])).toBe('07:00');
        }
    });

    it('maps due-without-date to the due segment', () => {
        const spans = spansForRule('due-without-date', loc);
        expect(cut(line, spans[0])).toBe('2026-01-20');
    });

    it('falls back to the whole block when the segment is absent or empty', () => {
        const startOnly = locateDateBlock('- [ ] foo @2026-01-15')!;
        expect(spansForRule('end-before-start', startOnly)).toEqual([startOnly.block]);

        const emptyEnd = locateDateBlock('- [ ] foo @2026-01-15>>2026-01-20')!;
        expect(spansForRule('cross-midnight', emptyEnd)).toEqual([emptyEnd.block]);

        expect(spansForRule('frontmatter-time-only', startOnly)).toEqual([startOnly.block]);
    });

    it('maps parse-error to extra separators and extra blocks', () => {
        const messy = '- [ ] foo @2026-01-15>17:00>2026-01-20>18:00 bar @2026-02-01';
        const messyLoc = locateDateBlock(messy)!;
        const spans = spansForRule('parse-error', messyLoc);
        expect(spans.map(s => cut(messy, s))).toEqual(['>18:00', '@2026-02-01']);
    });

    it('falls back to the block for parse-error without structural spans', () => {
        const clean: DateBlockLocation = locateDateBlock('- [ ] foo @2026-01-15')!;
        expect(spansForRule('parse-error', clean)).toEqual([clean.block]);
    });
});
