import { describe, it, expect } from 'vitest';
import { TaskCloner } from '../../../src/services/persistence/TaskCloner';

// Access private methods via prototype
const proto = TaskCloner.prototype as any;

function callShiftInlineDates(line: string, dayOffset: number): string {
    return proto.shiftInlineDates.call(null, line, dayOffset);
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
});
