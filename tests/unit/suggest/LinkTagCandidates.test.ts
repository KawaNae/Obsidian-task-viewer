import { describe, it, expect } from 'vitest';
import { linkTagCandidates, linkTagWrite, replacedRange, type LinkTagCandidate } from '../../../src/suggest/LinkTagCandidates';
import { linkApp } from '../helpers/linkApp';

/**
 * Link and tag completion as Obsidian's `[[` completes (`note-suggest/candidates.md`):
 * what a `[[` lists (every kind `NoteCandidates` holds), a note's headings
 * matched fuzzily, and what a pick writes, spelt from the note the link is
 * written in. The fuzzy search is the mock's, so what is asserted is the
 * order the rules make.
 */

const app = linkApp({
    files: ['src.md', 'a/Dup.md', 'b/Dup.md', 'Book.md', 'img/画像.png', 'Plan.md'],
    frontmatter: { 'Book.md': { aliases: ['本'] } },
    unresolved: { 'src.md': { Later: 1 } },
    headings: {
        'Plan.md': [{ heading: '準備', level: 1 }, { heading: '道具の準備', level: 2 }, { heading: '片付け', level: 2 }],
        'src.md': [{ heading: '自分の見出し', level: 2 }],
    },
    tags: ['project', 'proj-x'],
});

const shown = (candidates: LinkTagCandidate[]) => candidates.map((c) => {
    switch (c.kind) {
        case 'tag': return `#${c.tag}`;
        case 'heading': return `${c.linkpath}#${c.heading}`;
        case 'note': return c.note.kind === 'alias' ? `${c.note.alias}>${c.note.linkpath}` : c.note.linkpath;
    }
});

describe('linkTagCandidates: what [[ lists', () => {
    it('every kind Obsidian lists: notes, other files, aliases, unresolved links, the newest first', () => {
        const found = linkTagCandidates(app, 'a [[', 'src.md')!;
        expect(found).toMatchObject({ mode: 'file', start: 2, query: '' });
        expect(shown(found.candidates)).toEqual(['Plan', 'img/画像.png', 'Book', '本>Book', 'b/Dup', 'a/Dup', 'src', 'Later']);
    });

    it('matched as the notes of a field are (NoteCandidates): the name first', () => {
        expect(shown(linkTagCandidates(app, '[[dup', 'src.md')!.candidates)).toEqual(['b/Dup', 'a/Dup']);
        expect(shown(linkTagCandidates(app, '[[本', 'src.md')!.candidates)).toEqual(['本>Book']);
    });

    it('a note\'s headings after #: in the note\'s order with nothing typed, matched fuzzily after', () => {
        expect(shown(linkTagCandidates(app, '[[Plan#', 'src.md')!.candidates)).toEqual(['Plan#準備', 'Plan#道具の準備', 'Plan#片付け']);
        expect(shown(linkTagCandidates(app, '[[Plan#準備', 'src.md')!.candidates)).toEqual(['Plan#準備', 'Plan#道具の準備']);
        expect(shown(linkTagCandidates(app, '[[Plan#付', 'src.md')!.candidates)).toEqual(['Plan#片付け']);
    });

    it('the note before # is looked up from the note the link is in: none before it is its own', () => {
        expect(shown(linkTagCandidates(app, '[[#', 'src.md')!.candidates)).toEqual(['#自分の見出し']);
        expect(linkTagCandidates(app, '[[#', '')!.candidates).toEqual([]);
        expect(linkTagCandidates(app, '[[img/画像.png#', 'src.md')!.candidates).toEqual([]);
    });

    it('tags after #, as before', () => {
        expect(shown(linkTagCandidates(app, 'a #pro', 'src.md')!.candidates)).toEqual(['#proj-x', '#project']);
    });
});

describe('linkTagWrite: what a pick writes', () => {
    const write = (before: string, index = 0, source = 'src.md') =>
        linkTagWrite(app, linkTagCandidates(app, before, source)!.candidates[index], source);

    it('a note, named as Obsidian names it from the note the link is in', () => {
        expect(write('[[Plan')).toBe('[[Plan]]');
        expect(write('[[a/dup')).toBe('[[a/Dup|Dup]]');
        expect(write('[[画像')).toBe('[[画像.png]]');
    });

    it('an alias after its note; an unresolved link as it is', () => {
        expect(write('[[本')).toBe('[[Book|本]]');
        expect(write('[[Later')).toBe('[[Later]]');
    });

    it('a heading, after the note as typed; in its own note, alone', () => {
        expect(write('[[plan#片')).toBe('[[plan#片付け]]');
        expect(write('[[#')).toBe('[[#自分の見出し]]');
    });

    it('a tag', () => {
        expect(write('#proj')).toBe('#proj-x');
    });
});

describe('replacedRange: what a pick writes over', () => {
    it('a link: the trigger through the caret and the closers of its [[ after the caret, whatever form it is written in', () => {
        expect(replacedRange('a [[no]] rest', 6, 2)).toEqual({ from: 2, to: 8 });
        expect(replacedRange('[[no] rest', 4, 0)).toEqual({ from: 0, to: 5 });
        expect(replacedRange('[[no rest', 4, 0)).toEqual({ from: 0, to: 4 });
    });

    it('a tag: nothing after the caret', () => {
        expect(replacedRange('( #ta)', 5, 2)).toEqual({ from: 2, to: 5 });
    });
});
