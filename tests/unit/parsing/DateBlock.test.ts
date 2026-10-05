import { describe, it, expect } from 'vitest';
import {
    readDateBlock,
    readLineDateBlock,
    shiftLineDates,
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

    // A block naming a day or a time that does not exist is not read: none of
    // its dates, not the readable part either, and no later block in its place.
    it('reads no dates of a block naming a day or a time that does not exist', () => {
        for (const text of ['x @2026-02-30', 'x @2026-13-45', 'x @2026-03-01T25:00', 'x @2026-03-01>2026-02-29', 'x @09:00>24:00', 'x @>>2025-02-29']) {
            const reading = readDateBlock(text)!;
            expect(reading.values, text).toEqual({ startDate: '' });
            expect(reading.unread, text).toHaveLength(1);
        }
    });

    it('marks each segment that does not read, and does not take a later block for the dates', () => {
        const text = 'x @2026-02-30>2026-03-01T99:99>2026-03-02 @2026-03-05';
        const reading = readDateBlock(text)!;
        expect(reading.values).toEqual({ startDate: '' });
        expect(reading.unread!.map(span => cut(text, span))).toEqual(['2026-02-30', '2026-03-01T99:99']);
        expect(reading.extraBlocks.map(e => e.text)).toEqual(['@2026-03-05']);
    });

    it('reads a block whose days exist, a leap day included', () => {
        const reading = readDateBlock('x @2028-02-29')!;
        expect(reading.values).toEqual({ startDate: '2028-02-29' });
        expect(reading.unread).toBeUndefined();
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

    it('maps parse-error to the segments that do not read', () => {
        const line = '- [ ] foo @2026-01-15>2026-02-30 bar @2026-02-01';
        const spans = spansForRule('parse-error', readLineDateBlock(line)!);
        expect(spans.map(s => cut(line, s))).toEqual(['2026-02-30', '@2026-02-01']);
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

describe('shiftLineDates', () => {
    const all = ['start', 'end', 'due'] as const;

    it('shifts a date-only block by +1 day', () => {
        expect(shiftLineDates('- [ ] Task @2026-03-11', 1, all)).toBe('- [ ] Task @2026-03-12');
    });

    it('shifts start and end, each written as it was', () => {
        // The end keeps its date though it falls on the start's day: the
        // line is the user's, and only its dates move.
        expect(shiftLineDates('- [ ] Task @2026-03-11T09:00>2026-03-11T17:00', 1, all))
            .toBe('- [ ] Task @2026-03-12T09:00>2026-03-12T17:00');
        expect(shiftLineDates('- [ ] Task @2026-03-11T09:00>2026-03-11', 1, all))
            .toBe('- [ ] Task @2026-03-12T09:00>2026-03-12');
        expect(shiftLineDates('- [ ] Task @2026-03-11>', 1, all)).toBe('- [ ] Task @2026-03-12>');
    });

    it('shifts the due when asked to', () => {
        expect(shiftLineDates('- [ ] Task @2026-03-11>2026-03-12>2026-03-20', 1, all))
            .toBe('- [ ] Task @2026-03-12>2026-03-13>2026-03-21');
        expect(shiftLineDates('- [ ] Task @>>2026-03-20T18:00', 1, all)).toBe('- [ ] Task @>>2026-03-21T18:00');
    });

    it('shifts only the fields asked for', () => {
        expect(shiftLineDates('- [ ] Task @2026-03-11>2026-03-12>2026-03-20', 1, ['start', 'end']))
            .toBe('- [ ] Task @2026-03-12>2026-03-13>2026-03-20');
    });

    it('leaves a time-only segment unchanged', () => {
        expect(shiftLineDates('- [ ] Task @09:00>10:00', 1, all)).toBe('- [ ] Task @09:00>10:00');
        expect(shiftLineDates('- [ ] Task @2026-03-11T09:00>17:00', 1, all)).toBe('- [ ] Task @2026-03-12T09:00>17:00');
    });

    it('handles a month boundary', () => {
        expect(shiftLineDates('- [ ] Task @2026-03-31', 1, all)).toBe('- [ ] Task @2026-04-01');
    });

    it('leaves a date in the command alone (the parser reads no block there)', () => {
        expect(shiftLineDates('- [ ] Task ==> until @2026-03-11', 1, all)).toBe('- [ ] Task ==> until @2026-03-11');
        expect(shiftLineDates('- [ ] Task @2026-03-11 ==> until @2026-03-11', 1, all))
            .toBe('- [ ] Task @2026-03-12 ==> until @2026-03-11');
    });

    it('shifts the block past a bare @ (the block the parser reads), and no extra block', () => {
        expect(shiftLineDates('- [ ] @1on1 sync @2026-03-11', 1, all)).toBe('- [ ] @1on1 sync @2026-03-12');
        expect(shiftLineDates('- [ ] Task @2026-03-11 @2026-03-15', 1, all)).toBe('- [ ] Task @2026-03-12 @2026-03-15');
    });

    it('rewords nothing outside the dates', () => {
        expect(shiftLineDates('- [ ] Task @2026-03-11 #tag [p:: 1]  ', 1, all)).toBe('- [ ] Task @2026-03-12 #tag [p:: 1]  ');
        expect(shiftLineDates('1. [ ] @2026-03-11 Task  at head', 1, all)).toBe('1. [ ] @2026-03-12 Task  at head');
        expect(shiftLineDates('\t* [x] Task @2026-03-11T9:00', 1, all)).toBe('\t* [x] Task @2026-03-12T9:00');
    });

    it('leaves a block that does not read unchanged: it has no dates to move', () => {
        for (const line of ['- [ ] Task @2026-02-30', '- [ ] Task @2026-03-01>2026-13-01', '- [ ] Task @2026-03-01T25:00']) {
            expect(shiftLineDates(line, 1, all)).toBe(line);
        }
    });

    it('leaves a line without a block unchanged', () => {
        const line = '- [ ] Plain task without date';
        expect(shiftLineDates(line, 5, all)).toBe(line);
    });
});
