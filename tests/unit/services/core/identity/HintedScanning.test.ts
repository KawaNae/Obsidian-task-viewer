import { NoticedFiles } from '../../../helpers/noticedFiles';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import { TaskScanner } from '../../../../../src/services/core/TaskScanner';
import { EditorSignal } from '../../../../../src/services/core/EditorSignal';
import { TaskStore } from '../../../../../src/services/core/TaskStore';
import { TaskValidator } from '../../../../../src/services/core/TaskValidator';
import type { ClaimedRow } from '../../../../../src/services/core/identity/IdentityHints';
import { TaskParser } from '../../../../../src/services/parsing/TaskParser';
import { DEFAULT_SETTINGS } from '../../../../../src/types';
import type { Task } from '../../../../../src/types';
import type { LineEdit } from '../../../../../src/utils/FileLines';
import { makeTask } from '../../../helpers/makeTask';

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
/**
 * The open row every test below is built from — the formatter's own output,
 * not a guess at it, so a change to how a task is written reaches these tests
 * instead of leaving them pinning a line the writer no longer produces.
 */
const TASK = TaskParser.format(makeTask({ content: 'ポモドーロ', statusChar: ' ' }));

/** One write's record, as its rows: what `WriteClaims.fileRecord` files. */
interface Hint {
    rows: ClaimedRow[];
}

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
    readonly contents = new NoticedFiles();
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
            app as never, this.store, new TaskValidator(), new EditorSignal(), flow as never, DEFAULT_SETTINGS
        );
        this.scanner.setInitializing(false);
        this.contents.listen(path => this.scanner.noteChange(path));
    }

    /**
     * A write: the record goes in from inside the callback, before the bytes
     * land, as the writer does — so the change that follows is its landing.
     * With no record it is a change nobody reported.
     */
    async write(lines: string[], ...hints: Hint[]): Promise<void> {
        this.file(lines, hints);
        this.contents.set(FILE, lines.join('\n'));
        await this.scanner.requestScan(makeFile(FILE));
    }

    /** File a hand-built record per hint, each about the file `lines` make. */
    file(lines: string[], hints: Hint[]): void {
        for (const hint of hints) this.scanner.getWriteClaims().fileRecord(FILE, lines, hint.rows);
    }

    /**
     * Put bytes in place without a change being heard: a read that raced our
     * writes and saw the file mid-way through them, or a write of ours whose
     * landing was already counted. Not an outside change, so nothing marks it.
     */
    raced(lines: string[]): void {
        Map.prototype.set.call(this.contents, FILE, lines.join('\n'));
    }

    /**
     * A write that reports its lines, the way a writer with a sink does.
     *
     * Nothing is hand-built here: `WriteClaims` reads the file back, works out
     * which lines are rows, and names the ones the write made. No scan
     * follows, so the caller decides which state each scan reads. Answers the
     * names the write gave the rows it made.
     */
    report(lines: string[], edits: LineEdit[]): string[] {
        const before = (this.contents.get(FILE) ?? '').split('\n');
        // Filed before the bytes land, as from inside `vault.process`.
        const { made } = this.scanner.writeSink(FILE, 'user')(before, lines, edits, null);
        this.contents.set(FILE, lines.join('\n'));
        return made.map(row => row.runtimeId);
    }

    /** Raise a claim without a scan following it — a write during a drag. */
    hintOnly(lines: string[], ...hints: Hint[]): void {
        this.file(lines, hints);
        this.contents.set(FILE, lines.join('\n'));
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

    /** The records in the file's chain: writes of ours the ledger has not read. */
    pendingCount(): number {
        return this.scanner.getWriteClaims().peek(FILE).links.filter(link => link === 'record').length;
    }
}

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

    const DONE = TaskParser.format(makeTask({ content: 'ポモドーロ', statusChar: 'x' }));

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
        // and commits it: the copy is now a row the ledger holds. A race, not
        // an outside change: both writes' landings were already counted.
        harness.raced(afterCopy);
        await harness.scan();
        const afterFirst = harness.ids();
        expect(afterFirst[1]).toBe(original);
        expect(afterFirst[0]).not.toBe(original);

        // S2 reads what W2 actually left, with W2's claim still pending. The
        // copy is the row it already was — the name came from the write, and
        // the write gave it once.
        harness.raced(afterTick);
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
        // ladder answers and its record goes.
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

    it('is given up by a scan that read the file first', async () => {
        // A claim is raised inside the write callback, a moment before the file
        // reaches disk, and a scan reading in between sees the file as it was.
        // The claim is not kept for the write's own scan: kept, it would wait
        // for a content the file might reach by another path, so
        // that scan is left to the ladder. The ladder cannot tell the copy from
        // the original; what matters here is that no claim decides it.
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        // Raised, but the file still reads as it did.
        harness.file([TASK, TASK, ''], [claim([null, TASK], [original, TASK])]);
        await harness.scan();
        expect(harness.ids()).toEqual([original]);
        expect(harness.pendingCount()).toBe(0);

        // Now the write lands, and its own scan follows with nothing to weigh.
        await harness.write([TASK, TASK, '']);

        expect(harness.ids().filter(id => id === original)).toHaveLength(1);
        expect(harness.pendingCount()).toBe(0);
    });

    it('decides nothing when it and the file as it stands disagree', async () => {
        // A write that deleted the row and wrote the same text back. Until its
        // scan arrives, the file reads exactly as before, and the two answers —
        // the row is the old one, the row is new — cannot both be right. The
        // row keeps neither name, and the claim goes with the scan.
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        const rebuilt = claim([null, TASK]);
        harness.file([TASK, ''], [rebuilt]);
        await harness.scan();

        // I1: the ledger's reading names the row the original, the record's
        // names it the rebuilt row's; they disagree, so the row is new (was:
        // the ladder's answer, the original).
        const [row] = harness.ids();
        expect(harness.ids()).toHaveLength(1);
        expect(row).not.toBe(original);
        expect(row).not.toBe(rebuilt.rows[0].runtimeId);
        expect(harness.pendingCount()).toBe(0);
    });
});

describe('a flow firing, through the write layer', () => {
    // A firing writes three times: the tick, the next instance above the fired
    // line, and the `==>` coming off it. From stage 2-4a the tick reports too,
    // so all three links of the chain are claimed. The chain still *decides*
    // from the second write on, because a firing runs inside the tail of the
    // scan that committed the tick: that scan has already retired the tick's
    // claim by the time the other two are filed.
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

    /** What the three writers report, as the writer tests pin them. */
    const TICK: LineEdit[] = [{ kind: 'replaced', at: 0 }];
    const INSTANCE: LineEdit[] = [{ kind: 'inserted', at: 0, count: 1 }];
    const STRIP: LineEdit[] = [{ kind: 'replaced', at: 1 }];

    /** Up to the point the flow fires: the tick is written and committed. */
    async function fired(): Promise<{ harness: Harness; original: string }> {
        const harness = new Harness();
        await harness.write([TASK + ' ==> every 1d', '']);
        const original = harness.ids()[0];

        // The tick and the scan that commits it — the one whose tail fires the
        // flow. The tick now files a claim, and that scan retires it, which is
        // why the two writes below still start from a clean chain.
        harness.report(ticked, TICK);
        await harness.scan();
        expect(harness.ids()).toEqual([original]);
        expect(harness.pendingCount()).toBe(0);

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
        // read, which is exactly the case the read-mark keeps (`WriteClaims.forget`), and
        // it has to survive the commit that follows.
        const { harness, original } = await fired();

        harness.report(instanced, INSTANCE);

        const held = harness.holdRead();
        harness.report(stripped, STRIP);
        // The read in flight still sees the file as the second write left it:
        // a race, not an outside change.
        harness.raced(instanced);
        held.release();
        await held.scanning;

        const afterMiddle = harness.ids();
        expect(afterMiddle[1]).toBe(original);
        const instance = afterMiddle[0];
        expect(instance).not.toBe(original);

        // The strip's claim outlived that commit, so the scan that reads the
        // stripped file is not left to the ladder.
        expect(harness.pendingCount()).toBe(1);

        // The strip had landed; its change was counted when it did.
        harness.raced(stripped);
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
        expect(harness.pendingCount()).toBe(1);
        const rows = harness.scanner.getWriteClaims().lastWrite(FILE)?.rows ?? [];
        expect(rows.map(row => row.created)).toEqual([false, false]);
        expect(rows.map(row => row.runtimeId)).toEqual([instance, original]);

        await harness.scan();
        expect(harness.ids()).toEqual([instance, original]);
    });

    it('decides the rows even when the tick\'s claim found no scan', async () => {
        // The order a claiming tick makes reachable: the scan whose tail fires
        // the flow read the file before the tick landed. That scan adopts
        // nothing, so the tick's claim goes with it, and the two writes of the
        // firing, built on a ledger older than the file they were handed, claim
        // nothing either. The ladder answers, and the date the instance was
        // computed for keeps the fired line its row.
        const harness = new Harness();
        const live = TASK + ' ==> every 1d';
        await harness.write([live, '']);
        const original = harness.ids()[0];

        const held = harness.holdRead();
        harness.report(ticked, TICK);
        // The read in flight still sees the file as it was before the tick:
        // a race, not an outside change.
        harness.raced([live, '']);
        held.release();
        await held.scanning;
        expect(harness.pendingCount()).toBe(0);

        // The tick did land, and the firing goes ahead on top of it. Its
        // change was counted when it landed.
        harness.raced(ticked);
        harness.report(instanced, INSTANCE);
        harness.report(stripped, STRIP);

        await harness.scan();
        const ids = harness.ids();
        expect(ids[1]).toBe(original);
        expect(ids[0]).not.toBe(original);
        expect(harness.pendingCount()).toBe(0);
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

    it('keeps each claim for its own read when the flow is on a child line', async () => {
        // Written as `- ==>` under the task, the strip removes a line no row
        // stands on and rewrites the task line to the same text. Both claims
        // then describe the same rows, but not the same file: the scan in
        // between read the file before the strip, so it adopts the insert's
        // claim and leaves the strip's for the scan that reads the strip.
        const CHILD = '\t- ==> every 1d';
        const harness = new Harness();
        await harness.write([TASK, CHILD, '']);
        const original = harness.ids()[0];
        await harness.write(['- [x] ポモドーロ', CHILD, '']);

        harness.report([LIVE, CHILD, '- [x] ポモドーロ', CHILD, ''],
            [{ kind: 'inserted', at: 0, count: 2 }]);
        harness.report([LIVE, CHILD, '- [x] ポモドーロ', ''],
            [{ kind: 'removed', at: 3, count: 1 }, { kind: 'replaced', at: 2 }]);
        // The scan reads the file before the strip landed: a race.
        harness.raced([LIVE, CHILD, '- [x] ポモドーロ', CHILD, '']);

        await harness.scan();
        const afterMiddle = harness.ids();
        expect(afterMiddle[1]).toBe(original);
        expect(harness.pendingCount()).toBe(1);

        harness.raced([LIVE, CHILD, '- [x] ポモドーロ', '']);
        await harness.scan();
        expect(harness.ids()).toEqual(afterMiddle);
        expect(harness.pendingCount()).toBe(0);
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

    it('pairs against what the firing left when a hand edit lands on both (F5b)', async () => {
        // A line typed into the file in the same moment leaves the scan
        // reading something neither claim describes; it adopts nothing, so
        // every record goes — the strip's claim with it, though no scan ever
        // read the state it describes. The ladder then pairs against what the
        // firing left rather than against the ledger from before it: the
        // typed line came after the writes, so the rows they left are the
        // newest known (`WriteClaims.ladderFor`). Until F5b it paired against
        // the ledger, and the name went to the instance above.
        const { harness, original } = await fired();

        harness.report([BARE, GEN_FIRED, ''], [{ kind: 'inserted', at: 0, count: 1 }]);
        harness.report([BARE, GEN_STRIPPED, ''], [{ kind: 'replaced', at: 1 }]);

        const TYPED = '- [ ] 手で書いた行';
        harness.contents.set(FILE, [BARE, GEN_STRIPPED, TYPED, ''].join('\n'));
        await harness.scan();

        // Both claims are gone, not just the one that failed to match.
        expect(harness.pendingCount()).toBe(0);
        // And the row keeps its name on the line that fired.
        expect(harness.ids()[1]).toBe(original);
        expect(harness.ids()[0]).not.toBe(original);

        // The typed line goes again. Nothing is left to say otherwise, so the
        // answer the ladder already committed stands.
        const placed = harness.ids().slice(0, 2);
        harness.contents.set(FILE, [BARE, GEN_STRIPPED, ''].join('\n'));
        await harness.scan();
        expect(harness.ids()).toEqual(placed);
    });
});

describe('an ordinary update, through the write layer', () => {
    // Stage 2-4a puts a claim behind every task update, not only behind a
    // firing. That makes twins — two rows reading exactly the same thing —
    // the common case rather than the exotic one, so they are what these
    // decide.
    //
    // The texts come from the formatter the writer uses, so a fixture cannot
    // drift from what `updateTaskInFile` actually puts on the line.
    const DONE = TaskParser.format(makeTask({ content: 'ポモドーロ', statusChar: 'x' }));

    /** What `updateTaskInFile` reports for a rewrite of the row at `at`. */
    const rewrite = (at: number): LineEdit[] => [{ kind: 'replaced', at }];

    it('leaves a twin\'s ID where it stands when the lower one is checked', async () => {
        const harness = new Harness();
        await harness.write([TASK, TASK, '']);
        const [first, second] = harness.ids();
        expect(first).not.toBe(second);

        harness.report([TASK, DONE, ''], rewrite(1));
        await harness.scan();

        expect(harness.ids()).toEqual([first, second]);
    });

    it('keeps both IDs in place when a check and an uncheck trade the two texts', async () => {
        // The shape the claim exists for. The first write checks the open row,
        // the second unchecks the done one, and no scan falls between them —
        // so the scan that does read sees the two original texts, in the other
        // order. Read verbatim that is a swap; the claims say it is not.
        const harness = new Harness();
        await harness.write([TASK, DONE, '']);
        const [open, done] = harness.ids();
        expect(open).not.toBe(done);

        harness.report([DONE, DONE, ''], rewrite(0));
        harness.report([DONE, TASK, ''], rewrite(1));

        await harness.scan();
        expect(harness.ids()).toEqual([open, done]);
    });

    it('is what stops that: with no claim behind either write the IDs swap', async () => {
        // The contrast, pinned so that a change to the ladder cannot quietly
        // make the claim above redundant — or quietly make it the only thing
        // holding the rows together without anyone noticing.
        const harness = new Harness();
        await harness.write([TASK, DONE, '']);
        const [open, done] = harness.ids();

        await harness.write([DONE, TASK, '']);

        expect(harness.ids()).toEqual([done, open]);
    });

    it('is a swap only while no scan reads between the two writes', async () => {
        // The same two unclaimed writes with one scan in between. That scan
        // reads the halfway state — both rows done — and holds the two rows
        // where they are, so the scan after the second write has no swap to
        // read. The missing scan is the whole condition, and what the test
        // above shows is that *that* order goes wrong, not how often it comes
        // up.
        const harness = new Harness();
        await harness.write([TASK, DONE, '']);
        const [open, done] = harness.ids();

        await harness.write([DONE, DONE, '']);
        expect(harness.ids()).toEqual([open, done]);

        await harness.write([DONE, TASK, '']);
        expect(harness.ids()).toEqual([open, done]);
    });

    it('changes nothing when the write landed on the wrong twin', async () => {
        // `findTaskLineNumber` falls back to the first row with the same text
        // when the stored line has shifted (FileOperations.ts:317-321), so a
        // write meant for the lower twin can land on the upper one. The claim
        // then says, truthfully, that the upper row is the one that changed.
        //
        // That is not a swap and it does not become one without the claim:
        // the ladder pairs what is left by nearest ordinal within the bucket
        // (IdentityMatcher.ts:311-319), which holds the order too. Both sides
        // are pinned because the interesting thing is that they agree — a
        // change to the ladder that made them disagree would be a change to
        // what a misplaced write looks like on screen.
        const claimed = new Harness();
        await claimed.write([TASK, TASK, '']);
        const [c1, c2] = claimed.ids();
        claimed.report([DONE, TASK, ''], [{ kind: 'replaced', at: 0 }]);
        await claimed.scan();
        expect(claimed.ids()).toEqual([c1, c2]);

        const bare = new Harness();
        await bare.write([TASK, TASK, '']);
        const [b1, b2] = bare.ids();
        await bare.write([DONE, TASK, '']);
        expect(bare.ids()).toEqual([b1, b2]);
    });

    it('adopts the claim when a quick check and uncheck put the text back', async () => {
        // Both the "nothing changed" candidate and the second claim reproduce
        // what was read, because the file came back to where it started. They
        // name the same ID for the row, so the disagreement that would throw
        // every candidate away never arises and the newest is adopted.
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        harness.report([DONE, ''], rewrite(0));
        harness.report([TASK, ''], rewrite(0));

        await harness.scan();
        expect(harness.ids()).toEqual([original]);
        expect(harness.pendingCount()).toBe(0);
    });

    it('takes the last of the claims a drag piled up', async () => {
        // Scans are skipped while a file is being dragged (TaskIndex.ts:111),
        // so several writes can file before anything reads. The read at the
        // end of the drag is the first to weigh them, and the newest that fits
        // is the one that decides — the earlier ones describe states the file
        // has moved past.
        const harness = new Harness();
        await harness.write([TASK, TASK, '']);
        const [first, second] = harness.ids();

        harness.report([DONE, TASK, ''], rewrite(0));
        harness.report([DONE, DONE, ''], rewrite(1));
        expect(harness.pendingCount()).toBe(2);

        await harness.scan();
        expect(harness.ids()).toEqual([first, second]);
        expect(harness.pendingCount()).toBe(0);
    });
});

describe('a rewrite that moves the row to another parser', () => {
    // The editor's menu writes through `updateLine` for plain checkboxes and
    // for third-party notations alike (TaskMenuExtension.ts:122), and one of
    // its items — convert to inline — rewrites a Tasks-plugin line into `@`
    // notation. The row is the same row, and the write says so, but the
    // parser that reads it changes.
    //
    // `reproduces` refuses a claim across parsers (IdentityHints.ts:361), so
    // the claim is dropped and the ladder decides — which, following the same
    // rule, mints a new name. That is a loss of identity, but it is the loss
    // every notation switch had before stage 2, and it is the safe direction:
    // a row is called new rather than handed a name that belonged to
    // something the other parser read.
    const TASKS_LINE = '- [ ] ポモドーロ 📅 2026-09-21';
    const INLINE_LINE = '- [ ] ポモドーロ @2026-09-21';

    afterEach(() => { TaskParser.rebuildChain(DEFAULT_SETTINGS); });

    it('drops the claim rather than carrying the name across', async () => {
        TaskParser.rebuildChain({ ...DEFAULT_SETTINGS, enableTasksPlugin: true });

        const harness = new Harness();
        await harness.write([TASKS_LINE, '']);
        const before = harness.ids()[0];
        // Not a fixture's word for it: the chain really reads this line with
        // the other parser, which is what makes the rewrite below a crossing.
        expect(harness.tasks()[0].parserId).toBe('tasks-plugin');

        harness.report([INLINE_LINE, ''], [{ kind: 'replaced', at: 0 }]);
        await harness.scan();

        expect(harness.tasks()[0].parserId).toBe('tv-inline');
        expect(harness.ids()[0]).not.toBe(before);
        expect(harness.pendingCount()).toBe(0);
    });

    it('is not what loses the name: the ladder does not cross either', async () => {
        // The same rewrite with nothing filed behind it. The name is lost here
        // too, so the claim is not what costs it — the rule against pairing
        // across parsers is older than the claim and is what both obey.
        TaskParser.rebuildChain({ ...DEFAULT_SETTINGS, enableTasksPlugin: true });

        const harness = new Harness();
        await harness.write([TASKS_LINE, '']);
        const before = harness.ids()[0];

        await harness.write([INLINE_LINE, '']);

        expect(harness.tasks()[0].parserId).toBe('tv-inline');
        expect(harness.ids()[0]).not.toBe(before);
    });
});

describe('the whole content decides which state was read', () => {
    it('refuses when two writes bring the file back to a content it had', async () => {
        // The one refusal the content cannot remove. A copy goes in above the
        // original, and the next write takes the original away: the file reads
        // exactly as it did before either write, so the scan reading it cannot
        // tell "neither write has landed" from "both have". The two answers
        // name different rows — the original, or the copy — and it takes
        // neither.
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        const [copy] = harness.report([TASK, TASK, ''], [{ kind: 'inserted', at: 0, count: 1 }]);
        harness.report([TASK, ''], [{ kind: 'removed', at: 1, count: 1 }]);
        await harness.scan();

        // I1: two readings, the ledger's (the original) and W2's (the copy),
        // name the one row differently, so it keeps neither and is new (was:
        // the ladder's answer, the original).
        const [row] = harness.ids();
        expect(harness.ids()).toHaveLength(1);
        expect(row).not.toBe(original);
        expect(row).not.toBe(copy);
        // Read as more than one state: what was filed before the read goes
        // with the commit, so neither may be believed about a later read.
        expect(harness.pendingCount()).toBe(0);
    });

    it('falls to the ladder when something else wrote between the write and the scan', async () => {
        // A sync or a linter touches a line no task stands on. The rows still
        // read as the claim says, but the file does not, and a claim is
        // believed about the file it describes or not at all. The ladder then
        // pairs against what the write left, the newest state known before
        // the sync (F5b); with no claim filed it pairs against the ledger.
        const external = [TASK, TASK, 'synced'];

        const control = new Harness();
        await control.write([TASK, '']);
        const controlOriginal = control.ids()[0];
        control.contents.set(FILE, external.join('\n'));
        await control.scan();

        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];
        harness.report([TASK, TASK, ''], [{ kind: 'inserted', at: 0, count: 1 }]);
        harness.contents.set(FILE, external.join('\n'));
        await harness.scan();

        const shape = (ids: string[], kept: string) => ids.map(id => (id === kept ? 'kept' : 'new'));
        // With nothing claimed, the ladder pairs by position and keeps the
        // top line. The write said the copy went on top, and the ladder
        // paired against what it left keeps the lower one, as the write did.
        expect(shape(control.ids(), controlOriginal)).toEqual(['kept', 'new']);
        expect(shape(harness.ids(), original)).toEqual(['new', 'kept']);
        // The claim was not believed, and the rows moved, so the record is gone.
        expect(harness.pendingCount()).toBe(0);
    });
});

describe('a later claim whose write was undone from outside (E1)', () => {
    // structure.md names this shape E1 in 「下流で読んだ内容がどの状態かを決め
    // る」. The whole content, the write's own record and `^id` cannot tell it
    // from the second write landing; the `modify` count can (F6): the undo is
    // a change no write of ours accounts for, so it is an outside mark in the
    // chain, and a record before it is never again weighed as its own write's.

    it('does not hand the copy\'s name to a line that reaches its content by another route', async () => {
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        // W1 puts a copy below the original; W2, built on W1, takes the
        // original (the upper line) away.
        const [copy] = harness.report([TASK, TASK, ''], [{ kind: 'inserted', at: 1, count: 1 }]);
        harness.report([TASK, ''], [{ kind: 'removed', at: 0, count: 1 }]);

        // W2 is taken back from outside (a sync, an undo) before any scan
        // reads it. The scan reads W1's content, but after an outside change:
        // it may be W1's state, or a change after W2, paired by the ladder
        // against W2's rows — the copy alone.
        harness.contents.set(FILE, [TASK, TASK, ''].join('\n'));
        await harness.scan();
        const [upper, lower] = harness.ids();
        // I1: W1 names the rows [original, copy]; the reading "after" gives
        // the copy's name, the only one W2 holds, to the upper line (nearest
        // ordinal). No name is agreed on, so both rows are new (was: the upper
        // kept the original, W1 adopted).
        expect(new Set([upper, lower, original, copy]).size).toBe(4);
        // I1: the outside mark was seen, and every record before it goes with
        // the commit (was: W2 left pending).
        expect(harness.pendingCount()).toBe(0);

        // A hand edit deletes the lower line. The file now reads exactly as W2
        // said it would, by the other route.
        harness.contents.set(FILE, [TASK, ''].join('\n'));
        await harness.scan();

        // I1: nothing of W2 is left to weigh, so the ladder pairs the one line
        // with the nearer previous row, the upper one (was: W2 adopted, and
        // the line took the name of the row just deleted).
        expect(harness.ids()).toEqual([upper]);
        expect(harness.ids()).not.toContain(copy);
        expect(harness.pendingCount()).toBe(0);
    });
});
