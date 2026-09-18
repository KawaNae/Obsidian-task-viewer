import { describe, it, expect } from 'vitest';
import { fingerprintOf } from '../../../../../src/services/core/identity/IdentityFingerprint';
import { makeTask } from '../../../helpers/makeTask';

/**
 * The fingerprint is the matcher's whole vocabulary, so what it does and does not
 * carry is the design decision worth pinning: no line number, a `blockId` only
 * when there really is one, and a date key whose positions stay aligned when a
 * field is empty.
 */
describe('fingerprintOf', () => {
    it('carries the identifying material and nothing positional', () => {
        const task = makeTask({
            line: 42,
            content: '  資料集め  ',
            originalText: '- [ ] 資料集め @2026-09-18 ^abc',
            blockId: 'abc',
            startDate: '2026-09-18',
            startTime: '09:00',
            due: '2026-09-20',
        });

        const fingerprint = fingerprintOf(task);

        expect(fingerprint).toEqual({
            parserId: 'tv-inline',
            blockId: 'abc',
            originalText: '- [ ] 資料集め @2026-09-18 ^abc',
            contentKey: '資料集め',
            dateKey: '2026-09-18|09:00|||2026-09-20',
        });
        expect(JSON.stringify(fingerprint)).not.toContain('42');
    });

    it('leaves blockId absent when there is no usable anchor', () => {
        expect(fingerprintOf(makeTask({ blockId: undefined })).blockId).toBeUndefined();
        expect(fingerprintOf(makeTask({ blockId: '   ' })).blockId).toBeUndefined();
    });

    it('keeps the date key positional, so an empty field cannot pose as another', () => {
        // Mutation: join without the placeholders and `due`-only would read the
        // same as `startDate`-only.
        const dueOnly = fingerprintOf(makeTask({ due: '2026-09-18' }));
        const startOnly = fingerprintOf(makeTask({ startDate: '2026-09-18' }));

        expect(dueOnly.dateKey).toBe('||||2026-09-18');
        expect(startOnly.dateKey).toBe('2026-09-18||||');
        expect(dueOnly.dateKey).not.toBe(startOnly.dateKey);
    });
});
