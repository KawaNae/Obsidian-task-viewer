import { describe, it, expect } from 'vitest';
import { scanNotation, withoutEmbeds } from '../../../src/services/parsing/utils/InlineNotation';

const kinds = (text: string) => scanNotation(text).map(n => `${n.kind}:${text.slice(n.start, n.end)}`);

describe('scanNotation', () => {
    it('cuts code, links, embeds and tags, in order', () => {
        expect(kinds('a `c #x` [[L#h|s]] ![[E]] [m](d#f) ![i](p) #tag')).toEqual([
            'code:`c #x`', 'wikilink:[[L#h|s]]', 'wikilink:![[E]]', 'markdown-link:[m](d#f)',
            'markdown-link:![i](p)', 'tag:#tag',
        ]);
    });

    it('gives a link its text and an embed its flag', () => {
        const [link, embed, md] = scanNotation('[[報告書#見出し|表示]] ![[画像.png]] [見る](a.md)');
        expect(link).toMatchObject({ kind: 'wikilink', embed: false, linktext: '報告書#見出し|表示' });
        expect(embed).toMatchObject({ kind: 'wikilink', embed: true, linktext: '画像.png' });
        expect(md).toMatchObject({ kind: 'markdown-link', embed: false, shown: '見る', destination: 'a.md' });
    });

    it('reads a code span by its backtick runs', () => {
        expect(kinds('``a ` #b`` #c')).toEqual(['code:``a ` #b``', 'tag:#c']);
        expect(kinds('`open #t')).toEqual(['tag:#t']);
    });

    it('takes a list bracket before a link as no part of it', () => {
        expect(kinds('[[[a]], b]')).toEqual(['wikilink:[[a]]']);
    });

    it('reads # after a letter or a mark as no tag', () => {
        expect(kinds('C#7 x#y 見#z (#p) 「#k」')).toEqual([]);
    });

    it('reads a tag where the notation before it ends', () => {
        expect(kinds('#a#b [[x]]#y `c`#z')).toEqual(['tag:#a', 'tag:#b', 'wikilink:[[x]]', 'tag:#y', 'code:`c`', 'tag:#z']);
        expect(kinds('#a.b#c')).toEqual(['tag:#a']);
    });

    // _tag-experiment/emph.md: Obsidian's tags of each line.
    it('reads a tag either side of an emphasis\'s mark and after an escape, as Obsidian does', () => {
        const tags = (text: string) => scanNotation(text).filter(n => n.kind === 'tag').map(n => text.slice(n.start, n.end));
        expect(tags('**#bold** x')).toEqual(['#bold']);
        expect(tags('**b**#after')).toEqual(['#after']);
        expect(tags('*#it* _#und_ a_#und2_ ***#three*** x')).toEqual(['#it', '#und', '#und2', '#three']);
        expect(tags('==#hl== ~~#del~~ x')).toEqual(['#hl', '#del']);
        expect(tags('**a *#nest* b** *a*#after1 **#u**#v')).toEqual(['#nest', '#after1', '#u', '#v']);
        expect(tags('\\##esc x')).toEqual(['#esc']);
        expect(tags('x *#open x =#one= ~#one~ x\\#esc2 **x**y#no')).toEqual([]);
    });

    it('ends a tag at the characters Obsidian ends one at, and reads no tag of digits alone', () => {
        expect(kinds('#comma, #kuten。x #semi; #123 #1.5 #12/34')).toEqual(['tag:#comma', 'tag:#kuten。x', 'tag:#semi', 'tag:#12/34']);
        expect(kinds('#123#abc')).toEqual([]);
    });
});

// Obsidian 1.14's tags of each text as a task's content (`- [ ] ` before it),
// read from the metadata cache of a note in the Dev vault: emphasis and its
// nesting, escapes, math, HTML, comments, footnotes, links and references,
// bare URLs and addresses. In the order they begin. A content that opens a
// block of its own (`<div>`, `<!--`, a fence, `$$`) Obsidian reads as that
// block, which is not inline notation and not read here.
const OBSIDIAN_TAGS: readonly (readonly [string, readonly string[]])[] = [
    ['a *#b* c', ['#b']],
    ['[#lt](http://x) z', ['#lt']],
    ['[#ref] z', ['#ref']],
    ['[#ref][r] z', ['#ref']],
    ['$x$#m', ['#m']],
    ['$#m$ z', []],
    ['$ #m$ z', ['#m']],
    ['<span>#h</span> z', ['#h']],
    ['<span class="#x">a</span>#y', ['#y']],
    ['a<b>#c</b>', ['#c']],
    ['x %%#c%% y', ['#c']],
    ['%%#c%%#d', ['#c', '#d']],
    ['***a* b** #e', ['#e']],
    ['***#a* b**', ['#a']],
    ['**#a *b***', ['#a']],
    ['a ^[#note] z', ['#note']],
    ['a [^#fn] z', []],
    ['x ^blk#a', []],
    ['http://a.com/#x y', []],
    ['<http://a.com>#y', ['#y']],
    ['a@b.com#c', ['#c']],
    ['~~#s~~', ['#s']],
    ['==#h==', ['#h']],
    ['\\$#m', ['#m']],
    ['a\\#b #c', ['#c']],
    ['x $$#m$$ y', []],
    ['x $y $#z', []],
    ['%%a%%#e', ['#e']],
    ['[a](u)#t', ['#t']],
    ['[#a #b](u)', ['#a', '#b']],
    ['![#img](u) z', []],
    ['[t][#r] z', []],
    ['[[x]]#y', ['#y']],
    ['a <!-- #c --> b', []],
    ['<b>#c', ['#c']],
    ['</b>#c', ['#c']],
    ['a<br>#c', ['#c']],
    ['`x`#y', ['#y']],
    ['a_b_#c', ['#c']],
    ['**a**b#c', []],
    ['x **a#b** y', []],
    ['*a* #b *c*', ['#b']],
    ['**a *b***#f', ['#f']],
    ['*a **b***#g', ['#g']],
    ['_a_#b', ['#b']],
    ['__#a__', ['#a']],
    ['x ^[note #n]', ['#n']],
    ['^[#n]#m', ['#n', '#m']],
    ['[^1]#f', ['#f']],
    ['a\\*#b*', ['#b']],
    ['**#x**#y**#z**', ['#x', '#y', '#z']],
    ['~~a~~#b', ['#b']],
    ['==a==#b', ['#b']],
    ['==#a ==b', []],
    ['a == #x ==', ['#x']],
    ['$a$ #b $c$', ['#b']],
    ['$a $#b', []],
    ['$$a$$#b', ['#b']],
    ['$5 #b and $6', ['#b']],
    ['<http://x.y>#a', ['#a']],
    ['https://x.y/z#a #b', ['#b']],
    ['www.x.y#a', []],
    ['x@y.z#a', ['#a']],
    ['[#a]', ['#a']],
    ['[[a]]]#b', []],
    ['[x](<u #a>) #b', ['#b']],
    ['[x](u "t #a") #b', ['#b']],
    ['***#a***', ['#a']],
    ['***a** b* #c', ['#c']],
    ['*a **#b** c*', ['#b']],
    ['**a*#b*c**', ['#b']],
    ['*a*#b*c*', ['#b']],
    ['__a__#b', ['#b']],
    ['_a_b_ #c', ['#c']],
    ['_a _#b_', ['#b_']],
    ['x_#a_', ['#a']],
    ['a*#b*', ['#b']],
    ['a**#b**', ['#b']],
    ['*#a **#b***#c', ['#b', '#c']],
    ['**a**#b**c**#d', ['#b', '#d']],
    ['* #a*', ['#a']],
    ['** #a**', ['#a']],
    ['**a #b**', ['#b']],
    ['~~ #a~~', ['#a']],
    ['~~a #b~~#c', ['#b', '#c']],
    ['==a #b==#c', ['#b', '#c']],
    ['=#a= #b', ['#b']],
    ['***', []],
    ['*#a', []],
    ['**#a*', ['#a']],
    ['*#a**', []],
    ['\\*#a*', ['#a']],
    ['*\\*#a*', ['#a']],
    ['_#a__', []],
    ['__#a_', ['#a']],
    ['*_#a_*', ['#a']],
    ['_*#a*_', ['#a']],
    ['**_#a_**#b', ['#a', '#b']],
    ['a ***b*** #c***d***#e', ['#c', '#e']],
    ['[*#a*](u)#b', ['#a', '#b']],
    ['**[#a](u)**', ['#a']],
    ['`a`#b`c`#d', ['#b', '#d']],
    ['``#a``#b', ['#b']],
    ['`#a', []],
    ['a`b`#c', ['#c']],
    ['\\`#a`', ['#a']],
    ['#a\\#b', ['#a']],
    ['#a\\ #b', ['#a', '#b']],
    ['x\\\\#a', ['#a']],
    ['\\\\#a', ['#a']],
    ['&amp;#a', []],
    ['&#35;a #b', ['#b']],
    ['<span>a</span>#b', ['#b']],
    ['<a href="x">#a</a> [b](c)#d', ['#a', '#d']],
    ['<em>#a</em>', ['#a']],
    ['<x y="#a">#b', ['#b']],
    ['<1>#a', []],
    ['a<#b', []],
    ['$a$b#c', []],
    ['$a$ $#b$', []],
    ['$ a$#b', []],
    ['$a $b$#c', ['#c']],
    ['$1$#a', ['#a']],
    ['$a$1 #b', ['#b']],
    ['$$ a $$#b', ['#b']],
    ['$$#a', []],
    ['x$#a$', []],
    ['\\$#a$', ['#a']],
    ['$a\\$#b$#c', ['#c']],
    ['%%a%% #b %%#c', ['#b']],
    ['^[a]#b', ['#b']],
    ['[^a]#b', ['#b']],
    ['[a][b]#c', ['#c']],
    ['[a][]#c', ['#c']],
    ['[#a][]', ['#a']],
    ['[](u)#b', ['#b']],
    ['![](u)#b', ['#b']],
    ['![a]#b', ['#b']],
    ['[a] #b', ['#b']],
    ['[[a]] #b [[c#d]]#e', ['#b', '#e']],
    ['![[a]]#b', ['#b']],
    ['[[a|b#c]]', []],
    ['!#a', []],
    ['! #a', ['#a']],
];

describe('scanNotation, against Obsidian', () => {
    it.each(OBSIDIAN_TAGS)('%s', (text, tags) => {
        expect(scanNotation(text).filter(n => n.kind === 'tag').sort((a, b) => a.start - b.start).map(n => `#${n.tag}`)).toEqual(tags);
    });
});

describe('withoutEmbeds', () => {
    it('takes out embeds outside code only', () => {
        expect(withoutEmbeds('a ![[x]] b ![i](p) `![[y]]` [[z]]')).toBe('a  b  `![[y]]` [[z]]');
    });
});
