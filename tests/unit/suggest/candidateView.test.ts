import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { noteItem, renderComplex, within, type ComplexItem } from '../../../src/suggest/candidateView';
import type { NoteCandidate } from '../../../src/suggest/NoteCandidates';
import { t } from '../../../src/i18n';
import { FakeEl, asEl } from '../helpers/fakeDom';

/**
 * A candidate drawn as Obsidian draws one in its `[[` list
 * (`note-suggest/candidates.md`, 描き方): the item's DOM, and what each
 * kind of candidate shows in it.
 */

const tfile = (path: string) => Object.assign(new TFile(), { path });
const base = { score: -1, downranked: false };

describe('noteItem: what a candidate shows', () => {
    it('a note: its name, and its folder with a / under it; the matches in each part', () => {
        const c: NoteCandidate = { kind: 'file', file: tfile('zz/b/Plan.md'), linkpath: 'zz/b/Plan', ...base, matches: [[0, 2], [5, 7]] };
        expect(noteItem(c)).toEqual({ title: 'Plan', titleMatches: [[0, 2]], note: 'zz/b/', noteMatches: [[0, 2]], flair: null, downranked: false });
    });

    it('a note at the vault\'s root: nothing under its name', () => {
        const c: NoteCandidate = { kind: 'file', file: tfile('Plan.md'), linkpath: 'Plan', ...base, matches: null };
        expect(noteItem(c)).toMatchObject({ title: 'Plan', note: '', noteMatches: null });
    });

    it('another file: its name with its extension', () => {
        const c: NoteCandidate = { kind: 'file', file: tfile('img/画像.png'), linkpath: 'img/画像.png', ...base, matches: null };
        expect(noteItem(c)).toMatchObject({ title: '画像.png', note: 'img/' });
    });

    it('an alias: the alias, its note\'s path under it, and the alias\'s mark', () => {
        const c: NoteCandidate = { kind: 'alias', file: tfile('a/Book.md'), linkpath: 'a/Book', alias: '本', ...base, matches: [[0, 1]] };
        expect(noteItem(c)).toEqual({
            title: '本', titleMatches: [[0, 1]], note: 'a/Book', noteMatches: null,
            flair: { icon: 'forward', label: t('aria.alias') }, downranked: false,
        });
    });

    it('an unresolved link: its path, nothing under it', () => {
        const c: NoteCandidate = { kind: 'unresolved', linkpath: 'Ideas/Later', ...base, matches: [[0, 1]] };
        expect(noteItem(c)).toMatchObject({ title: 'Ideas/Later', titleMatches: [[0, 1]], note: '' });
    });

    it('a match across the folder and the name is cut at the /', () => {
        expect(within([[1, 5]], 3, 6)).toEqual([[0, 2]]);
        expect(within([[1, 5]], 0, 3)).toEqual([[1, 3]]);
        expect(within([[0, 2]], 3, 6)).toBeNull();
    });
});

describe('renderComplex: Obsidian\'s DOM', () => {
    const draw = (item: ComplexItem) => {
        const el = new FakeEl('suggestion-item');
        renderComplex(asEl(el), item);
        return el;
    };

    it('the content, title and note, and the aux beside them; the note there though empty', () => {
        const el = draw({ title: 'Plan', titleMatches: null, note: '', noteMatches: null, flair: null, downranked: false });
        expect([...el.classes]).toEqual(['suggestion-item', 'mod-complex']);
        expect(el.children.map(c => [...c.classes][0])).toEqual(['suggestion-content', 'suggestion-aux']);
        expect(el.children[0].children.map(c => [...c.classes][0])).toEqual(['suggestion-title', 'suggestion-note']);
        expect(el.find('suggestion-note')?.textContent).toBe('');
        expect(el.find('suggestion-aux')?.children).toEqual([]);
    });

    it('the matches highlighted, in the title and in the note', () => {
        const el = draw({ title: 'Plan', titleMatches: [[0, 2]], note: 'zz/', noteMatches: [[0, 2]], flair: null, downranked: false });
        const title = el.find('suggestion-title')!;
        expect(title.textContent).toBe('Plan');
        expect(title.find('suggestion-highlight')?.textContent).toBe('Pl');
        expect(el.find('suggestion-note')?.find('suggestion-highlight')?.textContent).toBe('zz');
    });

    it('an alias\'s mark, named for a screen reader; an excluded file faded', () => {
        const el = draw({ title: '本', titleMatches: null, note: 'Book', noteMatches: null, flair: { icon: 'forward', label: 'エイリアス' }, downranked: true });
        expect(el.classes.has('mod-downranked')).toBe(true);
        expect(el.find('suggestion-flair')?.attrs.get('aria-label')).toBe('エイリアス');
    });
});
