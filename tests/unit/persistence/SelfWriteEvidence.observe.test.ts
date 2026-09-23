import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeBench, FILE, type WriteBench } from '../helpers/writeBench';
import type { Task } from '../../../src/types';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import { HINT_TTL_MS } from '../../../src/services/core/identity/IdentityHints';

/**
 * Observation for stage F6, not a gate: the four shapes where what a scan
 * reads cannot say which state it was built on (E1, E1 by the ladder, S2c on
 * an earlier write's lines, C2), each beside a control that must keep its
 * answer, and what three candidate kinds of evidence outside the content
 * would say about each.
 *
 * - `modify`: how many changes that were not ours reached the file between
 *   the write the decision rests on and the read.
 * - mtime: whether the last landing before the read is that write. Here a
 *   landing is a tick, so this answers what a landing mtime would when the
 *   clock is fine enough.
 * - nearest: of the states known when the read comes (the ledger, each write
 *   of ours since), the one with the fewest line insertions and deletions to
 *   the read, taken as what an outside writer built on.
 *
 * Nothing here changes a decision: the bench records, the tests compare. The
 * identity outcomes pin what the code does today (the same as E1, OPEN and
 * LIMIT elsewhere); the evidence rows are what `observation.md` tabulates.
 */

afterEach(() => { vi.restoreAllMocks(); });

type Event =
    | { kind: 'own'; tick: number; after: string[] }
    | { kind: 'foreign'; tick: number; after: string[] }
    | { kind: 'read'; tick: number; lines: string[] };

interface Recorder {
    events: Event[];
    /** Every write of ours, in landing order. */
    own(): Array<Extract<Event, { kind: 'own' }>>;
    /** What the last scan before now read (the ledger's content). */
    ledger(): string[];
}

function record(bench: WriteBench): Recorder {
    const events: Event[] = [];
    let tick = 0;
    const ledger = { lines: bench.lines() };
    const process = bench.app.vault.process;
    bench.app.vault.process = async (file: { path: string }, fn: (data: string) => string) => {
        const before = bench.contents.get(file.path) ?? '';
        const next = await process(file, fn);
        if (next !== before) events.push({ kind: 'own', tick: ++tick, after: next.split('\n') });
        return next;
    };
    const edit = bench.edit;
    (bench as { edit: WriteBench['edit'] }).edit = (text, path) => {
        edit(text, path);
        events.push({ kind: 'foreign', tick: ++tick, after: bench.lines(path) });
    };
    const read = bench.app.vault.read;
    bench.app.vault.read = async (file: { path: string }) => {
        const text = await read(file);
        events.push({ kind: 'read', tick: ++tick, lines: text.split('\n') });
        return text;
    };
    const scan = bench.scan;
    (bench as { scan: WriteBench['scan'] }).scan = async path => {
        await scan(path);
        const last = [...events].reverse().find(e => e.kind === 'read') as Extract<Event, { kind: 'read' }> | undefined;
        if (last) ledger.lines = last.lines;
    };
    return {
        events,
        own: () => events.filter((e): e is Extract<Event, { kind: 'own' }> => e.kind === 'own'),
        ledger: () => ledger.lines,
    };
}

/** Line insertions plus deletions between two contents (LCS). */
function lineDistance(a: readonly string[], b: readonly string[]): number {
    const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    return a.length + b.length - 2 * dp[0][0];
}

interface Evidence {
    /** Changes not ours between `rest` landing and the read. */
    foreignSince: number;
    /** The last landing before the read is `rest`. */
    lastLanding: boolean;
    /** The known states nearest the read, ties kept: 'ledger', or the index of a write of ours. */
    nearest: Array<'ledger' | number>;
}

/**
 * What the evidence says about the last read, for a decision resting on write
 * `rest` (an index into the writes of ours). `known` are the states known at
 * the read: the ledger's, and the writes of ours the ledger has not read.
 */
function evidence(rec: Recorder, rest: number, known: { ledger: string[]; writes: number[] }): Evidence {
    const reads = rec.events.filter(e => e.kind === 'read');
    const read = reads[reads.length - 1] as Extract<Event, { kind: 'read' }>;
    const own = rec.own();
    const landed = own[rest];
    const foreignSince = rec.events.filter(e => e.kind === 'foreign' && e.tick > landed.tick && e.tick < read.tick).length;
    const last = [...rec.events].reverse().find(e => (e.kind === 'own' || e.kind === 'foreign') && e.tick < read.tick);
    const scored: Array<{ state: 'ledger' | number; d: number }> = [
        { state: 'ledger', d: lineDistance(known.ledger, read.lines) },
        ...known.writes.map(w => ({ state: w, d: lineDistance(own[w].after, read.lines) })),
    ];
    const best = Math.min(...scored.map(s => s.d));
    const nearest = scored.filter(s => s.d === best).map(s => s.state);
    return { foreignSince, lastLanding: last === landed, nearest };
}

const checked = (task: Task): Task => ({ ...task, statusChar: 'x' });

/** X and Y read `[ ] A` and `[x] A`; two updates trade their texts, no scan in between. */
async function traded(bench: WriteBench): Promise<{ x: Task; y: Task }> {
    const x = bench.taskAt(0);
    const y = bench.taskAt(1);
    expect((await bench.writer.updateTaskInFile(plannedOn(x), checked(x))).written).toBe(true);
    expect((await bench.writer.updateTaskInFile(plannedOn(y), { ...y, statusChar: ' ' })).written).toBe(true);
    return { x, y };
}

/** W1 appends a copy of the one row; W2, built on W1, removes the original. */
async function copyThenRemove(bench: WriteBench): Promise<{ original: Task }> {
    const original = bench.taskAt(0);
    expect(await bench.writer.appendTaskToFile(FILE, '- [ ] T', 'user')).toBeGreaterThanOrEqual(0);
    expect(await bench.writer.deleteTaskFromFile(plannedOn(original, { subtree: true }))).toBe(true);
    return { original };
}

describe('E1: a later claim adopted after its write was undone and the content reached again', () => {
    // W2 takes the file back to the ledger's content, so the nearest state is
    // a tie between the ledger and W2 in the shape and the control alike.
    it('shape: the original is named as the copy; modify and mtime tell it, nearest cannot', async () => {
        const bench = await writeBench(['- [ ] T', '']);
        const rec = record(bench);
        const { original } = await copyThenRemove(bench);
        const [w1] = rec.own();
        bench.edit(w1.after);                 // W2 undone from outside
        await bench.scan();                   // adopts W1, leaves W2 pending
        const copy = bench.tasks()[1].id;
        const ledger = rec.ledger();
        bench.edit(['- [ ] T', '']);          // by hand: the copy (lower line) goes
        await bench.scan();
        expect(bench.tasks().map(t => t.id)).toEqual([copy]);   // wrong: the original stands there
        expect(original.id).not.toBe(copy);
        expect(evidence(rec, 1, { ledger, writes: [1] })).toEqual({ foreignSince: 2, lastLanding: false, nearest: [1] });
    });

    it('control: W2 lands and the scan reads it; modify and mtime keep the claim', async () => {
        const bench = await writeBench(['- [ ] T', '']);
        const rec = record(bench);
        await copyThenRemove(bench);
        const ledger = rec.ledger();
        await bench.scan();
        expect(evidence(rec, 1, { ledger, writes: [0, 1] })).toEqual({ foreignSince: 0, lastLanding: true, nearest: ['ledger', 1] });
    });
});

describe('E1 by the ladder: claims past their age, the file leaves the newest record and comes back', () => {
    // After the trade, Y's line is checked by hand and X's line goes; a new
    // unchecked line is typed below. The file reads as the trade left it, so
    // the ladder pairs against the newest record and hands X's name to Y's row.
    it('shape: X\'s name goes to Y\'s row; modify and mtime tell it, nearest cannot', async () => {
        const bench = await writeBench(['- [ ] A', '- [x] A']);
        const rec = record(bench);
        const { x, y } = await traded(bench);
        const ledger = rec.ledger();
        bench.edit(['- [x] A']);
        bench.edit(['- [x] A', '- [ ] A']);
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + HINT_TTL_MS + 1);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(x.id);   // wrong: Y's row
        expect(bench.tasks().map(t => t.id)).not.toContain(undefined);
        expect(y.id).not.toBe(x.id);
        expect(evidence(rec, 1, { ledger, writes: [0, 1] })).toEqual({ foreignSince: 2, lastLanding: false, nearest: [1] });
    });

    it('control: claims past their age, the trade read as it landed; modify and mtime keep the partner', async () => {
        const bench = await writeBench(['- [ ] A', '- [x] A']);
        const rec = record(bench);
        const { x, y } = await traded(bench);
        const ledger = rec.ledger();
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + HINT_TTL_MS + 1);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
        expect(evidence(rec, 1, { ledger, writes: [0, 1] })).toEqual({ foreignSince: 0, lastLanding: true, nearest: [1] });
    });
});

describe('S2c on an earlier write\'s lines (OPEN)', () => {
    /** Start a scan that reads now and commits only when released. */
    async function gatedScan(bench: WriteBench): Promise<{ release: () => void; done: Promise<void> }> {
        let reading!: () => void;
        const called = new Promise<void>(resolve => { reading = resolve; });
        const read = bench.app.vault.read;
        let open!: () => void;
        const gate = new Promise<void>(resolve => { open = resolve; });
        bench.app.vault.read = async (file: { path: string }) => {
            const text = await read(file);
            reading();
            await gate;
            return text;
        };
        const done = bench.scan();
        await called;
        return { release: () => { open(); bench.app.vault.read = read; }, done };
    }

    // The shape needs a scan that adopted nothing in between: with the
    // claims still in the log, a read of W2's lines adopts them and is right.
    // A read that raced the third write cannot come here either: scans of one
    // file queue, so the next read comes after the commit that kept all three
    // records, and a write filed after that commit leaves a mark, under which
    // W2's lines pair against W2. What is left is the third write undone from
    // outside, as the OPEN test has it.
    it('shape (a third write undone from outside): the ledger pairs across two writes; modify and mtime say "not W2 as it landed"', async () => {
        const bench = await writeBench(['- [ ] A', '- [ ] B']);
        const rec = record(bench);
        const x = bench.taskAt(0);
        const y = bench.taskAt(1);
        const ledger = ['- [ ] A', '- [ ] B'];
        const scan = await gatedScan(bench);
        expect((await bench.writer.updateTaskInFile(plannedOn(x), { ...x, content: 'B', originalText: '- [ ] B' })).written).toBe(true);
        expect((await bench.writer.updateTaskInFile(plannedOn(y), { ...y, content: 'A', originalText: '- [ ] A' })).written).toBe(true);
        await bench.writer.appendTaskToFile(FILE, '- [ ] Z', 'user');
        scan.release();
        await scan.done;
        bench.edit(rec.own()[1].after);
        await bench.scan();
        // Truth: X reads B on the top line. The ledger pairs by text.
        expect(bench.taskAt(1).id).toBe(x.id);
        expect(bench.taskAt(0).id).toBe(y.id);
        expect(evidence(rec, 1, { ledger, writes: [0, 1, 2] })).toEqual({ foreignSince: 1, lastLanding: false, nearest: [1] });
    });

    it('control: the same writes read as the third left them; the newest record pairs and is right', async () => {
        const bench = await writeBench(['- [ ] A', '- [ ] B']);
        const rec = record(bench);
        const x = bench.taskAt(0);
        const y = bench.taskAt(1);
        const ledger = ['- [ ] A', '- [ ] B'];
        const scan = await gatedScan(bench);
        expect((await bench.writer.updateTaskInFile(plannedOn(x), { ...x, content: 'B', originalText: '- [ ] B' })).written).toBe(true);
        expect((await bench.writer.updateTaskInFile(plannedOn(y), { ...y, content: 'A', originalText: '- [ ] A' })).written).toBe(true);
        await bench.writer.appendTaskToFile(FILE, '- [ ] Z', 'user');
        scan.release();
        await scan.done;
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
        expect(evidence(rec, 2, { ledger, writes: [0, 1, 2] })).toEqual({ foreignSince: 0, lastLanding: true, nearest: [2] });
    });
});

describe('C2: an outside write built on the file before our writes (LIMIT), beside S2c by hand', () => {
    it('shape (built on the ledger): the newest record pairs, X and Y trade; nearest says ledger, modify and mtime cannot tell', async () => {
        const bench = await writeBench(['- [ ] A', '- [x] A']);
        const rec = record(bench);
        const { x, y } = await traded(bench);
        const ledger = rec.ledger();
        bench.edit(['- [ ] A', '- [x] A', 'メモ']);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(y.id);   // wrong: X stands on the top line
        expect(bench.taskAt(1).id).toBe(x.id);
        expect(evidence(rec, 1, { ledger, writes: [0, 1] })).toEqual({ foreignSince: 1, lastLanding: false, nearest: ['ledger'] });
    });

    it('control (built on the newest state, S2c by hand): X and Y right; nearest says W2, modify and mtime the same as C2', async () => {
        const bench = await writeBench(['- [ ] A', '- [x] A']);
        const rec = record(bench);
        const { x, y } = await traded(bench);
        const ledger = rec.ledger();
        bench.edit(['- [x] A', '- [ ] A', 'メモ']);
        await bench.scan();
        expect(bench.taskAt(0).id).toBe(x.id);
        expect(bench.taskAt(1).id).toBe(y.id);
        expect(evidence(rec, 1, { ledger, writes: [0, 1] })).toEqual({ foreignSince: 1, lastLanding: false, nearest: [1] });
    });
});
