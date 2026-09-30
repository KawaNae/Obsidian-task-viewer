import { describe, it, expect } from 'vitest';
import { anchorsIn, linksTo, type LinkReader } from '../../../src/services/data/NoteRefs';

/** A link written on `line`. */
const at = (link: string, line: number) => ({
    link,
    original: `[[${link}]]`,
    position: { start: { line, col: 0, offset: 0 }, end: { line, col: 0, offset: 0 } },
});

/**
 * A metadata cache over `notes`: per note, its links and embeds. A link
 * resolves to the note whose name (without `.md`) it spells.
 */
function cacheOf(notes: Record<string, { links?: ReturnType<typeof at>[]; embeds?: ReturnType<typeof at>[] }>): LinkReader {
    const dest = (linkpath: string) => Object.keys(notes).find(p => p.replace(/\.md$/, '').split('/').pop() === linkpath);
    const resolvedLinks: Record<string, Record<string, number>> = {};
    for (const [from, meta] of Object.entries(notes)) {
        resolvedLinks[from] = {};
        for (const link of [...(meta.links ?? []), ...(meta.embeds ?? [])]) {
            const to = link.link.split('#')[0];
            const target = to === '' ? undefined : dest(to);
            if (target) resolvedLinks[from][target] = (resolvedLinks[from][target] ?? 0) + 1;
        }
    }
    return {
        resolvedLinks,
        getCache: (path: string) => (notes[path] as never) ?? null,
        getFirstLinkpathDest: (linkpath: string) => {
            const path = dest(linkpath);
            return path ? ({ path } as never) : null;
        },
    } as LinkReader;
}

describe('linksTo', () => {
    it('ほかのノートの links と embeds から、元#^id を指すものを拾う', () => {
        const cache = cacheOf({
            'src.md': {},
            'a.md': { links: [at('src#^abc', 3), at('src#^other', 4), at('src#見出し', 5)] },
            'b/c.md': { embeds: [at('src#^abc', 7)] },
            'd.md': { links: [at('elsewhere#^abc', 1)] },
        });
        expect(linksTo(cache, 'src.md', ['abc'], [])).toEqual([
            { anchor: 'abc', from: 'a.md', line: 3 },
            { anchor: 'abc', from: 'b/c.md', line: 7 },
        ]);
    });

    it('元のノートの中の [[#^id]] は、送らない行からのものだけ数える', () => {
        const cache = cacheOf({
            'src.md': { links: [at('#^abc', 1), at('#^abc', 10), at('src#^abc', 12)] },
        });
        // Lines 9 to 11 are sent: the link on line 10 goes with them.
        expect(linksTo(cache, 'src.md', ['abc'], [{ start: 9, end: 11 }])).toEqual([
            { anchor: 'abc', from: 'src.md', line: 1 },
            { anchor: 'abc', from: 'src.md', line: 12 },
        ]);
    });

    it('送る ^id が無ければ何も探さない', () => {
        const cache = cacheOf({ 'a.md': { links: [at('src#^abc', 3)] }, 'src.md': {} });
        expect(linksTo(cache, 'src.md', [], [])).toEqual([]);
    });
});

describe('anchorsIn', () => {
    it('行末の ^id を1度ずつ', () => {
        expect(anchorsIn([
            '- [ ] 親 ^abc',
            '    - 本文 ^note-1',
            '    - [ ] 子',
            '    - 途中の ^xyz ではない',
            '- [ ] 重複 ^abc',
        ])).toEqual(['abc', 'note-1']);
    });
});
