import { describe, it, expect } from 'vitest';
import { getTaskKind, getTaskNotation } from '../../../src/services/filter/parserTaxonomy';

describe('parserTaxonomy', () => {
    describe('getTaskKind', () => {
        it('tv-file → file', () => {
            expect(getTaskKind('tv-file')).toBe('file');
        });

        it('tv-inline → inline', () => {
            expect(getTaskKind('tv-inline')).toBe('inline');
        });

        it('tasks-plugin → inline', () => {
            expect(getTaskKind('tasks-plugin')).toBe('inline');
        });

        it('day-planner → inline', () => {
            expect(getTaskKind('day-planner')).toBe('inline');
        });
        // No fallback test: ParserId is a closed union, unknown values cannot
        // reach getTaskKind without a type assertion. Switch is exhaustive.
    });

    describe('getTaskNotation', () => {
        it('tv-inline → taskviewer', () => {
            expect(getTaskNotation('tv-inline')).toBe('taskviewer');
        });

        it('tv-file → taskviewer (same family)', () => {
            expect(getTaskNotation('tv-file')).toBe('taskviewer');
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
