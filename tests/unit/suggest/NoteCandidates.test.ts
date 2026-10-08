import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import {
    linkables, noteCandidates, noteCandidatesIn, NOTE_CANDIDATE_LIMIT,
    type Linkable, type NoteCandidate, type NoteCandidateKinds,
} from '../../../src/suggest/NoteCandidates';
import { isIgnored, isLinkable } from '../../../src/suggest/ObsidianFiles';

/**
 * The notes a list suggests, as Obsidian's `[[` suggests them
 * (`note-suggest/candidates.md`): what is held, by the kinds a caller
 * chooses, and how it is matched and ranked. The fuzzy search is the mock's
 * (`mocks/obsidian.ts`), so what is asserted is the order the rules make,
 * not Obsidian's scores.
 */

function file(path: string, mtime = 0): TFile {
    const name = path.split('/').pop()!;
    const dot = name.lastIndexOf('.');
    return Object.assign(new TFile(), {
        path,
        name,
        basename: dot > 0 ? name.slice(0, dot) : name,
        extension: dot > 0 ? name.slice(dot + 1) : '',
        stat: { mtime, ctime: 0, size: 0 },
    });
}

const note = (path: string, mtime = 0): Linkable => ({ kind: 'file', file: file(path, mtime), linkpath: path.replace(/\.md$/, '') });

const ALL: NoteCandidateKinds = { attachments: true, aliases: true, unresolved: true };
const NOTES: NoteCandidateKinds = { attachments: false, aliases: false, unresolved: false };

/** An app of these files, frontmatters, unresolved links and answers of Obsidian's own. */
function appOf(opts: {
    files: TFile[];
    frontmatter?: Record<string, unknown>;
    unresolved?: Record<string, Record<string, number>>;
    supported?: (file: TFile) => boolean;
    ignored?: (path: string) => boolean;
}) {
    return {
        vault: { getFiles: () => opts.files },
        metadataCache: {
            getFileCache: (f: TFile) => ({ frontmatter: opts.frontmatter?.[f.path] }),
            unresolvedLinks: opts.unresolved ?? {},
            ...(opts.supported ? { isSupportedFile: opts.supported } : {}),
            ...(opts.ignored ? { isUserIgnored: opts.ignored } : {}),
        },
    } as never;
}

const shown = (candidates: NoteCandidate[]) => candidates.map(c => (c.kind === 'alias' ? `${c.alias}>${c.linkpath}` : c.linkpath));
const rank = (items: Linkable[], query: string, ignored: (path: string) => boolean = () => false) =>
    noteCandidates(items, query, { ignored, dropsMd: true });

describe('linkables: what a list can hold', () => {
    const files = [file('a/Plan.md'), file('img.png'), file('data.xyz'), file('Book.md')];
    const app = appOf({
        files,
        frontmatter: { 'Book.md': { aliases: ['本', '書'] } },
        unresolved: { 'Book.md': { 'Later': 1, 'a/Plan': 1 }, 'a/Plan.md': { 'Later': 2, 'img.png': 1 } },
        supported: (f) => f.extension !== 'xyz',
    });

    it('every kind: the files Obsidian lists, each note followed by its aliases, then the unresolved links no file is, each once', () => {
        expect(linkables(app, ALL).map(one => (one.kind === 'alias' ? `alias:${one.alias}>${one.linkpath}` : `${one.kind}:${one.linkpath}`))).toEqual([
            'file:a/Plan', 'file:img.png', 'file:Book', 'alias:本>Book', 'alias:書>Book', 'unresolved:Later',
        ]);
    });

    it('the notes alone, whatever else there is', () => {
        expect(linkables(app, NOTES).map(one => one.linkpath)).toEqual(['a/Plan', 'Book']);
    });

    it.each([
        ['attachments', { ...NOTES, attachments: true }, ['a/Plan', 'img.png', 'Book']],
        ['aliases', { ...NOTES, aliases: true }, ['a/Plan', 'Book', 'Book', 'Book']],
        ['unresolved', { ...NOTES, unresolved: true }, ['a/Plan', 'Book', 'Later']],
    ])('%s alone, besides the notes', (_kind, kinds, paths) => {
        expect(linkables(app, kinds).map(one => one.linkpath)).toEqual(paths);
    });

    it('an unresolved link a file other than a note is, held or not, is no unresolved link', () => {
        expect(linkables(app, { ...NOTES, unresolved: true }).some(one => one.linkpath === 'img.png')).toBe(false);
    });
});

describe('ObsidianFiles: Obsidian\'s own answers, read once', () => {
    it('lists by Obsidian\'s answer, and by the default extensions when there is none to ask, or it threw', () => {
        const pdf = file('a.pdf');
        expect(isLinkable(appOf({ files: [], supported: () => false }), pdf)).toBe(false);
        expect(isLinkable(appOf({ files: [] }), pdf)).toBe(true);
        expect(isLinkable(appOf({ files: [] }), file('a.xyz'))).toBe(false);
        expect(isLinkable(appOf({ files: [], supported: () => { throw new Error('gone'); } }), file('a.PNG'))).toBe(true);
    });

    it('excludes by Obsidian\'s answer, and nothing when there is none to ask, or it threw', () => {
        expect(isIgnored(appOf({ files: [], ignored: (p) => p.startsWith('x/') }), 'x/a.md')).toBe(true);
        expect(isIgnored(appOf({ files: [] }), 'x/a.md')).toBe(false);
        expect(isIgnored(appOf({ files: [], ignored: () => { throw new Error('gone'); } }), 'x/a.md')).toBe(false);
    });
});

describe('noteCandidates: nothing typed', () => {
    it('the most recently modified first, an alias with its note after it, an unresolved link last', () => {
        const book = file('Book.md', 20);
        const items: Linkable[] = [
            note('Old.md', 10),
            { kind: 'unresolved', linkpath: 'Later' },
            { kind: 'file', file: book, linkpath: 'Book' },
            { kind: 'alias', file: book, linkpath: 'Book', alias: '本' },
            note('New.md', 30),
        ];
        expect(shown(rank(items, ''))).toEqual(['New', 'Book', '本>Book', 'Old', 'Later']);
        expect(rank(items, '').every(c => c.matches === null)).toBe(true);
    });

    it('leaves the excluded files and their aliases out', () => {
        const hidden = file('x/Hidden.md', 50);
        const items: Linkable[] = [note('Shown.md', 1), { kind: 'file', file: hidden, linkpath: 'x/Hidden' }, { kind: 'alias', file: hidden, linkpath: 'x/Hidden', alias: 'h' }];
        expect(shown(rank(items, '  ', (p) => p.startsWith('x/')))).toEqual(['Shown']);
    });

    it('a hundred at most', () => {
        const items = Array.from({ length: 130 }, (_, i) => note(`n${i}.md`, i));
        const listed = rank(items, '');
        expect(listed).toHaveLength(NOTE_CANDIDATE_LIMIT);
        expect(listed[0].linkpath).toBe('n129');
    });
});

describe('noteCandidates: typed', () => {
    it('matches the whole path fuzzily, case aside: a folder\'s name finds its notes', () => {
        const items = [note('Projects/web/Plan.md'), note('Daily/2026-10-08.md'), note('Other.md')];
        expect(shown(rank(items, 'daily2026-10-08'))).toEqual(['Daily/2026-10-08']);
        expect(shown(rank(items, 'PROJ plan'))).toEqual(['Projects/web/Plan']);
        expect(shown(rank(items, 'plan proj'))).toEqual([]);
    });

    it('a note its name matches above one its folder alone matches, a point between them', () => {
        const items = [note('plan/Notes.md', 99), note('a/Plan.md', 1)];
        const listed = rank(items, 'plan');
        expect(shown(listed)).toEqual(['a/Plan', 'plan/Notes']);
        expect(listed[0].score - listed[1].score).toBeGreaterThanOrEqual(1);
    });

    it('the ranges of a name match where the name stands in the path', () => {
        const [found] = rank([note('a/b/Plan.md')], 'pl');
        expect(found.matches).toEqual([[4, 6]]);
        const [byFolder] = rank([note('zz/x.md')], 'zz');
        expect(byFolder.matches).toEqual([[0, 2]]);
    });

    it('an alias by the alias alone: its note\'s name finds the note, not the alias', () => {
        const book = file('Book.md');
        const items: Linkable[] = [{ kind: 'file', file: book, linkpath: 'Book' }, { kind: 'alias', file: book, linkpath: 'Book', alias: '本の別名' }];
        expect(shown(rank(items, 'book'))).toEqual(['Book']);
        expect(shown(rank(items, '別名'))).toEqual(['本の別名>Book']);
    });

    it('an unresolved link by its path', () => {
        expect(shown(rank([{ kind: 'unresolved', linkpath: 'Ideas/Later' }], 'idlat'))).toEqual(['Ideas/Later']);
    });

    it('an excluded file ten points lower, and marked', () => {
        const items = [note('x/Plan.md'), note('Plan.md')];
        const listed = rank(items, 'plan', (p) => p.startsWith('x/'));
        expect(listed.map(c => [c.linkpath, c.downranked])).toEqual([['Plan', false], ['x/Plan', true]]);
        expect(listed[0].score - listed[1].score).toBeCloseTo(10, 5);
    });

    it('a tie by the most recently modified, then by path', () => {
        const items = [note('b/Same.md', 1), note('c/Same.md', 5), note('a/Same.md', 1)];
        expect(shown(rank(items, 'same'))).toEqual(['c/Same', 'a/Same', 'b/Same']);
    });

    it('a .md typed at the end, taken off for a list of notes alone; kept for one of every file', () => {
        const items = [note('Plan.md'), { kind: 'file' as const, file: file('Plan.md.png'), linkpath: 'Plan.md.png' }];
        expect(shown(rank(items, 'Plan.MD '))).toEqual(['Plan', 'Plan.md.png']);
        expect(shown(noteCandidates(items, 'Plan.md', { ignored: () => false, dropsMd: false }))).toEqual(['Plan.md.png']);
    });
});

describe('noteCandidatesIn: the vault now, as a field asks', () => {
    it('reads Obsidian\'s answers, and a list of notes alone takes a typed .md off', () => {
        const app = appOf({ files: [file('Plan.md', 2), file('x/Plan.md', 3), file('Plan.png', 4)], ignored: (p) => p.startsWith('x/') });
        expect(shown(noteCandidatesIn(app, NOTES, 'plan.md'))).toEqual(['Plan', 'x/Plan']);
        expect(shown(noteCandidatesIn(app, ALL, ''))).toEqual(['Plan.png', 'Plan']);
    });
});
