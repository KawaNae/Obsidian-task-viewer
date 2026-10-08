import {
    parseFrontMatterAliases, prepareFuzzySearch, prepareSimpleSearch,
    type App, type SearchMatches, type SearchResult, type TFile,
} from 'obsidian';
import { isIgnored, isLinkable } from './ObsidianFiles';

/**
 * The notes a field suggests, as Obsidian's `[[` suggests them
 * (`note-suggest-design.md`, `note-suggest/candidates.md`): every list of
 * notes asks here, and draws what it gets with `candidateView`.
 *
 * Obsidian's list is made of its link suggestions (`getLinkSuggestions`,
 * unpublished) and matched by `getFileSuggestions`; both are copied here,
 * since neither is published.
 *
 * - What can be listed (`linkables`): the vault's notes, by their path
 *   without `.md`; the other files Obsidian lists (`isLinkable`), by their
 *   path; each alias of a note's frontmatter; the targets of unresolved
 *   links that no file's path is. Which of the last three a list holds is
 *   its caller's to choose (`NoteCandidateKinds`).
 * - Nothing typed: the most recently modified first (an alias at its note's
 *   time, an unresolved link last), the "Excluded files" left out.
 * - Typed: matched fuzzily (`prepareFuzzySearch`; `prepareSimpleSearch` from
 *   ten thousand items on). A file is matched by its name first, and by its
 *   path, a point lower, only when its name does not match, so a note whose
 *   name holds what is typed comes above one whose folder does. An alias is
 *   matched by the alias alone, an unresolved link by its path. An excluded
 *   file is ten points lower, and marked.
 * - The best first; a tie by the most recently modified, then by path. A
 *   hundred at most, as Obsidian lists.
 */

/** What a list holds besides the vault's notes, which it always holds. */
export interface NoteCandidateKinds {
    /** The files other than notes that Obsidian lists (images, PDFs, a plugin's). */
    attachments: boolean;
    /** The aliases of a note's frontmatter, each standing for its note. */
    aliases: boolean;
    /** The targets of the vault's unresolved links, as the notes they would be. */
    unresolved: boolean;
}

/**
 * One thing a list can hold, before it is matched: one of Obsidian's link
 * suggestions. `linkpath` is how a link names it from the vault's root: a
 * note's path without `.md`, another file's path with its extension, an
 * unresolved link's target.
 */
export type Linkable =
    | { kind: 'file'; file: TFile; linkpath: string }
    | { kind: 'alias'; file: TFile; linkpath: string; alias: string }
    | { kind: 'unresolved'; linkpath: string };

/**
 * A candidate as matched and ranked. `matches` are the ranges what is typed
 * matched, in the alias for an alias and in the linkpath otherwise; null
 * when nothing is typed.
 */
export type NoteCandidate = Linkable & {
    score: number;
    matches: SearchMatches | null;
    /** An "Excluded files" file, ranked lower. */
    downranked: boolean;
};

/** How many a list holds, as Obsidian's `[[` holds. */
export const NOTE_CANDIDATE_LIMIT = 100;

/** From this many items on, Obsidian's search of what is typed is the simple one. */
const FUZZY_UP_TO = 10000;

/** An unresolved link Obsidian keeps as a candidate is cut to this length. */
const UNRESOLVED_MAX = 500;

/** A note's path without its extension, as a link names it. */
function withoutMd(path: string): string {
    return path.replace(/\.md$/, '');
}

/**
 * Everything a list of `kinds` can hold, read from the vault now, in
 * Obsidian's order: the files as the vault lists them, each note followed
 * by its aliases, then the unresolved links.
 */
export function linkables(app: App, kinds: NoteCandidateKinds): Linkable[] {
    const out: Linkable[] = [];
    const paths = new Set<string>();
    for (const file of app.vault.getFiles()) {
        const md = file.extension === 'md';
        if (!md && !isLinkable(app, file)) continue;
        const linkpath = md ? withoutMd(file.path) : file.path;
        paths.add(linkpath);
        if (!md && !kinds.attachments) continue;
        out.push({ kind: 'file', file, linkpath });
        if (!kinds.aliases || !md) continue;
        const aliases = parseFrontMatterAliases(app.metadataCache.getFileCache(file)?.frontmatter ?? null) ?? [];
        for (const alias of aliases) out.push({ kind: 'alias', file, linkpath, alias });
    }
    if (kinds.unresolved) {
        const unresolved: Record<string, Record<string, number>> = app.metadataCache.unresolvedLinks ?? {};
        for (const targets of Object.values(unresolved)) {
            for (const target of Object.keys(targets)) {
                const linkpath = target.length > UNRESOLVED_MAX ? target.slice(0, UNRESOLVED_MAX) : target;
                if (paths.has(linkpath)) continue;
                paths.add(linkpath);
                out.push({ kind: 'unresolved', linkpath });
            }
        }
    }
    return out;
}

/** What a list is asked with besides what is typed. */
export interface NoteQueryOptions {
    /** Whether `path` is one of the "Excluded files" (`ObsidianFiles.isIgnored`). */
    ignored(path: string): boolean;
    /**
     * Whether a `.md` typed at the end is taken off: a list of notes alone
     * (a note's linkpath has none), so `Plan.md` finds `Plan`. One that holds
     * other files matches what is typed as it is, as Obsidian's `[[` does.
     */
    dropsMd: boolean;
    limit?: number;
}

/** `items` matched against `query` and ranked, as Obsidian's `[[` ranks them (see the module's comment). */
export function noteCandidates(items: readonly Linkable[], query: string, opts: NoteQueryOptions): NoteCandidate[] {
    let typed = query.trim();
    if (opts.dropsMd) typed = typed.replace(/\.md$/i, '').trim();
    const out: NoteCandidate[] = [];
    if (typed === '') {
        for (const item of items) {
            if (item.kind === 'unresolved') {
                out.push({ ...item, score: 0, matches: null, downranked: false });
            } else if (!opts.ignored(item.file.path)) {
                out.push({ ...item, score: item.file.stat.mtime, matches: null, downranked: false });
            }
        }
    } else {
        const search = (items.length < FUZZY_UP_TO ? prepareFuzzySearch : prepareSimpleSearch)(typed);
        for (const item of items) {
            if (item.kind === 'unresolved') {
                const found = search(item.linkpath);
                if (found) out.push({ ...item, score: found.score, matches: found.matches, downranked: false });
                continue;
            }
            const found = item.kind === 'alias' ? search(item.alias) : byNameThenPath(search, item.linkpath);
            if (!found) continue;
            const ignored = opts.ignored(item.file.path);
            out.push({ ...item, score: found.score - (ignored ? 10 : 0), matches: found.matches, downranked: ignored });
        }
    }
    // Stable: what ties throughout keeps the items' order, a note before its aliases.
    out.sort((a, b) => b.score - a.score || mtimeOf(b) - mtimeOf(a) || compare(a.linkpath, b.linkpath));
    return out.slice(0, opts.limit ?? NOTE_CANDIDATE_LIMIT);
}

/**
 * A file matched by its name (the linkpath past its last `/`), the ranges
 * moved to where the name stands in the linkpath; else by its whole
 * linkpath, a point lower.
 */
function byNameThenPath(search: (text: string) => SearchResult | null, linkpath: string): SearchResult | null {
    const cut = linkpath.lastIndexOf('/') + 1;
    const byName = search(linkpath.slice(cut));
    if (byName) return { score: byName.score, matches: byName.matches.map(([from, to]) => [from + cut, to + cut]) };
    const byPath = search(linkpath);
    return byPath ? { score: byPath.score - 1, matches: byPath.matches } : null;
}

function mtimeOf(candidate: NoteCandidate): number {
    return candidate.kind === 'unresolved' ? 0 : candidate.file.stat.mtime;
}

function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** The candidates `kinds` holds for `query` in the vault now, as a field's list shows them. */
export function noteCandidatesIn(app: App, kinds: NoteCandidateKinds, query: string): NoteCandidate[] {
    return noteCandidates(linkables(app, kinds), query, {
        ignored: (path) => isIgnored(app, path),
        dropsMd: !kinds.attachments,
    });
}
