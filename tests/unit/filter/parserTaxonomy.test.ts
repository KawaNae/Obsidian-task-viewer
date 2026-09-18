import { describe, it, expect } from 'vitest';
import { getTaskNotation } from '../../../src/services/filter/parserTaxonomy';

describe('parserTaxonomy', () => {
    describe('getTaskNotation', () => {
        it('tv-inline → taskviewer', () => {
            expect(getTaskNotation('tv-inline')).toBe('taskviewer');
        });

        it('tasks-plugin → tasks', () => {
            expect(getTaskNotation('tasks-plugin')).toBe('tasks');
        });

        it('day-planner → dayplanner', () => {
            expect(getTaskNotation('day-planner')).toBe('dayplanner');
        });
        // No fallback test: ParserId is a closed union, unknown values cannot
        // reach getTaskNotation without a type assertion. Switch is exhaustive.
    });
});
