import { describe, it, expect } from 'vitest';
import { parseSortFlag } from '../../../src/cli/CliFilterBuilder';

describe('CliFilterBuilder', () => {
    describe('parseSortFlag', () => {
        it('parses property with direction', () => {
            expect(parseSortFlag('startDate:asc,due:desc')).toEqual([
                { property: 'startDate', direction: 'asc' },
                { property: 'due', direction: 'desc' },
            ]);
        });

        it('omits direction when not given (API default applies)', () => {
            expect(parseSortFlag('due')).toEqual([{ property: 'due' }]);
        });

        it('passes an invalid direction through untouched (validated by the API)', () => {
            expect(parseSortFlag('due:descc')).toEqual([{ property: 'due', direction: 'descc' }]);
        });
    });
});
