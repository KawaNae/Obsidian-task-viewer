import { describe, it, expect } from 'vitest';
import { TaskCloner } from '../../../src/services/persistence/TaskCloner';
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
    return proto.spliceCopies.call({ fileOps }, [...lines], taskLine, parentLines, position);
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
    });
});
