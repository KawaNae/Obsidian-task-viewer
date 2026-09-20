import { describe, it, expect } from 'vitest';
import {
    HintLog, MAX_HINTS_PER_FILE, HINT_TTL_MS,
    consumableHintCount, type Hint,
} from '../../../../../src/services/core/identity/IdentityHints';
import type { LedgerEntry } from '../../../../../src/services/core/identity/IdentityLedger';
import { fingerprintOf } from '../../../../../src/services/core/identity/IdentityFingerprint';
import { makeTask } from '../../../helpers/makeTask';
import type { Task } from '../../../../../src/types';

/**
 * The log the plugin's own writes leave behind, and the count test that decides
 * how much of it a scan may believe.
 */

const FILE = 'note.md';

function task(text: string, line: number): Task {
    return makeTask({ file: FILE, line, originalText: text, content: text.replace(/^- \[.\] /, '') });
}

function row(runtimeId: string, text: string, line: number): LedgerEntry {
    return {
        runtimeId,
        file: FILE,
        parent: null,
        ordinal: line,
        fingerprint: fingerprintOf(task(text, line)),
    };
}

const A = '- [ ] alpha @2026-09-21';
const B = '- [ ] beta @2026-09-21';
const A_DONE = '- [x] alpha @2026-09-21';

describe('HintLog', () => {
    it('keeps one file\'s hints in the order they were raised', () => {
        const log = new HintLog();
        log.add(FILE, { kind: 'insert', text: A, line: 0 }, 0);
        log.add(FILE, { kind: 'insert', text: B, line: 1 }, 0);

        expect(log.pendingFor(FILE, 0).map(entry => entry.hint.kind)).toEqual(['insert', 'insert']);
        expect(log.pendingFor(FILE, 0).map(entry => entry.seq)).toEqual([1, 2]);
    });

    it('files each path separately', () => {
        const log = new HintLog();
        log.add(FILE, { kind: 'insert', text: A, line: 0 }, 0);
        log.add('other.md', { kind: 'insert', text: B, line: 0 }, 0);

        expect(log.pendingFor(FILE, 0)).toHaveLength(1);
        expect(log.pendingFor('other.md', 0)).toHaveLength(1);
    });

    it('drops the oldest past the per-file limit', () => {
        const log = new HintLog();
        for (let i = 0; i <= MAX_HINTS_PER_FILE; i++) {
            log.add(FILE, { kind: 'insert', text: `${A}${i}`, line: i }, 0);
        }

        const pending = log.pendingFor(FILE, 0);
        expect(pending).toHaveLength(MAX_HINTS_PER_FILE);
        // The first one raised is the one that went.
        expect(pending[0].seq).toBe(2);
    });

    it('lets a hint expire', () => {
        const log = new HintLog();
        log.add(FILE, { kind: 'insert', text: A, line: 0 }, 1_000);

        expect(log.pendingFor(FILE, 1_000 + HINT_TTL_MS - 1)).toHaveLength(1);
        expect(log.pendingFor(FILE, 1_000 + HINT_TTL_MS)).toHaveLength(0);
    });

    it('follows a rename and forgets a delete', () => {
        const log = new HintLog();
        log.add(FILE, { kind: 'insert', text: A, line: 0 }, 0);

        log.rekeyFile(FILE, 'moved.md');
        expect(log.pendingFor(FILE, 0)).toHaveLength(0);
        expect(log.pendingFor('moved.md', 0)).toHaveLength(1);

        log.dropFile('moved.md');
        expect(log.pendingFor('moved.md', 0)).toHaveLength(0);
    });
});

describe('HintLog.settle', () => {
    it('retires what the scan believed', () => {
        const log = new HintLog();
        log.add(FILE, { kind: 'insert', text: A, line: 0 }, 0);
        log.add(FILE, { kind: 'insert', text: B, line: 1 }, 0);

        log.settle(FILE, 1, 0, 0);

        expect(log.pendingFor(FILE, 0).map(entry => entry.seq)).toEqual([2]);
    });

    it('retires an unbelieved hint the scan has now read past', () => {
        // The scan read after this hint was raised and committed a ledger that
        // already accounts for it. Keeping it would block everything behind it
        // until it aged out — it can never verify again.
        const log = new HintLog();
        log.add(FILE, { kind: 'insert', text: A, line: 0 }, 0);
        const readTip = log.tip(FILE);

        log.settle(FILE, 0, readTip, 0);

        expect(log.pendingFor(FILE, 0)).toHaveLength(0);
    });

    it('keeps a hint raised after the scan started reading', () => {
        // The read may have missed it, so it still has a scan coming.
        const log = new HintLog();
        const readTip = log.tip(FILE);
        log.add(FILE, { kind: 'insert', text: A, line: 0 }, 0);

        log.settle(FILE, 0, readTip, 0);

        expect(log.pendingFor(FILE, 0)).toHaveLength(1);
    });

    it('lets the next write\'s hint work after one went unbelieved', () => {
        // The shape that would otherwise deadlock a file for the whole TTL:
        // h1 fails verification (an external edit landed in the same scan), the
        // ledger moves on, and every later hint is measured against a state h1
        // has already been folded into.
        const log = new HintLog();
        log.add(FILE, { kind: 'insert', text: A, line: 0 }, 0);

        const firstRead = log.tip(FILE);
        log.settle(FILE, 0, firstRead, 0);

        log.add(FILE, { kind: 'insert', text: B, line: 1 }, 0);
        const pending = log.pendingFor(FILE, 0);

        expect(pending).toHaveLength(1);
        expect(pending[0].hint).toMatchObject({ kind: 'insert', text: B });
    });
});

describe('consumableHintCount', () => {
    const pendingOf = (...hints: Hint[]) => hints.map((hint, i) => ({ seq: i + 1, at: 0, hint }));

    it('believes an insert only once the file holds one more of that line', () => {
        const previous = [row('r1', A, 0)];
        const insert = pendingOf({ kind: 'insert', text: A, line: 0 });

        // Before the write lands: the line is there, but there is still one.
        // "Is there a line reading A?" would say yes — the count says no.
        expect(consumableHintCount(previous, [task(A, 0)], insert)).toBe(0);
        // After: two.
        expect(consumableHintCount(previous, [task(A, 0), task(A, 1)], insert)).toBe(1);
    });

    it('believes a rewrite when the old text went and the new one came', () => {
        const previous = [row('r1', A, 0), row('r2', B, 1)];
        const rewrite = pendingOf({ kind: 'rewrite', runtimeId: 'r1', before: A, after: A_DONE, line: 0 });

        expect(consumableHintCount(previous, [task(A, 0), task(B, 1)], rewrite)).toBe(0);
        expect(consumableHintCount(previous, [task(A_DONE, 0), task(B, 1)], rewrite)).toBe(1);
    });

    it('believes a retire when the line is one fewer', () => {
        const previous = [row('r1', A, 0), row('r2', B, 1)];
        const retire = pendingOf({ kind: 'retire', runtimeId: 'r1', text: A });

        expect(consumableHintCount(previous, [task(A, 0), task(B, 1)], retire)).toBe(0);
        expect(consumableHintCount(previous, [task(B, 0)], retire)).toBe(1);
    });

    it('believes two writes at once when one scan read both', () => {
        // Measured: a scan whose read overlaps a second write sees both.
        const previous = [row('r1', A, 0)];
        const both = pendingOf(
            { kind: 'insert', text: A, line: 0 },
            { kind: 'rewrite', runtimeId: 'r1', before: A, after: A_DONE, line: 1 },
        );

        expect(consumableHintCount(previous, [task(A, 0), task(A_DONE, 1)], both)).toBe(2);
    });

    it('believes nothing when the read predates every hint', () => {
        const previous = [row('r1', A, 0)];
        const pending = pendingOf(
            { kind: 'insert', text: A, line: 0 },
            { kind: 'rewrite', runtimeId: 'r1', before: A, after: A_DONE, line: 1 },
        );

        expect(consumableHintCount(previous, [task(A, 0)], pending)).toBe(0);
    });

    it('believes nothing when an external edit arrived in the same scan', () => {
        const previous = [row('r1', A, 0)];
        const insert = pendingOf({ kind: 'insert', text: A, line: 0 });

        // Two A lines as claimed, plus a line nobody told us about.
        const read = [task(A, 0), task(A, 1), task('- [ ] typed by hand', 2)];
        expect(consumableHintCount(previous, read, insert)).toBe(0);
    });

    it('stops at the write the read reached', () => {
        const previous = [row('r1', A, 0)];
        const pending = pendingOf(
            { kind: 'insert', text: A, line: 0 },
            { kind: 'insert', text: B, line: 2 },
        );

        expect(consumableHintCount(previous, [task(A, 0), task(A, 1)], pending)).toBe(1);
    });
});
