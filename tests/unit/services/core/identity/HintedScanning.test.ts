import { describe, it, expect, vi, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import { TaskScanner } from '../../../../../src/services/core/TaskScanner';
import { TaskStore } from '../../../../../src/services/core/TaskStore';
import { TaskValidator } from '../../../../../src/services/core/TaskValidator';
import { HINT_TTL_MS, type ClaimedRow, type Hint } from '../../../../../src/services/core/identity/IdentityHints';
import { DEFAULT_SETTINGS } from '../../../../../src/types';
import type { Task } from '../../../../../src/types';
import type { LineEdit } from '../../../../../src/utils/FileLines';

/**
 * Claims through the real scanner: raised by a write, weighed against what the
 * next scan reads, and retired by that scan's commit.
 *
 * The matcher's tests decide what an adopted claim means. These decide which
 * claims a scan gets to adopt — the part that depends on the order of writes,
 * reads and commits, and on claims that never found their scan.
 */

function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() ?? path;
    file.basename = file.name.replace(/\.md$/, '');
    return file;
}

const FILE = 'a.md';
const TASK = '- [ ] ポモドーロ';

/** One write's claim: the file's rows, as `[runtimeId | null, text]` pairs. */
let coined = 0;

/**
 * One write's claim. `[id, text]` is a row the write kept; a null id is a row
 * the write made, and a made row carries a name of its own — coined by the
 * write, at the moment the line came into being — with `created` saying that
 * no scan has recorded it yet.
 */
const claim = (...rows: Array<[string | null, string]>): Hint => ({
    rows: rows.map(([runtimeId, text]): ClaimedRow => runtimeId === null
        // The shape a scan would mint, because the scanner's guard against
        // provisional IDs reaching the store does not care who minted one.
        // The counter starts far below the ledger's (it seeds from the clock),
        // so a coined name is never one a scan will hand out.
        ? { runtimeId: `tv-inline:${FILE}:seq:${++coined}`, created: true, text }
        : { runtimeId, created: false, text }),
});

class Harness {
    readonly contents = new Map<string, string>();
    readonly store = new TaskStore(DEFAULT_SETTINGS);
    readonly scanner: TaskScanner;
    /** Held while a read is in flight, so a scan can be paused mid-flight. */
    private gate: Promise<void> | null = null;

    constructor() {
        const app = {
            vault: {
                read: async (file: TFile) => {
                    if (this.gate) await this.gate;
                    return this.contents.get(file.path) ?? '';
                },
                getMarkdownFiles: () => [...this.contents.keys()].map(makeFile),
            },
            metadataCache: { getCache: () => null },
        };
        const flow = { handleTaskCompletion: vi.fn(async () => {}) };
        this.scanner = new TaskScanner(
            app as never, this.store, new TaskValidator(), {} as never, flow as never, DEFAULT_SETTINGS
        );
        this.scanner.setInitializing(false);
    }

    /** A write: the claim goes in from inside the callback, as the writer does. */
    async write(lines: string[], ...hints: Hint[]): Promise<void> {
        this.contents.set(FILE, lines.join('\n'));
        if (hints.length > 0) this.scanner.addHints(FILE, hints);
        await this.scanner.requestScan(makeFile(FILE));
    }

    /**
     * A write that reports its lines, the way a writer with a sink does.
     *
     * Nothing is hand-built here: `WriteClaims` reads the file back, works out
     * which lines are rows, and names the ones the write made. No scan
     * follows, so the caller decides which state each scan reads.
     */
    report(lines: string[], edits: LineEdit[]): void {
        const before = (this.contents.get(FILE) ?? '').split('\n');
        this.contents.set(FILE, lines.join('\n'));
        this.scanner.writeSink(FILE)(before, lines, edits);
    }

    /** Raise a claim without a scan following it — a write during a drag. */
    hintOnly(lines: string[], ...hints: Hint[]): void {
        this.contents.set(FILE, lines.join('\n'));
        this.scanner.addHints(FILE, hints);
    }

    async scan(): Promise<void> {
        await this.scanner.requestScan(makeFile(FILE));
    }

    /** Start a scan, hold it at the read, and return a release function. */
    holdRead(): { release: () => void; scanning: Promise<void> } {
        let release!: () => void;
        this.gate = new Promise<void>(resolve => { release = resolve; });
        const scanning = this.scan();
        return {
            release: () => { this.gate = null; release(); },
            scanning,
        };
    }

    tasks(): Task[] {
        return this.store.getTasks()
            .filter(task => task.file === FILE)
            .sort((a, b) => a.line - b.line);
    }

    ids(): string[] {
        return this.tasks().map(task => task.id);
    }

    pendingCount(): number {
        return this.scanner.getHintLog().peek()
            .find(entry => entry.file === FILE)?.pending.length ?? 0;
    }
}

let clock: ReturnType<typeof vi.useFakeTimers> | undefined;
afterEach(() => {
    if (clock) vi.useRealTimers();
    clock = undefined;
});

describe('a claim through the scanner', () => {
    it('keeps the original\'s ID when a duplicate is written above it', async () => {
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        await harness.write([TASK, TASK, ''], claim([null, TASK], [original, TASK]));

        // The copy is the new line; the original kept what it had.
        expect(harness.ids()[1]).toBe(original);
        expect(harness.ids()[0]).not.toBe(original);
    });

    it('is not adopted twice', async () => {
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        await harness.write([TASK, TASK, ''], claim([null, TASK], [original, TASK]));
        const afterCopy = harness.ids();

        // An unrelated scan of the same file: the claim is spent, so nothing
        // moves.
        await harness.scan();
        expect(harness.pendingCount()).toBe(0);
        expect(harness.ids()).toEqual(afterCopy);
        expect(harness.ids()[1]).toBe(original);
    });
});

describe('a line the write named, through the write layer', () => {
    // The whole chain, with nothing stood in for: the write reports its lines,
    // `WriteClaims` names what the write made, and two scans read it.

    const DONE = '- [x] ポモドーロ';

    it('names a created line once, whichever scan reads it', async () => {
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        const afterCopy = [TASK, TASK, ''];
        const afterTick = [TASK, DONE, ''];

        // W1 puts a copy above the original; W2 ticks the original off,
        // building on what W1 left.
        harness.report(afterCopy, [{ kind: 'inserted', at: 0, count: 1 }]);
        harness.report(afterTick, [{ kind: 'replaced', at: 1 }]);

        // S1's read started before W2 landed, so it reads the file W1 left,
        // and commits it: the copy is now a row the ledger holds.
        harness.contents.set(FILE, afterCopy.join('\n'));
        await harness.scan();
        const afterFirst = harness.ids();
        expect(afterFirst[1]).toBe(original);
        expect(afterFirst[0]).not.toBe(original);

        // S2 reads what W2 actually left, with W2's claim still pending. The
        // copy is the row it already was — the name came from the write, and
        // the write gave it once.
        harness.contents.set(FILE, afterTick.join('\n'));
        await harness.scan();
        expect(harness.ids()).toEqual(afterFirst);
    });

    it('keeps the first copy when a second duplicate follows it', async () => {
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        harness.report([TASK, TASK, ''], [{ kind: 'inserted', at: 0, count: 1 }]);
        await harness.scan();
        const afterOnce = harness.ids();
        expect(afterOnce[1]).toBe(original);

        // A second copy, above the first: three lines that read alike, and
        // only the writes know which is which.
        harness.report([TASK, TASK, TASK, ''], [{ kind: 'inserted', at: 0, count: 1 }]);
        await harness.scan();

        expect(harness.ids().slice(1)).toEqual(afterOnce);
    });

    it('does not move the rows again once the ladder has answered', async () => {
        const harness = new Harness();
        await harness.write([TASK, '']);

        // The write reports its copy, but a hand edit arrived in the same
        // moment: the claim does not reproduce what the scan reads, so the
        // ladder answers and the log goes.
        harness.report([TASK, TASK, ''], [{ kind: 'inserted', at: 0, count: 1 }]);
        harness.contents.set(FILE, [TASK, TASK, '- [ ] 手で書いた行', ''].join('\n'));
        await harness.scan();
        const afterLadder = harness.ids();
        expect(harness.pendingCount()).toBe(0);

        // Nothing has written since. A second read of the same file has to
        // answer the same way: what the ladder handed out is the file's now.
        await harness.scan();
        expect(harness.ids()).toEqual(afterLadder);
    });
});

describe('a claim that found no scan of its own', () => {
    it('is dropped by a scan that moved the rows some other way', async () => {
        // A write whose claim cannot be adopted, because a hand edit came with
        // it: the ladder placed the write its own way, and the claim describes
        // a file that has now been read. The next write's claim has to work
        // regardless.
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        await harness.write(
            [TASK, TASK, '- [ ] 手で書いた行', ''],
            claim([null, TASK], [original, TASK]),
        );
        const stranded = harness.ids();
        expect(harness.pendingCount()).toBe(0);

        await harness.write(
            [TASK, TASK, TASK, '- [ ] 手で書いた行', ''],
            claim([null, TASK], [stranded[0], TASK], [stranded[1], TASK], [stranded[2], '- [ ] 手で書いた行']),
        );

        // The copy is the new line; the rows below it kept their IDs.
        expect(harness.ids().slice(1)).toEqual(stranded);
        expect(harness.ids()[0]).not.toBe(stranded[0]);
    });

    it('expires rather than waiting forever', async () => {
        clock = vi.useFakeTimers();
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        // A write made while scans are suppressed (a drag): the claim is filed,
        // but no scan follows it.
        harness.hintOnly([TASK, TASK, ''], claim([null, TASK], [original, TASK]));
        vi.advanceTimersByTime(HINT_TTL_MS);

        // Whatever finally scans this file gets no help from it.
        await harness.scan();
        expect(harness.ids()[1]).not.toBe(original);
        expect(harness.ids()[0]).toBe(original);
    });

    it('is adopted by a scan whose read overlapped the write', async () => {
        // The scan started before this write existed, and its read still saw
        // the write's lines. Measured: a scan's read can span a later write.
        // What decides is the rows, not when anything was filed.
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        const held = harness.holdRead();
        harness.hintOnly([TASK, TASK, ''], claim([null, TASK], [original, TASK]));
        held.release();
        await held.scanning;

        expect(harness.ids()[1]).toBe(original);
        expect(harness.ids()[0]).not.toBe(original);
    });

    it('waits for its own scan when another read the file first', async () => {
        // The window the per-line design accepted and this one closes: a claim
        // is raised inside the write callback, a moment before the file reaches
        // disk. A scan reading in between sees the file as it was. Nothing
        // moved, so the claim is still about the next read, and it is kept.
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        // Raised, but the file still reads as it did.
        harness.scanner.addHints(FILE, [claim([null, TASK], [original, TASK])]);
        await harness.scan();
        expect(harness.ids()).toEqual([original]);
        expect(harness.pendingCount()).toBe(1);

        // Now the write lands, and its own scan follows — with no claim of its
        // own, because the write already filed one.
        await harness.write([TASK, TASK, '']);

        expect(harness.ids()[1]).toBe(original);
        expect(harness.ids()[0]).not.toBe(original);
    });

    it('decides nothing when it and the file as it stands disagree', async () => {
        // A write that deleted the row and wrote the same text back. Until its
        // scan arrives, the file reads exactly as before, and the two answers —
        // the row is the old one, the row is new — cannot both be right. The
        // ladder takes it, and the claim stays for the scan that can settle it.
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        harness.scanner.addHints(FILE, [claim([null, TASK])]);
        await harness.scan();

        expect(harness.ids()).toEqual([original]);
        expect(harness.pendingCount()).toBe(1);
    });
});

describe('a flow firing, through the write layer', () => {
    // A firing writes three times: the tick, the next instance above the fired
    // line, and the `==>` coming off it. The tick files no claim until stage
    // 2-4, so the chain starts at the second write — safely, because a firing
    // runs inside the tail of the scan that committed the tick, so the ledger
    // already holds it.
    //
    // What varies below is where the second scan falls against the third
    // write. All three orders are here because all three are reachable: at
    // 3000 lines the intermediate state is committed every time, at 4 lines it
    // never is, and the third write's claim can be filed on either side of the
    // commit in between.

    // The next instance carries the occurrence it was computed for:
    // `buildNextTask` puts one on a dateless task rather than leaving it bare
    // (FlowPlanner.ts:358-362).
    const LIVE = '- [ ] ポモドーロ @2026-09-21 ==> every 1d';
    const FIRED = '- [x] ポモドーロ ==> every 1d';
    const STRIPPED = '- [x] ポモドーロ';

    /** The file after the tick, after the instance, after the strip. */
    const ticked = [FIRED, ''];
    const instanced = [LIVE, FIRED, ''];
    const stripped = [LIVE, STRIPPED, ''];

    /** What the two writers report, as the writer tests pin them. */
    const INSTANCE: LineEdit[] = [{ kind: 'inserted', at: 0, count: 1 }];
    const STRIP: LineEdit[] = [{ kind: 'replaced', at: 1 }];

    /** Up to the point the flow fires: the tick is written and committed. */
    async function fired(): Promise<{ harness: Harness; original: string }> {
        const harness = new Harness();
        await harness.write([TASK + ' ==> every 1d', '']);
        const original = harness.ids()[0];

        // The tick, with no claim of its own, and the scan that commits it —
        // the one whose tail fires the flow.
        await harness.write(ticked);
        expect(harness.ids()).toEqual([original]);

        return { harness, original };
    }

    it('keeps both rows when the strip lands before the next scan reads', async () => {
        const { harness, original } = await fired();

        harness.report(instanced, INSTANCE);
        harness.report(stripped, STRIP);

        await harness.scan();
        const afterFirst = harness.ids();
        // The fired line kept what it had; the instance above it is the new row.
        expect(afterFirst[1]).toBe(original);
        expect(afterFirst[0]).not.toBe(original);

        await harness.scan();
        expect(harness.ids()).toEqual(afterFirst);
    });

    it('keeps both rows when a scan reads between the two writes', async () => {
        // The order the 3000-line measurement shows, with the third write's
        // claim filed before that scan commits: the claim is raised after the
        // read, which is exactly the case `pendingFor` refuses to cut off, and
        // it has to survive the commit that follows.
        const { harness, original } = await fired();

        harness.report(instanced, INSTANCE);

        const held = harness.holdRead();
        harness.report(stripped, STRIP);
        // The read in flight still sees the file as the second write left it.
        harness.contents.set(FILE, instanced.join('\n'));
        held.release();
        await held.scanning;

        const afterMiddle = harness.ids();
        expect(afterMiddle[1]).toBe(original);
        const instance = afterMiddle[0];
        expect(instance).not.toBe(original);

        // The strip's claim outlived that commit, so the scan that reads the
        // stripped file is not left to the ladder.
        expect(harness.pendingCount()).toBe(1);

        harness.contents.set(FILE, stripped.join('\n'));
        await harness.scan();
        expect(harness.ids()).toEqual([instance, original]);
    });

    it('keeps both rows when that scan commits before the strip is written', async () => {
        // The same read, committed before the third write files. `forget` takes
        // the base with it, so the strip's claim is built on the ledger — which
        // is current, and already holds the row the second write named.
        const { harness, original } = await fired();

        harness.report(instanced, INSTANCE);
        await harness.scan();

        const afterMiddle = harness.ids();
        expect(afterMiddle[1]).toBe(original);
        const instance = afterMiddle[0];
        expect(harness.pendingCount()).toBe(0);

        harness.report(stripped, STRIP);

        // Built on the ledger: the instance is a row that has been recorded,
        // not one this write made, and the claim says so.
        const pending = harness.scanner.getHintLog().peek()
            .find(entry => entry.file === FILE)?.pending ?? [];
        expect(pending).toHaveLength(1);
        expect(pending[0].hint.rows.map(row => row.created)).toEqual([false, false]);
        expect(pending[0].hint.rows.map(row => row.runtimeId)).toEqual([instance, original]);

        await harness.scan();
        expect(harness.ids()).toEqual([instance, original]);
    });

    it('is not what keeps a recurrence right: the ladder holds there on its own', async () => {
        // Both writes with no claim behind either. The date the next instance
        // was computed for is what saves it: the two lines read alike otherwise,
        // and the rung that survives a reformat keys on content *and* dates, so
        // they fall in different buckets and the fired line keeps its row. A
        // recurrence always has that date, which is why the field runs saw no
        // ID move. What the claims buy here is not this answer but independence
        // from it.
        const { harness, original } = await fired();

        harness.contents.set(FILE, stripped.join('\n'));
        await harness.scan();

        expect(harness.ids()[1]).toBe(original);
        expect(harness.ids()[0]).not.toBe(original);
    });

    it('collapses into one claim when the flow is on a child line', async () => {
        // Written as `- ==>` under the task, the strip removes a line no row
        // stands on and rewrites the task line to the same text. Both claims
        // then describe the same rows, so the scan in between adopts the newer
        // one and there is nothing left for the scan after it — which costs
        // nothing, because the ladder reads both lines verbatim.
        const CHILD = '\t- ==> every 1d';
        const harness = new Harness();
        await harness.write([TASK, CHILD, '']);
        const original = harness.ids()[0];
        await harness.write(['- [x] ポモドーロ', CHILD, '']);

        harness.report([LIVE, CHILD, '- [x] ポモドーロ', CHILD, ''],
            [{ kind: 'inserted', at: 0, count: 2 }]);
        harness.report([LIVE, CHILD, '- [x] ポモドーロ', ''],
            [{ kind: 'removed', at: 3, count: 1 }, { kind: 'replaced', at: 2 }]);
        harness.contents.set(FILE, [LIVE, CHILD, '- [x] ポモドーロ', CHILD, ''].join('\n'));

        await harness.scan();
        const afterMiddle = harness.ids();
        expect(afterMiddle[1]).toBe(original);
        expect(harness.pendingCount()).toBe(0);

        harness.contents.set(FILE, [LIVE, CHILD, '- [x] ポモドーロ', ''].join('\n'));
        await harness.scan();
        expect(harness.ids()).toEqual(afterMiddle);
    });
});

describe('a firing whose gen block writes a parent of its own', () => {
    // `insertGeneratedInstance` does not go through the formatter: when the
    // block renders a parent line, that line is written as the block wrote it,
    // with only the flow clause appended (FlowPlanner.ts:297-305). A block that
    // renders nothing but the task's own words gives the instance no date — and
    // then the instance and the line it was generated from read alike in
    // everything the ladder can key on.
    const BARE = '- [ ] 掃除 ==> every 1d';
    const GEN_FIRED = '- [x] 掃除 ==> every 1d';
    const GEN_STRIPPED = '- [x] 掃除';

    async function fired(): Promise<{ harness: Harness; original: string }> {
        const harness = new Harness();
        await harness.write([BARE, '']);
        const original = harness.ids()[0];
        await harness.write([GEN_FIRED, '']);
        expect(harness.ids()).toEqual([original]);
        return { harness, original };
    }

    it('hands the fired line its ID to the instance when nothing is claimed', async () => {
        // The rung that survives a reformat keys on content and dates, which
        // these two share, so both land in one bucket — and that rung pairs by
        // ordinal rather than refusing, so the row goes to whichever line comes
        // first. That is the instance, written above the line it came from.
        const { harness, original } = await fired();

        harness.contents.set(FILE, [BARE, GEN_STRIPPED, ''].join('\n'));
        await harness.scan();

        expect(harness.ids()[0]).toBe(original);
        expect(harness.ids()[1]).not.toBe(original);
    });

    it('leaves it where it was once the writes say what they did', async () => {
        const { harness, original } = await fired();

        harness.report([BARE, GEN_FIRED, ''], [{ kind: 'inserted', at: 0, count: 1 }]);
        harness.report([BARE, GEN_STRIPPED, ''], [{ kind: 'replaced', at: 1 }]);
        await harness.scan();

        expect(harness.ids()[1]).toBe(original);
        expect(harness.ids()[0]).not.toBe(original);
    });

    it('loses the strip with the instance when a hand edit lands on both', async () => {
        // What the second claim's correctness is worth to the third. A line
        // typed into the file in the same moment leaves the scan reading
        // something neither claim describes; it adopts nothing and the rows
        // moved anyway, so the whole log goes — the strip's claim with it,
        // though no scan ever read the state it describes. The firing then
        // lands exactly where it would have with nothing claimed at all.
        const { harness, original } = await fired();

        harness.report([BARE, GEN_FIRED, ''], [{ kind: 'inserted', at: 0, count: 1 }]);
        harness.report([BARE, GEN_STRIPPED, ''], [{ kind: 'replaced', at: 1 }]);

        const TYPED = '- [ ] 手で書いた行';
        harness.contents.set(FILE, [BARE, GEN_STRIPPED, TYPED, ''].join('\n'));
        await harness.scan();

        // Both claims are gone, not just the one that failed to match.
        expect(harness.pendingCount()).toBe(0);
        // And the ladder placed the row the way it places it with no claim:
        // on the instance, above the line that fired.
        expect(harness.ids()[0]).toBe(original);
        expect(harness.ids()[1]).not.toBe(original);

        // The typed line goes again. Nothing is left to say otherwise, so the
        // answer the ladder already committed stands.
        const placed = harness.ids().slice(0, 2);
        harness.contents.set(FILE, [BARE, GEN_STRIPPED, ''].join('\n'));
        await harness.scan();
        expect(harness.ids()).toEqual(placed);
    });
});
