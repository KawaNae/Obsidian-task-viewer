import { describe, it, expect } from 'vitest';
import { TaskCloner } from '../../../src/services/persistence/TaskCloner';
import { draftOver, replayEdits } from '../../../src/utils/FileLines';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { checkWrite, type WrittenLine } from '../../../src/services/parsing/utils/OutlineCheck';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { Placement } from '../../../src/services/persistence/utils/Placement';
import type { App } from 'obsidian';

// Access private methods via prototype
const proto = TaskCloner.prototype as any;

function callShiftInlineDates(line: string, dayOffset: number): string {
    return proto.shiftInlineDates.call(null, line, dayOffset);
}

// putCopies only reads lines and fileOps; the vault is never touched.
const fileOps = new FileOperations({} as App);

function callSpliceCopies(
    lines: string[],
    taskLine: number,
    parentLines: string[],
    position: 'before' | 'after',
): string[] {
    const { lines: written, check } = spliceAndReport(lines, taskLine, parentLines, position);
    expect(check).toBe('sound');
    return written;
}

/**
 * The lines a copy produced, and what it said it did to them.
 *
 * Through the real {@link draftOver}, over the array the copy is about to
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
    // Where the two duplicate paths put their copies.
    const spot = Placement.copyOf(Outline.read(target), taskLine, position === 'before' ? 'above' : 'below', '- [ ] n');
    const { draft, reported, puts, placedBy } = draftOver(target);
    proto.putCopies.call({ fileOps }, draft, taskLine, parentLines, spot);
    // Every copy reads as the original's subtree does, and every other line
    // as it did: the check the write is held to (`checkWrite`).
    const replayed = replayEdits(lines.length, reported, placedBy)!;
    const written = replayed.origin.map((from, k): WrittenLine => {
        const put = replayed.placed[k];
        if (put) return { kind: 'placed', put: put.id, offset: put.offset };
        return from === null ? { kind: 'loose' } : { kind: 'kept', from };
    });
    const { check } = checkWrite(Outline.read(lines), Outline.read(target), written, puts);
    return { lines: target, reported, check };
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

    describe('putCopies', () => {
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

        it('copies the children below a blank line too, and goes after all of them', () => {
            // The blank line is inside the subtree: what follows it is the
            // task's, for the parser and for the copy alike.
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
                '',
                '\t- c2',
                '- [ ] n',
            ]);
        });

        it('copies a child code fence that has a blank line in it whole', () => {
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

            // The original's fence closes before the copy begins, and the copy
            // carries a fence that closes too.
            expect(out).toEqual([...withFence.slice(0, 6), '- [ ] copy', ...withFence.slice(1, 6), '- [ ] n']);
        });

        it('leaves everything below the task alone when copying before it', () => {
            const withGap = [
                '- [ ] p @2026-03-11T10:00>11:00',
                '\t- c1',
                '',
                '\t- c2',
            ];

            expect(callSpliceCopies(withGap, 0, ['- [ ] copy'], 'before').slice(4)).toEqual([
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
