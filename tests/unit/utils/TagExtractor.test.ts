import { describe, it, expect } from 'vitest';
import { TagExtractor } from '../../../src/services/parsing/utils/TagExtractor';

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

        it('takes no tag inside a link\'s target or code', () => {
            expect(TagExtractor.fromContent('see [[報告書#見出し]] #work')).toEqual(['work']);
            expect(TagExtractor.fromContent('see [[note#heading]]')).toEqual([]);
            expect(TagExtractor.fromContent('run `#x` now')).toEqual([]);
            expect(TagExtractor.fromContent('![[画像#部分]] [見出し](#anchor) ![#alt](u)')).toEqual([]);
        });

        it('takes a tag in a Markdown link\'s shown text, as Obsidian does', () => {
            expect(TagExtractor.fromContent('[#t](u) [#ref]')).toEqual(['ref', 't']);
        });

        it('takes a tag right after a link, as it always did', () => {
            expect(TagExtractor.fromContent('[[x]]#after')).toEqual(['after']);
        });

        it('does not match # at word start', () => {
            // \B requires non-word boundary before #
            expect(TagExtractor.fromContent('item #tag')).toEqual(['tag']);
        });
    });

    describe('fromFrontmatter', () => {
        it('handles string array', () => {
            expect(TagExtractor.fromFrontmatter({ tags: ['work', 'urgent'] })).toEqual(['urgent', 'work']);
        });

        it('reads a text as a list of one: a list written with commas is no tag', () => {
            expect(TagExtractor.fromFrontmatter({ tags: 'work, urgent' })).toEqual([]);
            expect(TagExtractor.fromFrontmatter({ tags: 'work' })).toEqual(['work']);
        });

        it('strips one # prefix', () => {
            expect(TagExtractor.fromFrontmatter({ tags: ['#work', '#play', '##two'] })).toEqual(['play', 'work']);
        });

        it('returns empty for no tags', () => {
            expect(TagExtractor.fromFrontmatter({ tags: null })).toEqual([]);
            expect(TagExtractor.fromFrontmatter({})).toEqual([]);
            expect(TagExtractor.fromFrontmatter(undefined)).toEqual([]);
        });

        it('filters empty strings', () => {
            expect(TagExtractor.fromFrontmatter({ tags: ['work', '', '  '] })).toEqual(['work']);
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
