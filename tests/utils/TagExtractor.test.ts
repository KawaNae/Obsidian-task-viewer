import { describe, it, expect } from 'vitest';
import { TagExtractor } from '../../src/services/parsing/utils/TagExtractor';

describe('TagExtractor', () => {
    describe('fromContent', () => {
        it('extracts single tag', () => {
            expect(TagExtractor.fromContent('task #work done')).toEqual(['work']);
        });

        it('extracts multiple tags sorted', () => {
            expect(TagExtractor.fromContent('#urgent task #work')).toEqual(['urgent', 'work']);
        });

        it('deduplicates', () => {
            expect(TagExtractor.fromContent('#work #work')).toEqual(['work']);
        });

        it('handles nested tags', () => {
            expect(TagExtractor.fromContent('#project/sub')).toEqual(['project/sub']);
        });

        it('returns empty for no tags', () => {
            expect(TagExtractor.fromContent('plain text')).toEqual([]);
        });

        it('does not match # at word start', () => {
            // \B requires non-word boundary before #
            expect(TagExtractor.fromContent('item #tag')).toEqual(['tag']);
        });
    });

    describe('fromFrontmatter', () => {
        it('handles string array', () => {
            expect(TagExtractor.fromFrontmatter(['work', 'urgent'])).toEqual(['urgent', 'work']);
        });

        it('handles comma-separated string', () => {
            expect(TagExtractor.fromFrontmatter('work, urgent')).toEqual(['urgent', 'work']);
        });

        it('strips # prefix', () => {
            expect(TagExtractor.fromFrontmatter(['#work', '#play'])).toEqual(['play', 'work']);
        });

        it('returns empty for null', () => {
            expect(TagExtractor.fromFrontmatter(null)).toEqual([]);
        });

        it('returns empty for undefined', () => {
            expect(TagExtractor.fromFrontmatter(undefined)).toEqual([]);
        });

        it('filters empty strings', () => {
            expect(TagExtractor.fromFrontmatter(['work', '', '  '])).toEqual(['work']);
        });
    });

    describe('merge', () => {
        it('merges and deduplicates', () => {
            expect(TagExtractor.merge(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
        });

        it('handles empty arrays', () => {
            expect(TagExtractor.merge([], ['a'])).toEqual(['a']);
        });

        it('sorts result', () => {
            expect(TagExtractor.merge(['z', 'a'], ['m'])).toEqual(['a', 'm', 'z']);
        });
    });
});
