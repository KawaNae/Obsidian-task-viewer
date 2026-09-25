import { replayEdits, type LineEdit } from '../../utils/FileLines';
import type { ContentKey } from './ContentKey';

/**
 * One write of ours: it was handed reading `n` of the file, whose content is
 * `from`, and left `to`, the content of reading `n + 1`, as its report says.
 */
interface Link {
    n: number;
    from: ContentKey;
    to: ContentKey;
    /** How many lines `from` has, which the report is replayed over. */
    length: number;
    edits: readonly LineEdit[];
}

/** Where a line of one reading stands after our writes from it (`WriteLinks.walk`). */
export interface Walked {
    /** The reading the last of the writes left: `n + 1` of that write. */
    n: number;
    line: number;
}

/**
 * The plugin's own writes to each file, one after another, as their reports
 * say they went: what lets a name from before our own write be followed to
 * the line the row stands on after it.
 *
 * A name is one line of one reading (`TaskIdGenerator.nameOf`). Our own write
 * knows which line became which (`LineEdits`), so following a line across it
 * is not a guess; nothing else is followed. A row the write rewrote or carried
 * is followed, one it took away is not.
 *
 * A link joins reading n, the one the write was handed, to reading n + 1, the
 * one it left: by the readings' numbers, not by their contents, as a write of
 * ours can bring a file back to a content it had, and the rows of the two
 * readings are not the same rows. A file's links run unbroken from reading to
 * reading: a write whose report did not account for its lines, or one handed
 * a content the links do not end in (a change nobody reported came between),
 * drops what came before. Whether the links end in the reading the file's
 * last number was given to is the caller's to ask (`TaskScanner.carry`). Each
 * link holds a write's report, a few edits, so no bound is put on how many a
 * file holds between outside changes.
 */
export class WriteLinks {
    private readonly links = new Map<string, Link[]>();

    /**
     * A write of ours landed in `path`: handed reading `n`, of content `from`
     * and `length` lines, it left `to`, reading `n + 1`, as `edits` report.
     * With no reading it was handed (null: a change nobody reported came between)
     * or no report it can follow, what came before is dropped.
     */
    wrote(path: string, n: number | null, from: ContentKey, to: ContentKey, length: number, edits: readonly LineEdit[] | null): void {
        if (n === null || edits === null) {
            this.links.delete(path);
            return;
        }
        const chain = this.links.get(path) ?? [];
        const last = chain[chain.length - 1];
        const link: Link = { n, from, to, length, edits };
        const unbroken = last !== undefined && last.n + 1 === n && last.to === from;
        this.links.set(path, unbroken ? [...chain, link] : [link]);
    }

    /** Forget `path`'s links: the file was renamed, deleted, or read as ignored. */
    drop(path: string): void {
        this.links.delete(path);
    }

    /**
     * Where line `line` of reading `n` of `path` stands after our writes from
     * it: the reading the last of them left, and the line. Null
     * when no write of ours was handed reading `n`, or one took the line away.
     */
    walk(path: string, n: number, line: number): Walked | null {
        const chain = this.links.get(path);
        const start = chain?.findIndex(link => link.n === n) ?? -1;
        if (!chain || start < 0) return null;
        let at = line;
        for (let i = start; i < chain.length; i++) {
            const replayed = replayEdits(chain[i].length, chain[i].edits);
            if (!replayed) return null;
            at = replayed.origin.indexOf(at);
            if (at < 0) return null;
        }
        const end = chain[chain.length - 1];
        return { n: end.n + 1, line: at };
    }
}
