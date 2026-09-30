import { describe, it, expect } from 'vitest';
import { TaskLineClassifier } from '../../../src/services/parsing/utils/TaskLineClassifier';

describe('TaskLineClassifier', () => {
    describe('stripBlockIds', () => {
        it('removes block IDs', () => {
            const result = TaskLineClassifier.stripBlockIds(['- [ ] task ^abc123']);
            expect(result).toEqual(['- [ ] task']);
        });

        it('preserves lines without block IDs', () => {
            const result = TaskLineClassifier.stripBlockIds(['- [ ] task', 'plain text']);
            expect(result).toEqual(['- [ ] task', 'plain text']);
        });

        it('handles multiple lines', () => {
            const result = TaskLineClassifier.stripBlockIds([
                '- [ ] first ^id1',
                '    child',
                '- [ ] second ^id2',
            ]);
            expect(result).toEqual(['- [ ] first', '    child', '- [ ] second']);
        });

        it('does not remove caret that is not a valid block ID', () => {
            const result = TaskLineClassifier.stripBlockIds(['text with ^caret mid-line']);
            // "^caret mid-line" contains spaces — not a valid block ID pattern
            expect(result[0]).toBe('text with ^caret mid-line');
        });

        it('removes valid trailing block ID with hyphens', () => {
            const result = TaskLineClassifier.stripBlockIds(['text ^my-block-id']);
            expect(result[0]).toBe('text');
        });

        it('removes an ID the parser reads, trailing space and all', () => {
            // The reading has to match the one every parser uses: a stricter
            // one leaves the copy claiming the original's anchor.
            const result = TaskLineClassifier.stripBlockIds(['- [ ] task ^abc ']);
            expect(result[0]).toBe('- [ ] task');
        });
    });
});
