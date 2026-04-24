import { describe, it, expect } from 'vitest';
import { getTaskKind, getTaskNotation } from '../../../src/services/filter/parserTaxonomy';

describe('parserTaxonomy', () => {
    describe('getTaskKind', () => {
        it('frontmatter → file', () => {
            expect(getTaskKind('frontmatter')).toBe('file');
        });

        it('at-notation → inline', () => {
            expect(getTaskKind('at-notation')).toBe('inline');
        });

        it('plain → inline', () => {
            expect(getTaskKind('plain')).toBe('inline');
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
        it('at-notation → taskviewer', () => {
            expect(getTaskNotation('at-notation')).toBe('taskviewer');
        });

        it('frontmatter → taskviewer (same family)', () => {
            expect(getTaskNotation('frontmatter')).toBe('taskviewer');
        });

        it('tasks-plugin → tasks', () => {
            expect(getTaskNotation('tasks-plugin')).toBe('tasks');
        });

        it('day-planner → dayplanner', () => {
            expect(getTaskNotation('day-planner')).toBe('dayplanner');
        });

        it('plain → taskviewer (merged: PlainTaskParser is part of TaskViewer)', () => {
            expect(getTaskNotation('plain')).toBe('taskviewer');
        });

        it('unknown parserId → taskviewer (fallback)', () => {
            expect(getTaskNotation('xyz-unknown')).toBe('taskviewer');
        });
    });
});
