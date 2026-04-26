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

        it('unknown parserId → inline (non-file fallback)', () => {
            expect(getTaskKind('xyz-unknown')).toBe('inline');
        });
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

        it('unknown parserId → taskviewer (fallback)', () => {
            expect(getTaskNotation('xyz-unknown')).toBe('taskviewer');
        });
    });
});
