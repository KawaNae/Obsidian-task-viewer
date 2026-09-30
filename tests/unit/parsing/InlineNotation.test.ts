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

    it('reads # after an ASCII word character as no tag', () => {
        expect(kinds('C#7 x#y 見#z')).toEqual(['tag:#z']);
    });
});

describe('withoutEmbeds', () => {
    it('takes out embeds outside code only', () => {
        expect(withoutEmbeds('a ![[x]] b ![i](p) `![[y]]` [[z]]')).toBe('a  b  `![[y]]` [[z]]');
    });
});
