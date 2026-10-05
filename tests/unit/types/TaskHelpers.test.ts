import { describe, it, expect } from 'vitest';
import {
    isTvInline,
    isDpInline,
    isTpInline,
    isCompleteStatusChar,
    type StatusDefinition,
} from '../../../src/types';


describe('isTvInline', () => {
    it('matches only parserId==="tv-inline"', () => {
        expect(isTvInline({ parserId: 'tv-inline' })).toBe(true);
        expect(isTvInline({ parserId: 'tasks-plugin' })).toBe(false);
        expect(isTvInline({ parserId: 'day-planner' })).toBe(false);
    });
});

describe('isDpInline', () => {
    it('matches only parserId==="day-planner"', () => {
        expect(isDpInline({ parserId: 'day-planner' })).toBe(true);
        expect(isDpInline({ parserId: 'tv-inline' })).toBe(false);
    });
});

describe('isTpInline', () => {
    it('matches only parserId==="tasks-plugin"', () => {
        expect(isTpInline({ parserId: 'tasks-plugin' })).toBe(true);
        expect(isTpInline({ parserId: 'tv-inline' })).toBe(false);
    });
});

describe('isCompleteStatusChar', () => {
    const defsWithBlankMarkedComplete: StatusDefinition[] = [
        { char: ' ', label: 'Todo', isComplete: true }, // as if set via the settings toggle, or loaded from a stale data.json
        { char: 'x', label: 'Done', isComplete: true },
        { char: '-', label: 'Cancelled', isComplete: true },
    ];

    it('never treats blank as complete, even when a definition says so', () => {
        // G1: a flow's next instance is always written as `[ ]`. If blank
        // could read as complete, every instance would read as done the
        // moment it lands (see isCompleteStatusChar).
        expect(isCompleteStatusChar(' ', defsWithBlankMarkedComplete)).toBe(false);
    });

    it('still answers from settings for every other char', () => {
        expect(isCompleteStatusChar('x', defsWithBlankMarkedComplete)).toBe(true);
        expect(isCompleteStatusChar('-', defsWithBlankMarkedComplete)).toBe(true);
    });

    it('returns false for blank with the ordinary (not-complete) default too', () => {
        const defs: StatusDefinition[] = [
            { char: ' ', label: 'Todo', isComplete: false },
            { char: 'x', label: 'Done', isComplete: true },
        ];
        expect(isCompleteStatusChar(' ', defs)).toBe(false);
    });

    it('returns false when no definition matches the char at all', () => {
        expect(isCompleteStatusChar('?', [])).toBe(false);
    });
});

