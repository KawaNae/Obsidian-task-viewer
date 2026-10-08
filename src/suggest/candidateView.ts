import { renderMatches, setIcon, type SearchMatches } from 'obsidian';
import { t } from '../i18n';
import type { NoteCandidate } from './NoteCandidates';

/**
 * A candidate as Obsidian draws one in its `[[` list
 * (`note-suggest/candidates.md`, 描き方): an item of `mod-complex`, whose
 * `suggestion-content` holds the title and, under it, a note (a folder,
 * here), and whose `suggestion-aux` holds a mark (an alias's). The ranges
 * what is typed matched are drawn as Obsidian draws them
 * (`suggestion-highlight`). The item's size, wrapping and colors are
 * Obsidian's own, by its classes: the note under the title at 0.8em.
 */
export interface ComplexItem {
    title: string;
    /** In `title`. */
    titleMatches: SearchMatches | null;
    /** The line under the title; '' for none, though its element is there all the same, as Obsidian's is. */
    note: string;
    /** In `note`. */
    noteMatches: SearchMatches | null;
    /** The mark beside it: an icon, with what it says to a screen reader. */
    flair: { icon: string; label: string } | null;
    /** An "Excluded files" file, drawn faded (`mod-downranked`). */
    downranked: boolean;
}

/** Draw `item` into `el`, an item of a list (Obsidian gives a list's item its `suggestion-item`). */
export function renderComplex(el: HTMLElement, item: ComplexItem): void {
    el.addClass('mod-complex');
    if (item.downranked) el.addClass('mod-downranked');
    const content = el.createDiv({ cls: 'suggestion-content' });
    renderMatches(content.createDiv({ cls: 'suggestion-title' }), item.title, item.titleMatches);
    renderMatches(content.createDiv({ cls: 'suggestion-note' }), item.note, item.noteMatches);
    const aux = el.createDiv({ cls: 'suggestion-aux' });
    if (item.flair) {
        const flair = aux.createSpan({ cls: 'suggestion-flair', attr: { 'aria-label': item.flair.label } });
        setIcon(flair, item.flair.icon);
    }
}

/**
 * A note's candidate as Obsidian draws it: a file by its name (a note's
 * without `.md`, another file's with its extension), its folder under it
 * with a `/` at its end, nothing under a file at the vault's root; an alias
 * by the alias, its note's linkpath under it and the alias's mark; an
 * unresolved link by its target. The ranges matched in a linkpath are
 * drawn where they fall, in the name or in the folder.
 */
export function noteItem(candidate: NoteCandidate): ComplexItem {
    if (candidate.kind === 'alias') {
        return {
            title: candidate.alias,
            titleMatches: candidate.matches,
            note: candidate.linkpath,
            noteMatches: null,
            flair: { icon: 'forward', label: t('aria.alias') },
            downranked: candidate.downranked,
        };
    }
    if (candidate.kind === 'unresolved') {
        return { title: candidate.linkpath, titleMatches: candidate.matches, note: '', noteMatches: null, flair: null, downranked: false };
    }
    const cut = candidate.linkpath.lastIndexOf('/') + 1;
    return {
        title: candidate.linkpath.slice(cut),
        titleMatches: within(candidate.matches, cut, candidate.linkpath.length),
        note: candidate.linkpath.slice(0, cut),
        noteMatches: within(candidate.matches, 0, cut),
        flair: null,
        downranked: candidate.downranked,
    };
}

/** The parts of `matches` within `[from, to)`, counted from `from`; null when none is. */
export function within(matches: SearchMatches | null, from: number, to: number): SearchMatches | null {
    if (!matches) return null;
    const out: SearchMatches = [];
    for (const [start, end] of matches) {
        const s = Math.max(start, from);
        const e = Math.min(end, to);
        if (s < e) out.push([s - from, e - from]);
    }
    return out.length > 0 ? out : null;
}
