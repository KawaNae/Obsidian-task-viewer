/**
 * Link and tag completion, apart from the widget that shows it: from the
 * text before the caret, whether a `[[link`, `[[note#heading` or `#tag` is
 * being typed, where it starts, what it may complete to, and what a
 * candidate picked writes. The input's suggest (`TaskNameSuggest`) and the
 * source editor's completion source (`modals/form/source/SourceCompletion`)
 * both ask here, so the two complete the same things over the same range,
 * drawn alike (`candidateView.renderLinkTag`).
 *
 * A link is completed as Obsidian's `[[` completes one
 * (`note-suggest/candidates.md`): its notes, other files, aliases and
 * unresolved links (`NoteCandidates`), a note's headings matched fuzzily,
 * and the link written as Obsidian writes it (`NoteLink.pickedLink`), from
 * the note the link is written in (`sourcePath`), which the caller names.
 */

import { prepareFuzzySearch, type App, type SearchMatches, type TFile } from 'obsidian';
import { linkClosersAfter } from '../utils/BracketRules';
import { pickedLink } from '../utils/NoteLink';
import { NOTE_CANDIDATE_LIMIT, noteCandidatesIn, type NoteCandidate, type NoteCandidateKinds } from './NoteCandidates';

export type LinkTagMode = 'file' | 'heading' | 'tag';

/**
 * A candidate: a note's (or another file's, an alias's, an unresolved
 * link's), a heading of the note typed before the `#` (`linkpath`, as
 * typed), or a tag.
 */
export type LinkTagCandidate =
    | { kind: 'note'; note: NoteCandidate }
    | { kind: 'heading'; file: TFile; linkpath: string; heading: string; level: number; matches: SearchMatches | null }
    | { kind: 'tag'; tag: string };

/** What is being typed before the caret: its mode, and where its trigger (`[[` or `#`) starts. */
export interface LinkTagTrigger {
    mode: LinkTagMode;
    start: number;
    /** The text typed after the trigger. */
    query: string;
}

export interface LinkTagCandidates extends LinkTagTrigger {
    candidates: LinkTagCandidate[];
}

/** What `[[` lists, as Obsidian's does: every kind. */
const LINK_KINDS: NoteCandidateKinds = { attachments: true, aliases: true, unresolved: true };

/** How many tags are listed. */
const TAG_LIMIT = 30;

/**
 * The trigger the caret is in, from the text before it. An open `[[` (no
 * `]]` after it) is a link, a heading link past its `#`. Otherwise a `#` at
 * the start or after whitespace, outside an open link, is a tag.
 */
export function linkTagTrigger(before: string): LinkTagTrigger | null {
    const wikiIdx = before.lastIndexOf('[[');
    if (wikiIdx !== -1) {
        const after = before.substring(wikiIdx + 2);
        if (!after.includes(']]')) {
            const hashPos = after.indexOf('#');
            return hashPos === -1
                ? { mode: 'file', start: wikiIdx, query: after }
                : { mode: 'heading', start: wikiIdx, query: after };
        }
    }

    const hashIdx = before.lastIndexOf('#');
    if (hashIdx !== -1 && (hashIdx === 0 || /\s/.test(before[hashIdx - 1]))) {
        const lastOpen = before.lastIndexOf('[[');
        const lastClose = before.lastIndexOf(']]');
        if (lastOpen === -1 || lastClose > lastOpen) {
            return { mode: 'tag', start: hashIdx, query: before.substring(hashIdx + 1) };
        }
    }
    return null;
}

/**
 * The trigger before the caret and its candidates, or null when none is
 * being typed. A heading's note is looked up from `sourcePath`, as a link
 * written there resolves.
 */
export function linkTagCandidates(app: App, before: string, sourcePath: string): LinkTagCandidates | null {
    const trigger = linkTagTrigger(before);
    if (!trigger) return null;
    switch (trigger.mode) {
        case 'file': return { ...trigger, candidates: noteCandidatesIn(app, LINK_KINDS, trigger.query).map(note => ({ kind: 'note', note })) };
        case 'heading': return { ...trigger, candidates: headingCandidates(app, trigger.query, sourcePath) };
        case 'tag': return { ...trigger, candidates: tagCandidates(app, trigger.query) };
    }
}

/**
 * What `candidate` writes over the trigger, picked in the note at
 * `sourcePath`: a link as Obsidian's `[[` writes it (`pickedLink`), or the
 * tag.
 */
export function linkTagWrite(app: App, candidate: LinkTagCandidate, sourcePath: string): string {
    switch (candidate.kind) {
        case 'tag': return `#${candidate.tag}`;
        case 'heading': return pickedLink(app, { kind: 'heading', file: candidate.file, linkpath: candidate.linkpath, heading: candidate.heading }, sourcePath);
        case 'note': {
            const note = candidate.note;
            switch (note.kind) {
                case 'file': return pickedLink(app, { kind: 'file', file: note.file }, sourcePath);
                case 'alias': return pickedLink(app, { kind: 'alias', file: note.file, alias: note.alias }, sourcePath);
                case 'unresolved': return pickedLink(app, { kind: 'unresolved', linkpath: note.linkpath }, sourcePath);
            }
        }
    }
}

/**
 * The range a candidate is written over, in `text` with the caret at
 * `caret`: from the trigger at `start` through the caret, and, for a link,
 * through the closers of its `[[` after the caret (`BracketRules.linkClosersAfter`),
 * since the candidate writes a whole link. A tag takes nothing after the caret.
 */
export function replacedRange(text: string, caret: number, start: number): { from: number; to: number } {
    const link = text.startsWith('[[', start);
    return { from: start, to: caret + (link ? linkClosersAfter(text.substring(caret)) : 0) };
}

/**
 * The headings of the note typed before the `#`, as Obsidian's `[[note#`
 * lists them: in the note's order with nothing typed after the `#`,
 * otherwise those the fuzzy search matches, the best first, ties in the
 * note's order.
 */
function headingCandidates(app: App, typed: string, sourcePath: string): LinkTagCandidate[] {
    const hashPos = typed.indexOf('#');
    const linkpath = typed.substring(0, hashPos);
    const query = typed.substring(hashPos + 1).trim();

    const file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    if (!file || file.extension !== 'md') return [];

    const headings = app.metadataCache.getFileCache(file)?.headings ?? [];
    const search = query === '' ? null : prepareFuzzySearch(query);
    const found: { candidate: LinkTagCandidate; score: number }[] = [];
    for (const h of headings) {
        const match = search ? search(h.heading) : { score: 0, matches: null };
        if (!match) continue;
        found.push({
            candidate: { kind: 'heading', file, linkpath, heading: h.heading, level: h.level, matches: match.matches },
            score: match.score,
        });
    }
    // Stable: a tie keeps the note's order.
    return found.sort((a, b) => b.score - a.score).slice(0, NOTE_CANDIDATE_LIMIT).map(one => one.candidate);
}

function tagCandidates(app: App, typed: string): LinkTagCandidate[] {
    const query = typed.toLowerCase();
    // @ts-ignore - getTags() is not in the public API typings
    const tagMap: Record<string, number> = app.metadataCache.getTags?.() ?? {};
    return Object.keys(tagMap)
        .map(t => t.startsWith('#') ? t.substring(1) : t)
        .filter(t => query === '' || t.toLowerCase().includes(query))
        .sort((a, b) => {
            const aP = a.toLowerCase().startsWith(query) ? 0 : 1;
            const bP = b.toLowerCase().startsWith(query) ? 0 : 1;
            if (aP !== bP) return aP - bP;
            return a.localeCompare(b);
        })
        .slice(0, TAG_LIMIT)
        .map((tag): LinkTagCandidate => ({ kind: 'tag', tag }));
}
