import { replayEdits, type LineEdit } from '../utils/FileLines';

/** One change to an editor's document, in the offsets of the document as it was (a CM6 `ChangeSpec`). */
export interface LineChange {
    from: number;
    to: number;
    insert: string;
}

/**
 * A write made over an editor's lines (`editLines`), as changes to that
 * editor's document: the document `before` (its lines joined by `\n`) turned
 * into `after`, going by the write's report of which line became which.
 *
 * The lines the report kept, in the order they stand, are the ones the
 * changes leave standing: when the write moved a line past others, the most
 * lines that keep their order stay, and the rest go and come back as new
 * lines. A kept line whose text changed is changed only where it differs —
 * its common head and tail with what it read are left alone — so a cursor on
 * the line a write rewrote, the task just completed, stays where it was. Lines
 * the write put in, and lines it took away, are one change for each run of
 * them between two lines that stay.
 *
 * Null when the report does not describe anything a document could do, or
 * leaves other than as many lines as `after`: nothing is changed then.
 */
export function lineChanges(
    before: readonly string[],
    after: readonly string[],
    edits: readonly LineEdit[],
): LineChange[] | null {
    const replayed = replayEdits(before.length, edits);
    if (!replayed || replayed.origin.length !== after.length) return null;

    const start: number[] = [];
    let offset = 0;
    for (const line of before) {
        start.push(offset);
        offset += line.length + 1;
    }
    const length = offset - 1;
    const end = (b: number) => start[b] + before[b].length;

    const changes: LineChange[] = [];
    // The lines that stay, as pairs of a line now and the line it was.
    const stay = inOrder(replayed.origin);
    let b = -1;
    let a = -1;
    for (const [nextA, nextB] of stay) {
        gap(b, a, nextB, nextA);
        within(nextB, after[nextA]);
        b = nextB;
        a = nextA;
    }
    gap(b, a, before.length, after.length);
    return changes;

    /** The lines between two that stay: those of `before` go, those of `after` come. */
    function gap(fromB: number, fromA: number, toB: number, toA: number): void {
        const went = toB - fromB - 1;
        const came = after.slice(fromA + 1, toA);
        if (went === 0 && came.length === 0) return;
        if (toB < before.length) {
            // Up to the start of the next line that stays.
            const from = fromB < 0 ? 0 : start[fromB + 1];
            changes.push({ from, to: start[toB], insert: came.map(line => `${line}\n`).join('') });
        } else if (fromB >= 0) {
            // Past the end of the last line that stays.
            changes.push({ from: end(fromB), to: length, insert: came.map(line => `\n${line}`).join('') });
        } else {
            // No line stays.
            changes.push({ from: 0, to: length, insert: came.join('\n') });
        }
    }

    /** A line that stays, changed where its text differs. */
    function within(line: number, text: string): void {
        const was = before[line];
        if (was === text) return;
        let head = 0;
        const most = Math.min(was.length, text.length);
        while (head < most && was[head] === text[head]) head++;
        let tail = 0;
        while (tail < most - head && was[was.length - 1 - tail] === text[text.length - 1 - tail]) tail++;
        changes.push({ from: start[line] + head, to: end(line) - tail, insert: text.slice(head, text.length - tail) });
    }
}

/**
 * The most lines kept that stand in the order they stood (the longest
 * increasing run of `origin`, a line's index before for each line now), as
 * pairs of the line now and the line before, in order.
 */
function inOrder(origin: ReadonlyArray<number | null>): Array<[number, number]> {
    // tails[k]: the line now ending the best run of length k + 1 found so far.
    const tails: number[] = [];
    const previous = new Array<number>(origin.length).fill(-1);
    for (let now = 0; now < origin.length; now++) {
        const was = origin[now];
        if (was === null) continue;
        let low = 0;
        let high = tails.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (origin[tails[mid]]! < was) low = mid + 1;
            else high = mid;
        }
        if (low > 0) previous[now] = tails[low - 1];
        tails[low] = now;
    }
    const run: Array<[number, number]> = [];
    for (let now = tails.length ? tails[tails.length - 1] : -1; now >= 0; now = previous[now]) {
        run.push([now, origin[now]!]);
    }
    return run.reverse();
}
