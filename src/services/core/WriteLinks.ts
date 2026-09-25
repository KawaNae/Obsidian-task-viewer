import { replayEdits, type LineEdit } from '../../utils/FileLines';
import type { ContentKey } from './ContentKey';

/** One write of ours: the content it was handed, the one it left, and its report. */
interface Link {
    from: ContentKey;
    to: ContentKey;
    /** How many lines `from` has, which the report is replayed over. */
    length: number;
    edits: readonly LineEdit[];
}

/**
 * The plugin's own writes to each file, one after another, as their reports
 * say they went: what lets a name from before our own write be followed to
 * the line the row stands on after it.
 *
 * A name lasts one reading (`TaskIdGenerator.nameOf`). Our own write knows
 * which line became which (`LineEdits`), so following a line across it is
 * not a guess; nothing else is followed. A row the write rewrote or carried
 * is followed, one it took away is not.
 *
 * A file's links run unbroken from content to content: a write whose report
 * did not account for its lines, or one handed a content the links do not end
 * in (a change nobody reported came between), drops what came before. And
 * they say where a row stands only while the file reads as the last of them
 * left it: the caller asks with the content the index last read, and a file
 * that has moved on some other way answers nothing (`follow`). A reading is
 * not what cuts them, because the scan a write's own `modify` starts may read
 * its result before the write hands its report over. Each link holds a
 * write's report, a few edits, so no bound is put on how many a file holds
 * between outside changes.
 */
export class WriteLinks {
    private readonly links = new Map<string, Link[]>();

    /**
     * A write of ours landed in `path`: handed `from` of `length` lines, it
     * left `to`, as `edits` report, or with no report it can follow (null).
     */
    wrote(path: string, from: ContentKey, to: ContentKey, length: number, edits: readonly LineEdit[] | null): void {
        const chain = this.links.get(path) ?? [];
        const last = chain[chain.length - 1];
        const unbroken = last === undefined || last.to === from;
        if (edits === null) {
            this.links.delete(path);
            return;
        }
        const link: Link = { from, to, length, edits };
        this.links.set(path, unbroken ? [...chain, link] : [link]);
    }

    /** Forget `path`'s links: the file was renamed, deleted, or read as ignored. */
    drop(path: string): void {
        this.links.delete(path);
    }

    /**
     * Where line `line` of content `from` stands in content `now`, the one
     * the file is read as, after our own writes to `path`: null when nothing
     * of ours leads from `from` to `now`, or a write took the line away.
     */
    follow(path: string, from: ContentKey, line: number, now: ContentKey): number | null {
        const chain = this.links.get(path);
        if (!chain || chain[chain.length - 1].to !== now) return null;
        // The latest write handed this content: the one the file went on from.
        let start = -1;
        for (let i = chain.length - 1; i >= 0; i--) {
            if (chain[i].from === from) { start = i; break; }
        }
        if (start < 0) return null;
        let at = line;
        for (let i = start; i < chain.length; i++) {
            const replayed = replayEdits(chain[i].length, chain[i].edits);
            if (!replayed) return null;
            at = replayed.origin.indexOf(at);
            if (at < 0) return null;
        }
        return at;
    }
}
