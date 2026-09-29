import { type MetadataCache, parseLinktext } from 'obsidian';
import { TaskLineClassifier } from '../parsing/utils/TaskLineClassifier';

/** A link, somewhere in the vault, to a block of a note by its `^id`. */
export interface AnchorLink {
    anchor: string;
    /** The note the link is written in. */
    from: string;
    /** The line of `from` it is written on. */
    line: number;
}

/** What {@link linksTo} asks of Obsidian's metadata cache. */
export type LinkReader = Pick<MetadataCache, 'resolvedLinks' | 'getCache' | 'getFirstLinkpathDest'>;

/** Lines `start` to before `end` of a note. */
export interface LineSpan {
    start: number;
    end: number;
}

/** The `^id`s written at the ends of `lines`, each once. */
export function anchorsIn(lines: readonly string[]): string[] {
    const ids = new Set<string>();
    for (const line of lines) {
        const { blockId } = TaskLineClassifier.extractLineBlockId(line);
        if (blockId !== undefined) ids.add(blockId);
    }
    return [...ids];
}

/**
 * The links that point at one of `anchors` in note `path` (`[[path#^id]]`,
 * an embed as well), as Obsidian's metadata cache has them: what breaks when
 * the lines that carry those `^id`s are sent to another note. The links are
 * not rewritten; the send dialog tells how many there are and where.
 *
 * The notes looked at are those the cache resolves a link from to `path`,
 * and `path` itself: a link there to its own block (`[[#^id]]`) breaks too,
 * unless it is written in the lines sent (`sent`), which carry it along.
 *
 * The cache describes the notes as Obsidian last read them, not as the index
 * or the disk holds them this moment. It is a warning, and a stale one says
 * too much or too little until the cache catches up.
 */
export function linksTo(cache: LinkReader, path: string, anchors: readonly string[], sent: readonly LineSpan[]): AnchorLink[] {
    if (anchors.length === 0) return [];
    const wanted = new Set(anchors);
    const sources = new Set<string>([path]);
    for (const [from, targets] of Object.entries(cache.resolvedLinks)) {
        if (targets[path]) sources.add(from);
    }

    const out: AnchorLink[] = [];
    for (const from of sources) {
        const meta = cache.getCache(from);
        if (!meta) continue;
        for (const link of [...(meta.links ?? []), ...(meta.embeds ?? [])]) {
            const { path: to, subpath } = parseLinktext(link.link);
            if (!subpath.startsWith('#^')) continue;
            const anchor = subpath.slice(2);
            if (!wanted.has(anchor)) continue;
            const target = to === '' ? from : cache.getFirstLinkpathDest(to, from)?.path;
            if (target !== path) continue;
            const line = link.position.start.line;
            if (from === path && sent.some(span => line >= span.start && line < span.end)) continue;
            out.push({ anchor, from, line });
        }
    }
    return out.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line);
}
