import { describe, it, expect } from 'vitest';
import { TaskCloner } from '../../../src/services/persistence/TaskCloner';
import { recordEdits } from '../../../src/utils/FileLines';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import type { App } from 'obsidian';

// Access private methods via prototype
const proto = TaskCloner.prototype as any;

function callShiftInlineDates(line: string, dayOffset: number): string {
    return proto.shiftInlineDates.call(null, line, dayOffset);
}

// spliceCopies only reads lines and fileOps; the vault is never touched.
const fileOps = new FileOperations({} as App);

function callSpliceCopies(
    lines: string[],
    taskLine: number,
    parentLines: string[],
    position: 'before' | 'after',
): string[] {
    return spliceAndReport(lines, taskLine, parentLines, position).lines;
}

/**
 * The lines a copy produced, and what it said it did to them.
 *
 * Through the real {@link recordEdits}, over the array the copy is about to
 * splice — the same object `processLines` hands a write. A stand-in here would
 * be a second implementation of the arithmetic this file exists to check.
 */
function spliceAndReport(
    lines: string[],
    taskLine: number,
    parentLines: string[],
    position: 'before' | 'after',
) {
    const target = [...lines];
    const { edits, reported } = recordEdits(target);
    const out: string[] = proto.spliceCopies.call(
        { fileOps }, target, taskLine, parentLines, position, edits);
    return { lines: out, reported };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskCloner', () => {

    describe('shiftInlineDates', () => {
        it('shifts date-only @notation by +1 day', () => {
            expect(callShiftInlineDates('- [ ] Task @2026-03-11', 1))
                .toBe('- [ ] Task @2026-03-12');
        });

        it('shifts start and end dates', () => {
            expect(callShiftInlineDates('- [ ] Task @2026-03-11T09:00>2026-03-11T17:00', 1))
                .toBe('- [ ] Task @2026-03-12T09:00>2026-03-12T17:00');
        });

        it('does NOT shift due (3rd segment)', () => {
            expect(callShiftInlineDates('- [ ] Task @2026-03-11>2026-03-12>2026-03-20', 1))
                .toBe('- [ ] Task @2026-03-12>2026-03-13>2026-03-20');
        });

        it('time-only notation is unchanged', () => {
            expect(callShiftInlineDates('- [ ] Task @09:00>10:00', 1))
                .toBe('- [ ] Task @09:00>10:00');
        });

        it('handles month boundary', () => {
            expect(callShiftInlineDates('- [ ] Task @2026-03-31', 1))
                .toBe('- [ ] Task @2026-04-01');
        });

        it('line without @notation is unchanged', () => {
            const line = '- [ ] Plain task without date';
            expect(callShiftInlineDates(line, 5)).toBe(line);
        });
    });

    describe('spliceCopies', () => {
        const file = [
            '# note',
            '',
            '- [ ] parent @2026-03-11T10:00>11:00',
            '\t- [ ] child ^abc',
            '\tmemo',
            '- [ ] next',
        ];

        it('puts an in-place copy after the original and its children', () => {
            // Later in the day reads later in the file.
            expect(callSpliceCopies(file, 2, ['- [ ] copy @2026-03-11T11:00>12:00'], 'after'))
                .toEqual([
                    '# note',
                    '',
                    '- [ ] parent @2026-03-11T10:00>11:00',
                    '\t- [ ] child ^abc',
                    '\tmemo',
                    '- [ ] copy @2026-03-11T11:00>12:00',
                    '\t- [ ] child',
                    '\tmemo',
                    '- [ ] next',
                ]);
        });

        it('puts a day-shifted copy before the original, newest first', () => {
            expect(callSpliceCopies(file, 2, ['- [ ] copy @2026-03-12T10:00>11:00'], 'before'))
                .toEqual([
                    '# note',
                    '',
                    '- [ ] copy @2026-03-12T10:00>11:00',
                    '\t- [ ] child',
                    '\tmemo',
                    '- [ ] parent @2026-03-11T10:00>11:00',
                    '\t- [ ] child ^abc',
                    '\tmemo',
                    '- [ ] next',
                ]);
        });

        it('gives every copy its own set of the children', () => {
            const out = callSpliceCopies(file, 2, ['- [ ] a', '- [ ] b'], 'after');

            expect(out.slice(5)).toEqual([
                '- [ ] a', '\t- [ ] child', '\tmemo',
                '- [ ] b', '\t- [ ] child', '\tmemo',
                '- [ ] next',
            ]);
        });

        it('strips the block id from the copied children only', () => {
            const out = callSpliceCopies(file, 2, ['- [ ] copy'], 'after');

            // The original keeps its anchor; the copies never carry one.
            expect(out[3]).toBe('\t- [ ] child ^abc');
            expect(out.filter(l => l.includes('^abc'))).toHaveLength(1);
        });

        it('clears the whole indented region, not just the parsed children', () => {
            // The parser ends the children at the blank line, but what follows
            // it still reads as the task's. A copy dropped at the end of the
            // parsed children would land in the middle of them.
            const withGap = [
                '- [ ] p @2026-03-11T10:00>11:00',
                '\t- c1',
                '',
                '\t- c2',
                '- [ ] n',
            ];

            expect(callSpliceCopies(withGap, 0, ['- [ ] copy'], 'after')).toEqual([
                '- [ ] p @2026-03-11T10:00>11:00',
                '\t- c1',
                '',
                '\t- c2',
                '- [ ] copy',
                '\t- c1',
                '- [ ] n',
            ]);
        });

        it('does not cut a child code fence that has a blank line in it', () => {
            const withFence = [
                '- [ ] p @2026-03-11T10:00>11:00',
                '\t```js',
                '\tconst a = 1;',
                '',
                '\tconst b = 2;',
                '\t```',
                '- [ ] n',
            ];

            const out = callSpliceCopies(withFence, 0, ['- [ ] copy'], 'after');

            // The fence closes before the copy begins.
            expect(out.indexOf('- [ ] copy')).toBeGreaterThan(out.lastIndexOf('\t```'));
        });

        it('leaves everything below the task alone when copying before it', () => {
            const withGap = [
                '- [ ] p @2026-03-11T10:00>11:00',
                '\t- c1',
                '',
                '\t- c2',
            ];

            expect(callSpliceCopies(withGap, 0, ['- [ ] copy'], 'before').slice(2)).toEqual([
                '- [ ] p @2026-03-11T10:00>11:00',
                '\t- c1',
                '',
                '\t- c2',
            ]);
        });
    });
});

describe('what a copy reports', () => {
    const file = [
        '- [ ] parent @2026-03-11T10:00>11:00',
        '\t- [ ] child ^abc',
        '\tmemo',
        '- [ ] next',
    ];

    it('names every line it inserted, and nothing else', () => {
        // The report is lines, not rows: `memo` is no task and the copy does
        // not pretend to know. What it is saying is "these are mine" — the
        // index parses the result to see which of them are tasks.
        const { lines, reported } = spliceAndReport(
            file, 0, ['- [ ] copy @2026-03-11T11:00>12:00'], 'after');

        expect(reported).toEqual([{ kind: 'inserted', at: 3, count: 3 }]);
        expect(lines.slice(3, 6)).toEqual([
            '- [ ] copy @2026-03-11T11:00>12:00',
            '\t- [ ] child',
            '\tmemo',
        ]);
    });

    it('counts every copy when several are written at once', () => {
        const { reported } = spliceAndReport(
            file, 0, ['- [ ] a', '- [ ] b'], 'before');

        expect(reported).toEqual([{ kind: 'inserted', at: 0, count: 6 }]);
    });
});
