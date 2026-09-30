import { describe, it, expect } from 'vitest';
import {
    readDateBlock,
    readLineDateBlock,
    spansForRule,
    type DateBlockReading,
} from '../../../src/services/parsing/tv-inline/DateBlock';

/** Slice helper: the text a span selects from the line. */
const cut = (line: string, span: { start: number; end: number }) =>
    line.slice(span.start, span.end);

describe('readLineDateBlock', () => {
    it('locates the block at raw line columns (checkbox prefix)', () => {
        const line = '- [ ] foo @2026-01-15T08:00>17:00';
        const loc = readLineDateBlock(line)!;
        expect(cut(line, loc.block)).toBe('@2026-01-15T08:00>17:00');
        expect(cut(line, loc.start)).toBe('2026-01-15T08:00');
        expect(cut(line, loc.end!)).toBe('17:00');
        expect(loc.due).toBeUndefined();
    });

    it('handles indent and ordered-list markers', () => {
        const line = '\t1. [x] foo @2026-01-15';
        const loc = readLineDateBlock(line)!;
        expect(cut(line, loc.block)).toBe('@2026-01-15');
        expect(cut(line, loc.start)).toBe('2026-01-15');
    });

    it('is unaffected by a trailing block id', () => {
        const line = '- [ ] foo @2026-01-15 ^abc-123';
        const loc = readLineDateBlock(line)!;
        expect(cut(line, loc.block)).toBe('@2026-01-15');
    });

    it('gives the empty end of @start>>due a zero-width span', () => {
        const line = '- [ ] foo @2026-01-15>>2026-01-20';
        const loc = readLineDateBlock(line)!;
        expect(loc.end).toBeDefined();
        expect(loc.end!.start).toBe(loc.end!.end);
        expect(cut(line, loc.due!)).toBe('2026-01-20');
    });

    it('ignores date-like text in the flow tail after ==>', () => {
        const line = '- [ ] foo ==> until @2026-01-15';
        expect(readLineDateBlock(line)).toBeNull();
    });

    it('reads the same text as the parser: past the ^id, before the command', () => {
        const line = '- [ ] foo @2026-01-15 ==> next @2026-02-01 ^abc';
        const loc = readLineDateBlock(line)!;
        expect(cut(line, loc.block)).toBe('@2026-01-15');
        expect(loc.extraBlocks).toEqual([]);
    });

    it('skips a bare @ before the block', () => {
        const line = '- [ ] @1on1 sync @2026-01-15';
        const loc = readLineDateBlock(line)!;
        expect(cut(line, loc.block)).toBe('@2026-01-15');
        expect(loc.values.startDate).toBe('2026-01-15');
    });

    it('is null for a line that is no task', () => {
        expect(readLineDateBlock('- foo @2026-01-15')).toBeNull();
    });

    it('does not treat a bare @ as a block', () => {
        expect(readLineDateBlock('- [ ] mail @alice about it')).toBeNull();
        expect(readLineDateBlock('- [ ] plain task')).toBeNull();
    });

    it('spans the 3rd separator onward as extraSeparators', () => {
        const line = '- [ ] foo @2026-01-15>17:00>2026-01-20>18:00';
        const loc = readLineDateBlock(line)!;
        expect(cut(line, loc.extraSeparators!)).toBe('>18:00');
    });

    it('collects extra blocks beyond the first', () => {
        const line = '- [ ] foo @2026-01-15 bar @2026-02-01';
        const loc = readLineDateBlock(line)!;
        expect(cut(line, loc.block)).toBe('@2026-01-15');
        expect(loc.extraBlocks).toHaveLength(1);
        expect(cut(line, loc.extraBlocks[0].span)).toBe('@2026-02-01');
        expect(loc.extraBlocks[0].text).toBe('@2026-02-01');
    });
});

describe('readDateBlock', () => {
    it('reads the values of the first block', () => {
        expect(readDateBlock('x @2026-01-15T08:00>2026-01-16T09:30>2026-01-20T12:00')!.values).toEqual({
            startDate: '2026-01-15', startTime: '08:00',
            endDate: '2026-01-16', endTime: '09:30',
            due: '2026-01-20T12:00',
        });
        expect(readDateBlock('x @T09:00>10:00')!.values).toEqual({ startDate: '', startTime: '09:00', endTime: '10:00' });
        expect(readDateBlock('x @>>2026-01-20')!.values).toEqual({ startDate: '', due: '2026-01-20' });
    });

    it('counts the separators of the first block', () => {
        expect(readDateBlock('x @2026-01-15>>2026-01-20')!.separators).toBe(2);
        expect(readDateBlock('x @2026-01-15>17:00>2026-01-20>18:00')!.separators).toBe(3);
    });

    it('reads the empty block @> as no dates', () => {
        const reading = readDateBlock('x @> @2026-02-02')!;
        expect(reading.values).toEqual({ startDate: '' });
        expect(reading.extraBlocks.map(e => e.text)).toEqual(['@2026-02-02']);
    });
});

describe('spansForRule', () => {
    const line = '- [ ] foo @2026-01-15T08:00>07:00>2026-01-20';
    const loc = readLineDateBlock(line)!;

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
        const startOnly = readLineDateBlock('- [ ] foo @2026-01-15')!;
        expect(spansForRule('end-before-start', startOnly)).toEqual([startOnly.block]);

        const emptyEnd = readLineDateBlock('- [ ] foo @2026-01-15>>2026-01-20')!;
        expect(spansForRule('cross-midnight', emptyEnd)).toEqual([emptyEnd.block]);
    });

    it('maps parse-error to extra separators and extra blocks', () => {
        const messy = '- [ ] foo @2026-01-15>17:00>2026-01-20>18:00 bar @2026-02-01';
        const messyLoc = readLineDateBlock(messy)!;
        const spans = spansForRule('parse-error', messyLoc);
        expect(spans.map(s => cut(messy, s))).toEqual(['>18:00', '@2026-02-01']);
    });

    it('falls back to the block for parse-error without structural spans', () => {
        const clean: DateBlockReading = readLineDateBlock('- [ ] foo @2026-01-15')!;
        expect(spansForRule('parse-error', clean)).toEqual([clean.block]);
    });
});

describe('DATE_BLOCK_REGEX', () => {
    it('is the date block grammar, built from the date module\'s shapes', async () => {
        const { DATE_BLOCK_REGEX } = await import('../../../src/services/parsing/tv-inline/DateBlock');
        expect(DATE_BLOCK_REGEX.source).toBe(
            String.raw`(@(?=[\d>T])(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?|T?\d{2}:\d{2})?(?:>(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?|\d{2}:\d{2})?)*)`,
        );
        expect(DATE_BLOCK_REGEX.flags).toBe('');
    });
});
