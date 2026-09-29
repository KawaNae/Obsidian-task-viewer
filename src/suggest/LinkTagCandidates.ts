/**
 * Link and tag completion, apart from the widget that shows it: from the
 * text before the caret, whether a `[[link`, `[[note#heading` or `#tag` is
 * being typed, where it starts, and what it may complete to. The input's
 * suggest (`TaskNameSuggest`) and the source editor's completion source
 * (`modals/form/source/SourceCompletion`) both ask here, so the two complete
 * the same things over the same range.
 */

import type { App } from 'obsidian';
import { closersToTakeOver } from '../utils/BracketRules';

export type LinkTagMode = 'file' | 'heading' | 'tag';

export interface LinkTagCandidate {
    label: string;
    /** The text written over the trigger and what follows it up to the caret. */
    replacement: string;
    detail?: string;
    folder?: string;
}

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

const LIMIT = 30;

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

/** The trigger before the caret and its candidates, or null when none is being typed. */
export function linkTagCandidates(app: App, before: string): LinkTagCandidates | null {
    const trigger = linkTagTrigger(before);
    if (!trigger) return null;
    switch (trigger.mode) {
        case 'file': return { ...trigger, candidates: fileCandidates(app, trigger.query) };
        case 'heading': return { ...trigger, candidates: headingCandidates(app, trigger.query) };
        case 'tag': return { ...trigger, candidates: tagCandidates(app, trigger.query) };
    }
}

/**
 * The range a candidate is written over, in `text` with the caret at
 * `caret`: from the trigger through the closers after the caret that the
 * candidate writes itself (`BracketRules.closersToTakeOver`).
 */
export function replacedRange(text: string, caret: number, start: number, replacement: string): { from: number; to: number } {
    return { from: start, to: caret + closersToTakeOver(replacement, text.substring(caret)) };
}

function fileCandidates(app: App, typed: string): LinkTagCandidate[] {
    const query = typed.toLowerCase();
    return app.vault.getMarkdownFiles()
        .filter(f => query === '' || f.basename.toLowerCase().includes(query))
        .sort((a, b) => {
            const aP = a.basename.toLowerCase().startsWith(query) ? 0 : 1;
            const bP = b.basename.toLowerCase().startsWith(query) ? 0 : 1;
            if (aP !== bP) return aP - bP;
            return a.basename.localeCompare(b.basename);
        })
        .slice(0, LIMIT)
        .map(f => ({
            label: f.basename,
            replacement: `[[${f.basename}]]`,
            folder: f.parent?.path || undefined,
        }));
}

function headingCandidates(app: App, typed: string): LinkTagCandidate[] {
    const hashPos = typed.indexOf('#');
    const fileQuery = typed.substring(0, hashPos);
    const headingQuery = typed.substring(hashPos + 1).toLowerCase();

    const file = app.metadataCache.getFirstLinkpathDest(fileQuery, '');
    if (!file) return [];

    const headings = app.metadataCache.getFileCache(file)?.headings ?? [];
    return headings
        .filter(h => headingQuery === '' || h.heading.toLowerCase().includes(headingQuery))
        .sort((a, b) => {
            const aP = a.heading.toLowerCase().startsWith(headingQuery) ? 0 : 1;
            const bP = b.heading.toLowerCase().startsWith(headingQuery) ? 0 : 1;
            if (aP !== bP) return aP - bP;
            return a.position.start.line - b.position.start.line;
        })
        .slice(0, LIMIT)
        .map(h => ({
            label: h.heading,
            replacement: `[[${file.basename}#${h.heading}]]`,
            detail: 'H' + h.level,
        }));
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
        .slice(0, LIMIT)
        .map(t => ({
            label: t,
            replacement: `#${t}`,
        }));
}
