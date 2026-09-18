import { describe, it, expect } from 'vitest';
import { IdentityLedger, type LedgerEntry } from '../../../../../src/services/core/identity/IdentityLedger';
import { fingerprintOf } from '../../../../../src/services/core/identity/IdentityFingerprint';
import { makeTask } from '../../../helpers/makeTask';

function entry(runtimeId: string, file: string, parent: string | null, ordinal: number): LedgerEntry {
    return {
        runtimeId,
        file,
        parent,
        ordinal,
        fingerprint: fingerprintOf(makeTask({ id: runtimeId, file, content: runtimeId })),
    };
}

describe('IdentityLedger', () => {
    it('gives a file back in stored order', () => {
        const ledger = new IdentityLedger();
        ledger.replaceFile('a.md', [
            entry('r1', 'a.md', null, 0),
            entry('r2', 'a.md', 'r1', 0),
            entry('r3', 'a.md', null, 1),
        ]);

        expect(ledger.snapshotFor('a.md').map(e => e.runtimeId)).toEqual(['r1', 'r2', 'r3']);
        expect(ledger.snapshotFor('other.md')).toEqual([]);
        expect(ledger.get('r2')?.parent).toBe('r1');
    });

    it('replaces a file wholesale, forgetting the rows it dropped', () => {
        const ledger = new IdentityLedger();
        ledger.replaceFile('a.md', [entry('r1', 'a.md', null, 0), entry('r2', 'a.md', null, 1)]);
        ledger.replaceFile('a.md', [entry('r2', 'a.md', null, 0), entry('r9', 'a.md', null, 1)]);

        expect(ledger.snapshotFor('a.md').map(e => e.runtimeId)).toEqual(['r2', 'r9']);
        // Mutation: skip the dropFile inside replaceFile and `r1` answers forever.
        expect(ledger.get('r1')).toBeUndefined();
    });

    it('drops a file without touching the others', () => {
        const ledger = new IdentityLedger();
        ledger.replaceFile('a.md', [entry('r1', 'a.md', null, 0)]);
        ledger.replaceFile('b.md', [entry('r2', 'b.md', null, 0)]);

        ledger.dropFile('a.md');

        expect(ledger.snapshotFor('a.md')).toEqual([]);
        expect(ledger.get('r1')).toBeUndefined();
        expect(ledger.snapshotFor('b.md').map(e => e.runtimeId)).toEqual(['r2']);
    });

    it('rekeys a rename in place: order, ordinals and parent links all follow', () => {
        const ledger = new IdentityLedger();
        ledger.replaceFile('old.md', [
            entry('tv-inline:old.md:seq:1', 'old.md', null, 0),
            entry('tv-inline:old.md:seq:2', 'old.md', 'tv-inline:old.md:seq:1', 0),
        ]);

        ledger.rekeyFile('old.md', 'new.md', id => id.replace('old.md', 'new.md'));

        const rows = ledger.snapshotFor('new.md');
        expect(rows.map(e => e.runtimeId)).toEqual(['tv-inline:new.md:seq:1', 'tv-inline:new.md:seq:2']);
        expect(rows.map(e => e.file)).toEqual(['new.md', 'new.md']);
        expect(rows.map(e => e.parent)).toEqual([null, 'tv-inline:new.md:seq:1']);
        expect(rows.map(e => e.ordinal)).toEqual([0, 0]);
        expect(ledger.snapshotFor('old.md')).toEqual([]);
        expect(ledger.get('tv-inline:old.md:seq:1')).toBeUndefined();
    });

    it('rekeying onto an occupied path leaves no stale rows behind', () => {
        const ledger = new IdentityLedger();
        ledger.replaceFile('old.md', [entry('r1', 'old.md', null, 0)]);
        ledger.replaceFile('new.md', [entry('stale', 'new.md', null, 0)]);

        ledger.rekeyFile('old.md', 'new.md', id => id);

        expect(ledger.snapshotFor('new.md').map(e => e.runtimeId)).toEqual(['r1']);
        expect(ledger.get('stale')).toBeUndefined();
    });

    it('rekeying an unknown file is a no-op', () => {
        const ledger = new IdentityLedger();
        ledger.rekeyFile('missing.md', 'new.md', id => id);
        expect(ledger.snapshotFor('new.md')).toEqual([]);
    });

    it('mints session-global numbers that only ever climb', () => {
        const ledger = new IdentityLedger();
        expect(ledger.mint()).toBe(1);
        expect(ledger.mint()).toBe(2);

        ledger.replaceFile('a.md', [entry('r1', 'a.md', null, 0)]);
        ledger.clear();

        expect(ledger.snapshotFor('a.md')).toEqual([]);
        expect(ledger.get('r1')).toBeUndefined();
        // A number handed out before the reset must never name a second task.
        expect(ledger.mint()).toBe(3);
    });
});
