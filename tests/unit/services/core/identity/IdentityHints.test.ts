import { describe, it, expect } from 'vitest';
import {
    HintLog, MAX_HINTS_PER_FILE, HINT_TTL_MS,
    resolveHints, type Hint,
} from '../../../../../src/services/core/identity/IdentityHints';
import type { LedgerEntry } from '../../../../../src/services/core/identity/IdentityLedger';
import { fingerprintOf } from '../../../../../src/services/core/identity/IdentityFingerprint';
import { makeTask } from '../../../helpers/makeTask';
import type { Task } from '../../../../../src/types';

/**
 * The log the plugin's own writes leave behind, and the replay that decides how
 * much of it a scan may believe.
 */

const FILE = 'note.md';

function task(text: string, line: number, extra: Partial<Task> = {}): Task {
    return makeTask({
        file: FILE, line, originalText: text,
        content: text.replace(/^- \[.\] /, ''),
        ...extra,
    });
}

function row(runtimeId: string, text: string, line: number, extra: Partial<Task> = {}): LedgerEntry {
    return {
        runtimeId,
        file: FILE,
        parent: null,
        ordinal: line,
        fingerprint: fingerprintOf(task(text, line, extra)),
    };
}

const A = '- [ ] alpha @2026-09-21';
const B = '- [ ] beta @2026-09-21';
const A_DONE = '- [x] alpha @2026-09-21';

const pendingOf = (...hints: Hint[]) => hints.map((hint, i) => ({ seq: i + 1, at: 0, hint }));

describe('HintLog', () => {
    it('keeps one file\'s hints in the order they were raised', () => {
        const log = new HintLog();
        log.add(FILE, [{ kind: 'retire', runtimeId: 'r1' }], 0);
        log.add(FILE, [{ kind: 'retire', runtimeId: 'r2' }], 0);

        expect(log.pendingFor(FILE, 0).map(entry => entry.seq)).toEqual([1, 2]);
    });

    it('files each path separately', () => {
        const log = new HintLog();
        log.add(FILE, [{ kind: 'retire', runtimeId: 'r1' }], 0);
        log.add('other.md', [{ kind: 'retire', runtimeId: 'r2' }], 0);

        expect(log.pendingFor(FILE, 0)).toHaveLength(1);
        expect(log.pendingFor('other.md', 0)).toHaveLength(1);
    });

    it('drops the oldest past the per-file limit', () => {
        const log = new HintLog();
        for (let i = 0; i <= MAX_HINTS_PER_FILE; i++) {
            log.add(FILE, [{ kind: 'retire', runtimeId: `r${i}` }], 0);
        }

        const pending = log.pendingFor(FILE, 0);
        expect(pending).toHaveLength(MAX_HINTS_PER_FILE);
        expect(pending[0].seq).toBe(2);
    });

    it('lets a hint expire', () => {
        const log = new HintLog();
        log.add(FILE, [{ kind: 'retire', runtimeId: 'r1' }], 1_000);

        expect(log.pendingFor(FILE, 1_000 + HINT_TTL_MS - 1)).toHaveLength(1);
        expect(log.pendingFor(FILE, 1_000 + HINT_TTL_MS)).toHaveLength(0);
    });

    it('forgets a file on request', () => {
        const log = new HintLog();
        log.add(FILE, [{ kind: 'retire', runtimeId: 'r1' }], 0);

        log.dropFile(FILE);

        expect(log.pendingFor(FILE, 0)).toHaveLength(0);
    });

    it('takes a write\'s claims back when the write failed', () => {
        // A `vault.process` that throws after the callback leaves the file as
        // it was; claims about it describe a state that never existed.
        const log = new HintLog();
        log.add(FILE, [{ kind: 'retire', runtimeId: 'kept' }], 0);
        const withdraw = log.add(FILE, [
            { kind: 'retire', runtimeId: 'gone1' },
            { kind: 'retire', runtimeId: 'gone2' },
        ], 0);

        withdraw();

        expect(log.pendingFor(FILE, 0).map(entry => (entry.hint as { runtimeId: string }).runtimeId))
            .toEqual(['kept']);
    });
});

describe('HintLog.settle', () => {
    it('retires what the scan believed', () => {
        const log = new HintLog();
        log.add(FILE, [{ kind: 'retire', runtimeId: 'r1' }], 0);
        log.add(FILE, [{ kind: 'retire', runtimeId: 'r2' }], 0);

        log.settle(FILE, 1, 0, 0, true);

        expect(log.pendingFor(FILE, 0).map(entry => entry.seq)).toEqual([2]);
    });

    it('retires an unbelieved hint the scan has now read past', () => {
        const log = new HintLog();
        log.add(FILE, [{ kind: 'retire', runtimeId: 'r1' }], 0);
        const readTip = log.tip(FILE);

        log.settle(FILE, 0, readTip, 0, false);

        expect(log.pendingFor(FILE, 0)).toHaveLength(0);
    });

    it('keeps a hint raised after the scan started reading', () => {
        const log = new HintLog();
        const readTip = log.tip(FILE);
        log.add(FILE, [{ kind: 'retire', runtimeId: 'r1' }], 0);

        log.settle(FILE, 0, readTip, 0, false);

        expect(log.pendingFor(FILE, 0)).toHaveLength(1);
    });

    it('lets the next write\'s hint work after one went unbelieved', () => {
        // The shape that would otherwise deadlock a file for the whole TTL.
        const log = new HintLog();
        log.add(FILE, [{ kind: 'retire', runtimeId: 'r1' }], 0);

        log.settle(FILE, 0, log.tip(FILE), 0, false);

        log.add(FILE, [{ kind: 'retire', runtimeId: 'r2' }], 0);
        const pending = log.pendingFor(FILE, 0);

        expect(pending).toHaveLength(1);
        expect(pending[0].hint).toMatchObject({ runtimeId: 'r2' });
    });

    it('drops everything when a scan believed nothing and still moved the rows', () => {
        // The hint was raised after this scan took its position, so the tip
        // rule alone would keep it — but the scan's read already contained the
        // write it describes, and the ladder placed that write its own way.
        // Replaying the claim over the new rows would apply it twice.
        const log = new HintLog();
        const readTip = log.tip(FILE);
        log.add(FILE, [{ kind: 'retire', runtimeId: 'r1' }], 0);

        log.settle(FILE, 0, readTip, 0, true);

        expect(log.pendingFor(FILE, 0)).toHaveLength(0);
    });

    it('keeps a hint when the scan believed nothing and changed nothing', () => {
        // The window the design accepts: the scan read the file from before the
        // write. Nothing moved, so the claim still has its own scan coming.
        const log = new HintLog();
        const readTip = log.tip(FILE);
        log.add(FILE, [{ kind: 'retire', runtimeId: 'r1' }], 0);

        log.settle(FILE, 0, readTip, 0, false);

        expect(log.pendingFor(FILE, 0)).toHaveLength(1);
    });
});

describe('resolveHints: what the file bears out', () => {
    it('believes an insert once the file holds the extra line', () => {
        const previous = [row('r1', A, 0)];
        const insert = pendingOf({ kind: 'insert', text: A, anchor: 'r1', side: 'before' });

        // Before the write lands, the rebuilt file has two lines and the read
        // has one.
        expect(resolveHints(previous, [task(A, 0)], insert).consumed).toBe(0);

        const after = resolveHints(previous, [task(A, 0), task(A, 1)], insert);
        expect(after.consumed).toBe(1);
        expect(after.rows).toEqual([
            { runtimeId: null, text: A },
            { runtimeId: 'r1', text: A },
        ]);
    });

    it('believes a rewrite that starts from the text the row holds', () => {
        const previous = [row('r1', A, 0), row('r2', B, 1)];
        const rewrite = pendingOf({ kind: 'rewrite', runtimeId: 'r1', before: A, after: A_DONE });

        expect(resolveHints(previous, [task(A, 0), task(B, 1)], rewrite).consumed).toBe(0);
        expect(resolveHints(previous, [task(A_DONE, 0), task(B, 1)], rewrite).consumed).toBe(1);
    });

    it('refuses a rewrite whose starting text is not what the row holds', () => {
        // The claim is about some other state of the file. Another row reading
        // `before` does not make it true.
        const previous = [row('r1', A, 0), row('r2', B, 1)];
        const wrong = pendingOf({ kind: 'rewrite', runtimeId: 'r1', before: B, after: A_DONE });

        expect(resolveHints(previous, [task(A_DONE, 0), task(B, 1)], wrong).consumed).toBe(0);
    });

    it('believes a retire', () => {
        const previous = [row('r1', A, 0), row('r2', B, 1)];
        const retire = pendingOf({ kind: 'retire', runtimeId: 'r1' });

        const resolved = resolveHints(previous, [task(B, 0)], retire);
        expect(resolved.consumed).toBe(1);
        expect(resolved.rows).toEqual([{ runtimeId: 'r2', text: B }]);
    });

    it('believes two writes at once when one scan read both', () => {
        const previous = [row('r1', A, 0)];
        const both = pendingOf(
            { kind: 'insert', text: A, anchor: 'r1', side: 'before' },
            { kind: 'rewrite', runtimeId: 'r1', before: A, after: A_DONE },
        );

        const resolved = resolveHints(previous, [task(A, 0), task(A_DONE, 1)], both);
        expect(resolved.consumed).toBe(2);
        expect(resolved.rows).toEqual([
            { runtimeId: null, text: A },
            { runtimeId: 'r1', text: A_DONE },
        ]);
    });

    it('believes nothing when the read predates every hint', () => {
        const previous = [row('r1', A, 0)];
        const pending = pendingOf(
            { kind: 'insert', text: A, anchor: 'r1', side: 'before' },
            { kind: 'rewrite', runtimeId: 'r1', before: A, after: A_DONE },
        );

        expect(resolveHints(previous, [task(A, 0)], pending).consumed).toBe(0);
    });

    it('believes nothing when an external edit arrived in the same scan', () => {
        const previous = [row('r1', A, 0)];
        const insert = pendingOf({ kind: 'insert', text: A, anchor: 'r1', side: 'before' });

        const read = [task(A, 0), task(A, 1), task('- [ ] typed by hand', 2)];
        expect(resolveHints(previous, read, insert).consumed).toBe(0);
    });

    it('stops at the write the read reached', () => {
        const previous = [row('r1', A, 0)];
        const pending = pendingOf(
            { kind: 'insert', text: A, anchor: 'r1', side: 'before' },
            { kind: 'insert', text: B, anchor: 'r1', side: 'after' },
        );

        expect(resolveHints(previous, [task(A, 0), task(A, 1)], pending).consumed).toBe(1);
    });

    it('stops at a hint it cannot apply', () => {
        // The anchor is not in the file any more, so nothing after this claim
        // describes a state this file passed through.
        const previous = [row('r1', A, 0)];
        const pending = pendingOf(
            { kind: 'insert', text: B, anchor: 'missing', side: 'after' },
            { kind: 'rewrite', runtimeId: 'r1', before: A, after: A_DONE },
        );

        expect(resolveHints(previous, [task(A_DONE, 0)], pending).consumed).toBe(0);
    });

    it('refuses to hand a row to a line another parser now owns', () => {
        // Turning a third-party notation off leaves the text alone and changes
        // the parser. The ladder never pairs across parsers; neither does this.
        const previous = [row('r1', A, 0)];
        const rewrite = pendingOf({ kind: 'rewrite', runtimeId: 'r1', before: A, after: A_DONE });

        const read = [task(A_DONE, 0, { parserId: 'tasks-plugin' })];
        expect(resolveHints(previous, read, rewrite).consumed).toBe(0);
    });
});

describe('resolveHints: the shapes a position-based match got wrong', () => {
    // Each of these was answered incorrectly when claims were matched to lines
    // by the line number the write recorded. Replaying the file removes the
    // question.

    it('follows two rewrites of one row through a text a sibling also has', () => {
        // A goes d1 → d2 → d3 while B sits at d2 the whole time. Matching the
        // first claim by text would hand A's identity to B's line.
        const previous = [row('a', '- [ ] foo @d1', 0), row('b', '- [ ] foo @d2', 1)];
        const chained = pendingOf(
            { kind: 'rewrite', runtimeId: 'a', before: '- [ ] foo @d1', after: '- [ ] foo @d2' },
            { kind: 'rewrite', runtimeId: 'a', before: '- [ ] foo @d2', after: '- [ ] foo @d3' },
        );

        const resolved = resolveHints(
            previous,
            [task('- [ ] foo @d3', 0), task('- [ ] foo @d2', 1)],
            chained,
        );

        expect(resolved.consumed).toBe(2);
        expect(resolved.rows).toEqual([
            { runtimeId: 'a', text: '- [ ] foo @d3' },
            { runtimeId: 'b', text: '- [ ] foo @d2' },
        ]);
    });

    it('retires the row the write retired, not its twin', () => {
        const previous = [row('a', '- [ ] foo @d1', 0), row('b', '- [ ] foo @d2', 1)];
        const pending = pendingOf(
            { kind: 'rewrite', runtimeId: 'a', before: '- [ ] foo @d1', after: '- [ ] foo @d2' },
            { kind: 'retire', runtimeId: 'a' },
        );

        const resolved = resolveHints(previous, [task('- [ ] foo @d2', 0)], pending);

        expect(resolved.consumed).toBe(2);
        expect(resolved.rows).toEqual([{ runtimeId: 'b', text: '- [ ] foo @d2' }]);
    });

    it('is unmoved by a retire above the line it inserted', () => {
        const previous = [row('z', '- [ ] gone @d0', 0), row('a', '- [ ] T @d1', 5)];
        const pending = pendingOf(
            { kind: 'insert', text: '- [ ] T @d1', anchor: 'a', side: 'before' },
            { kind: 'retire', runtimeId: 'z' },
        );

        const resolved = resolveHints(
            previous,
            [task('- [ ] T @d1', 4), task('- [ ] T @d1', 5)],
            pending,
        );

        expect(resolved.consumed).toBe(2);
        expect(resolved.rows).toEqual([
            { runtimeId: null, text: '- [ ] T @d1' },
            { runtimeId: 'a', text: '- [ ] T @d1' },
        ]);
    });

    it('keeps the original\'s identity when the same task is duplicated twice', () => {
        // Both copies go below the original, the second pushing the first down.
        // By position the second claim is a tie between two identical lines.
        const previous = [row('a', '- [ ] T @d1', 0)];
        const twice = pendingOf(
            { kind: 'insert', text: '- [ ] T @d1', anchor: 'a', side: 'after' },
            { kind: 'insert', text: '- [ ] T @d1', anchor: 'a', side: 'after' },
        );

        const resolved = resolveHints(
            previous,
            [task('- [ ] T @d1', 0), task('- [ ] T @d1', 1), task('- [ ] T @d1', 2)],
            twice,
        );

        expect(resolved.consumed).toBe(2);
        expect(resolved.rows?.[0]).toEqual({ runtimeId: 'a', text: '- [ ] T @d1' });
        expect(resolved.rows?.slice(1).every(claim => claim.runtimeId === null)).toBe(true);
    });

    it('does not let a stale claim stand in for a real one elsewhere', () => {
        // The first write never landed; the second duplicated B, far away. The
        // rebuilt file puts the new line next to B, not next to A.
        const previous = [row('a', '- [ ] T @d1', 0), row('b', '- [ ] T @d1', 19)];
        const pending = pendingOf(
            { kind: 'insert', text: '- [ ] T @d1', anchor: 'a', side: 'after' },
            { kind: 'insert', text: '- [ ] T @d1', anchor: 'b', side: 'before' },
        );

        const resolved = resolveHints(
            previous,
            [task('- [ ] T @d1', 0), task('- [ ] T @d1', 19), task('- [ ] T @d1', 20)],
            pending,
        );

        // Believing only the stale claim would put the new line at index 1 and
        // hand B's identity to the last line. It reproduces the read by
        // accident — which is why the claims carry an anchor, not a position.
        expect(resolved.rows?.[0]).toEqual({ runtimeId: 'a', text: '- [ ] T @d1' });
        expect(resolved.rows?.[1]).toEqual({ runtimeId: null, text: '- [ ] T @d1' });
        expect(resolved.rows?.[2]).toEqual({ runtimeId: 'b', text: '- [ ] T @d1' });
    });
});
