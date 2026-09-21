import { describe, it, expect, vi } from 'vitest';

/**
 * What stands between a key collision and a wrong identity.
 *
 * Every content here gets the same key, which is the worst a hash can do. The
 * key is never trusted alone: wherever it is compared, the rows it vouches for
 * are checked on their text as well, and these tests pin that second check —
 * nothing else can, because a real collision cannot be produced on purpose.
 */
vi.mock('../../../../../src/services/core/identity/ContentKey', () => ({
    contentKeyOf: () => 'collides',
}));

import { WriteClaims, type ClaimBase } from '../../../../../src/services/core/identity/WriteClaims';
import { FileParsePipeline } from '../../../../../src/services/parsing/FileParsePipeline';
import { DEFAULT_SETTINGS } from '../../../../../src/types';
import { resolveHints } from '../../../../../src/services/core/identity/IdentityHints';
import { makeTask } from '../../../helpers/makeTask';

const FILE = 'note.md';

const parseRows = (path: string, lines: readonly string[]) => {
    const parsed = FileParsePipeline.parse(path, [...lines], undefined, DEFAULT_SETTINGS);
    if (parsed.ignored) return null;
    return parsed.tasks.map(task => ({ line: task.line, text: task.originalText, parserId: task.parserId }));
};

function claimsWith(rows: ClaimBase[]): WriteClaims {
    let seq = 0;
    return new WriteClaims(parseRows, () => ({ rows, content: 'collides' }), () => `w${++seq}`);
}

const known = (runtimeId: string, line: number, text: string): ClaimBase =>
    ({ runtimeId, created: false, line, text });

describe('a content key that collides', () => {
    it('does not let a write build on a base whose rows no longer read their text', () => {
        const claims = claimsWith([known('r1', 0, '- [ ] 甲')]);
        const first = claims.claim(FILE, ['- [ ] 甲'], ['- [ ] 乙', '- [ ] 甲'], [{ kind: 'inserted', at: 0, count: 1 }]);
        expect(first.hint!.rows.map(row => row.runtimeId)).toEqual(['w1', 'r1']);

        // A different file under the same key: someone swapped the two lines.
        const next = claims.claim(FILE, ['- [ ] 甲', '- [ ] 乙'], ['- [x] 甲', '- [ ] 乙'], [{ kind: 'replaced', at: 0 }]);

        expect(next.hint).toBeNull();
    });

    it('does not let a write build on a ledger whose rows no longer read their text', () => {
        const claims = claimsWith([known('r1', 0, '- [ ] 甲'), known('r2', 1, '- [ ] 乙')]);

        const claim = claims.claim(FILE, ['- [ ] 乙', '- [ ] 甲'], ['- [x] 乙', '- [ ] 甲'], [{ kind: 'replaced', at: 0 }]);

        expect(claim.hint).toBeNull();
    });
});

describe('a content key that collides, downstream', () => {
    it('does not let a scan adopt a claim whose rows are not the rows it read', () => {
        const read = [makeTask({ id: 'prov:0', line: 0, originalText: '- [ ] 甲', content: '甲' })];
        const pending = [{
            seq: 1, at: 0,
            hint: { content: 'collides', rows: [{ runtimeId: 'w1', created: true, text: '- [ ] 乙' }] },
        }];

        const resolved = resolveHints([], read, { pending, before: null, read: 'collides' });

        expect(resolved.consumed).toBe(0);
        expect(resolved.rows).toBeNull();
    });
});
