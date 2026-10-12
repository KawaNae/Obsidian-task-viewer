import { describe, it, expect } from 'vitest';
import { TagRule } from '../../../src/services/parsing/utils/TagRule';
import { TagExtractor } from '../../../src/services/parsing/utils/TagExtractor';

/**
 * The rule against what Obsidian 1.14.4 read from the notes of the Dev
 * vault's `_tag-experiment/` (its metadata cache's tags of each line, and
 * `getTags()`): the same table, line by line.
 */
const read = (text: string) => TagExtractor.fromContent(text);

describe('TagRule, as Obsidian reads a tag', () => {
    // chars.md `in`: `#a<ch>b`.
    const HELD = ['-', '/', '_', '、', '。', '「', '」', '（', '）', '！', '？', '，', '．', '：', '；', '・', '〜', '～', '＃',
        '€', '£', '©', '°', '±', '×', '÷', '😀', 'é', 'ß', '中'];
    const ENDS = [...'!"#$%&\'()*+,.:;<=>?@[\\]^`{|}~', '…', '—', '–', '“', '”', '‘', '’', '\u3000', '\u00a0', '\u200b', ' '];

    it.each(HELD)('holds %j in a tag', (ch) => {
        expect(read(`#a${ch}b`)).toEqual([`a${ch}b`]);
        expect(TagRule.isWord(`a${ch}b`)).toBe(true);
    });

    it.each(ENDS)('ends a tag at %j', (ch) => {
        expect(read(`#a${ch}b`)).toEqual(ch === '#' ? ['a', 'b'] : ['a']);
        expect(TagRule.fault(`a${ch}b`)).toEqual({ kind: 'chars', chars: [ch] });
    });

    // chars.md `pr`: `x<ch>#tag`.
    it.each([' ', '\t', '\u3000', '\u00a0'])('begins a tag after whitespace %j', (ch) => {
        expect(read(`x${ch}#tag`)).toEqual(['tag']);
    });

    it.each([...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~', '、', '。', '「', '」', '（', '）', '！', '？', '，', '．', '：', '；', '・',
        '…', '—', '–', '“', '”', '‘', '’', '〜', '～', '＃', '\u200b', '€', '£', '©', '°', '±', '×', '÷', '😀', 'é', 'ß', '中'])(
        'begins no tag after %j', (ch) => {
            expect(read(`x${ch}#tag`)).toEqual([]);
        });

    // chars.md `nm`.
    it('reads no tag of ASCII digits alone', () => {
        expect(read('#123')).toEqual([]);
        expect(read('#1.5')).toEqual([]);
        expect(TagRule.fault('123')).toEqual({ kind: 'digitsOnly' });
        for (const tag of ['12/34', '1_2', '1-2', '-1', '_1', '/a', 'a/', 'a//b', '٣', '１２']) {
            expect(read(`#${tag}`), tag).toEqual([tag]);
        }
    });

    // lines.md.
    it('reads the lines as Obsidian does', () => {
        expect(read('日本語の#直後')).toEqual([]);
        expect(read('#comma, x')).toEqual(['comma']);
        expect(read('(#paren) x')).toEqual([]);
        expect(read('「#kagi」 x')).toEqual([]);
        expect(read('#touten、x')).toEqual(['touten、x']);
        expect(read('#semi; #colon: #bang! #q? x')).toEqual(['bang', 'colon', 'q', 'semi']);
        expect(read('#2026-10-12')).toEqual(['2026-10-12']);
        expect(read('#tag#tag2')).toEqual(['tag', 'tag2']);
        expect(read('abc#mid')).toEqual([]);
        expect(read('#ok/nested_tag-x')).toEqual(['ok/nested_tag-x']);
    });

    // fm-*.md: what getTags() lists of each frontmatter.
    it('takes a frontmatter item that is a tag\'s word without one leading #', () => {
        const of = (tags: unknown) => TagRule.ofFrontmatter({ tags });
        expect(of(['foo bar', 'a.b', '123', 'x,y', '(paren)', '日本語、句点。', '#one #two'])).toEqual(['日本語、句点。']);
        // `/` is a tag's word, which getTags() lists as nothing: it drops a trailing `/` (withParents).
        expect(of(['a#b', '#lead', '##dbl', 'tail#', 'a\tb', 'a　b', 'a b', '/', '#', 'a…b'])).toEqual(['lead', '/']);
        expect(TagRule.withParents('/')).toEqual([]);
        expect(of(['#hashed', 'Mixed/Case'])).toEqual(['hashed', 'Mixed/Case']);
        expect(of(['flowa', 'flowb'])).toEqual(['flowa', 'flowb']);
        expect(of(['fvt2 ', ' #fvh3'])).toEqual(['fvt2', 'fvh3']);
    });

    it('takes a frontmatter text as a list of one', () => {
        const of = (tags: unknown) => TagRule.ofFrontmatter({ tags });
        expect(of('alpha beta')).toEqual([]);
        expect(of('gamma, delta')).toEqual([]);
        expect(of('solo')).toEqual(['solo']);
    });

    // fmv-*.md: YAML's booleans, null and numbers are no text, and give no tag.
    it('takes no frontmatter item YAML reads as other than text', () => {
        const of = (tags: unknown) => TagRule.ofFrontmatter({ tags });
        expect(of([true, false, null, 123, 1.5, 'false', '2026-10-12', 'yes', '123'])).toEqual(['false', '2026-10-12', 'yes']);
        expect(of(true)).toEqual([]);
        expect(of(42)).toEqual([]);
        expect(of([['a', 'b'], { a: 'c' }, 'd'])).toEqual(['d']);
    });

    // fmk-*.md: the key is `tags` whatever its case; the first such key holds them.
    it('reads tags from the key tags whatever its case, the first one', () => {
        expect(TagRule.ofFrontmatter({ TAGS: ['a', 'b'] })).toEqual(['a', 'b']);
        expect(TagRule.ofFrontmatter({ Tags: 'c' })).toEqual(['c']);
        expect(TagRule.ofFrontmatter({ tags: 'first', Tags: 'second' })).toEqual(['first']);
        expect(TagRule.ofFrontmatter({ Tags: 'second', tags: 'first' })).toEqual(['second']);
        expect(TagRule.ofFrontmatter({ tag: 'single' })).toEqual([]);
        expect(TagRule.ofFrontmatter(undefined)).toEqual([]);
    });

    it('tells no case apart, and a tag is under the tags its / names', () => {
        expect(TagRule.key('CaseTag')).toBe(TagRule.key('casetag'));
        expect(TagRule.isUnder('Work/Sub', 'work')).toBe(true);
        expect(TagRule.isUnder('workshop', 'work')).toBe(false);
        expect(TagRule.withParents('ok/nested_tag-x')).toEqual(['ok/nested_tag-x', 'ok']);
        expect(TagRule.withParents('a/b/c')).toEqual(['a/b/c', 'a/b', 'a']);
        expect(TagRule.withParents('a/')).toEqual(['a']);
        expect(TagRule.withParents('a//b')).toEqual(['a//b', 'a']);
        expect(TagRule.withParents('/a')).toEqual(['/a']);
        expect(TagRule.withParents('123/a')).toEqual(['123/a']);
    });
});
