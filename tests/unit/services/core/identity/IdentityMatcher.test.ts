import { describe, it, expect } from 'vitest';
import { matchFile as matchWithEvidence, matchWithoutRepeatedIds } from '../../../../../src/services/core/identity/IdentityMatcher';
import type { LedgerEntry } from '../../../../../src/services/core/identity/IdentityLedger';
import type { MatchResult } from '../../../../../src/services/core/identity/IdentityMatcher';
import type { Reading } from '../../../../../src/services/core/identity/IdentityHints';
import { makeTask } from '../../../helpers/makeTask';
import type { Task } from '../../../../../src/types';
import { DEFAULT_SETTINGS } from '../../../../../src/types';
import { FileParsePipeline } from '../../../../../src/services/parsing/FileParsePipeline';

/**
 * What survives a save, and what is honestly a new task.
 *
 * Every case here is a two-scan round trip: parse the "before" file with an empty
 * ledger, then feed those rows back with the "after" file. Provisional IDs are
 * spelled `prov:*` so that the assertions can only talk about runtime IDs, which
 * is the thing consumers hold.
 */

/** The matcher with no claims to weigh: the ladder on its own. */
function matchFile(previous: LedgerEntry[], tasks: Task[], mint: (task: Task) => string) {
    return matchWithEvidence(previous, tasks, mint, { states: [], after: true, partner: previous });
}

/** Runtime IDs in the transitional `parserId:file:seq:n` shape of stage 1. */
function makeMint() {
    let seq = 0;
    return (task: Task): string => {
        return `${task.parserId}:${task.file}:seq:${++seq}`;
    };
}

function t(id: string, line: number, content: string, extra: Partial<Task> = {}): Task {
    return makeTask({ id, line, content, originalText: `- [ ] ${content}`, ...extra });
}

function link(parent: Task, ...children: Task[]): void {
    for (const child of children) {
        child.parentId = parent.id;
        parent.childIds.push(child.id);
    }
}

function id(result: MatchResult, provisionalId: string): string {
    const runtimeId = result.mapping.get(provisionalId);
    if (!runtimeId) throw new Error(`no mapping for ${provisionalId}`);
    return runtimeId;
}

/** First scan (empty ledger) then rescan, sharing one mint counter. */
function roundTrip(before: Task[], after: Task[]): { first: MatchResult; second: MatchResult } {
    const mint = makeMint();
    const first = matchFile([], before, mint);
    const second = matchFile(first.entries, after, mint);
    return { first, second };
}

describe('matchFile: the ladder, one rung at a time', () => {
    it('rung 1 — blockId outranks the text it disagrees with', () => {
        const before = [
            t('prov:a', 0, '朝会', { blockId: 'a1', originalText: '- [ ] 朝会' }),
            t('prov:b', 1, '夕会', { blockId: 'b1', originalText: '- [ ] 夕会' }),
        ];
        // The two lines swapped their wording but kept their anchors.
        const after = [
            t('prov:x', 0, '夕会', { blockId: 'a1', originalText: '- [ ] 夕会' }),
            t('prov:y', 1, '朝会', { blockId: 'b1', originalText: '- [ ] 朝会' }),
        ];

        const { first, second } = roundTrip(before, after);

        // Mutation: drop the blockId rung and the text rung pairs them crosswise.
        expect(id(second, 'prov:x')).toBe(id(first, 'prov:a'));
        expect(id(second, 'prov:y')).toBe(id(first, 'prov:b'));
        expect(second.minted).toEqual([]);
        expect(second.retired).toEqual([]);
    });

    it('rung 2 — verbatim text carries IDs across an inserted line', () => {
        const before = [t('prov:a', 0, '牛乳を買う'), t('prov:b', 1, '請求書を出す')];
        const after = [
            t('prov:n', 0, '新しい行'),
            t('prov:a2', 1, '牛乳を買う'),
            t('prov:b2', 2, '請求書を出す'),
        ];

        const { first, second } = roundTrip(before, after);

        // This is the whole point of stage 1: line 0 moved everything down and
        // nothing was renumbered.
        expect(id(second, 'prov:a2')).toBe(id(first, 'prov:a'));
        expect(id(second, 'prov:b2')).toBe(id(first, 'prov:b'));
        expect(second.minted).toEqual([id(second, 'prov:n')]);
    });

    it('rung 3 — content plus dates survives a rewritten line (flow stripped)', () => {
        const before = [
            t('prov:a', 0, '資料集め', {
                originalText: '- [ ] 資料集め @2026-09-18 ==> daily',
                startDate: '2026-09-18',
            }),
            t('prov:b', 1, '議事録', {
                originalText: '- [ ] 議事録 @2026-09-19 ==> daily',
                startDate: '2026-09-19',
            }),
        ];
        // Two pairs at once, so the one-against-one rule below cannot be what saves them.
        const after = [
            t('prov:a2', 0, '資料集め', {
                originalText: '- [ ] 資料集め @2026-09-18  ',
                startDate: '2026-09-18',
            }),
            t('prov:b2', 1, '議事録', {
                originalText: '- [ ] 議事録 @2026-09-19  ',
                startDate: '2026-09-19',
            }),
        ];

        const { first, second } = roundTrip(before, after);

        expect(id(second, 'prov:a2')).toBe(id(first, 'prov:a'));
        expect(id(second, 'prov:b2')).toBe(id(first, 'prov:b'));
        expect(second.minted).toEqual([]);
    });

    it('rung 4 — one against one, same text and a new date', () => {
        const before = [t('prov:a', 0, '買い物', { originalText: '- [ ] 買い物 @2026-09-18', startDate: '2026-09-18' })];
        const after = [t('prov:a2', 0, '買い物', { originalText: '- [ ] 買い物 @2026-09-21', startDate: '2026-09-21' })];

        const { first, second } = roundTrip(before, after);

        expect(id(second, 'prov:a2')).toBe(id(first, 'prov:a'));
    });

    it('rung 4 — one against one, same date and a new wording', () => {
        const before = [t('prov:a', 0, '買い物', { originalText: '- [ ] 買い物 @2026-09-18', startDate: '2026-09-18' })];
        const after = [t('prov:a2', 0, '買い出し', { originalText: '- [ ] 買い出し @2026-09-18', startDate: '2026-09-18' })];

        const { first, second } = roundTrip(before, after);

        expect(id(second, 'prov:a2')).toBe(id(first, 'prov:a'));
    });

    it('rung 5 — text and dates both rewritten is a different task', () => {
        const before = [t('prov:a', 0, '買い物', { originalText: '- [ ] 買い物 @2026-09-18', startDate: '2026-09-18' })];
        const after = [t('prov:a2', 0, '掃除', { originalText: '- [ ] 掃除 @2026-09-21', startDate: '2026-09-21' })];

        const { first, second } = roundTrip(before, after);

        expect(id(second, 'prov:a2')).not.toBe(id(first, 'prov:a'));
        expect(second.minted).toEqual([id(second, 'prov:a2')]);
        expect(second.retired).toEqual([id(first, 'prov:a')]);
    });

    it('never pairs across parsers', () => {
        const before = [t('prov:a', 0, '買い物', { parserId: 'tasks-plugin', isReadOnly: true })];
        // Same line, same everything but the parser that claimed it (a plugin
        // notation was switched off). Renumbering is the accepted cost.
        const after = [t('prov:a2', 0, '買い物', { parserId: 'tv-inline' })];

        const { first, second } = roundTrip(before, after);

        expect(id(second, 'prov:a2')).not.toBe(id(first, 'prov:a'));
        expect(second.retired).toEqual([id(first, 'prov:a')]);
    });
});

describe('matchFile: buckets of identical siblings', () => {
    it('zips an n-against-m bucket by ordinal — the documented limit', () => {
        const before = [t('prov:1', 0, '確認'), t('prov:2', 1, '確認')];
        // A third identical line is inserted at the head. Nothing in the text or
        // the dates says which of the three is new, so the zip pairs the first two
        // by position and the last one is minted. The insertion is "seen" at the
        // tail. This is the limit the design document names, and `^id` is the way out.
        const after = [t('prov:n0', 0, '確認'), t('prov:n1', 1, '確認'), t('prov:n2', 2, '確認')];

        const { first, second } = roundTrip(before, after);

        expect(id(second, 'prov:n0')).toBe(id(first, 'prov:1'));
        expect(id(second, 'prov:n1')).toBe(id(first, 'prov:2'));
        expect(second.minted).toEqual([id(second, 'prov:n2')]);
        expect(second.retired).toEqual([]);
    });

    it('two same-named tasks re-dated in one save are both minted — the documented limit', () => {
        const before = [
            t('prov:1', 0, '買い物', { originalText: '- [ ] 買い物 @2026-09-18', startDate: '2026-09-18' }),
            t('prov:2', 1, '買い物', { originalText: '- [ ] 買い物 @2026-09-19', startDate: '2026-09-19' }),
        ];
        // Neither line matches verbatim, both content+date keys changed, and the
        // leftovers are two against two so the one-against-one rule stays out of it.
        const after = [
            t('prov:3', 0, '買い物', { originalText: '- [ ] 買い物 @2026-09-21', startDate: '2026-09-21' }),
            t('prov:4', 1, '買い物', { originalText: '- [ ] 買い物 @2026-09-22', startDate: '2026-09-22' }),
        ];

        const { first, second } = roundTrip(before, after);

        expect(second.minted).toHaveLength(2);
        expect(second.retired).toEqual([id(first, 'prov:1'), id(first, 'prov:2')]);
    });

    it('reordering distinct siblings changes nothing', () => {
        const before = [t('prov:a', 0, 'A'), t('prov:b', 1, 'B'), t('prov:c', 2, 'C')];
        const after = [t('prov:c2', 0, 'C'), t('prov:a2', 1, 'A'), t('prov:b2', 2, 'B')];

        const { first, second } = roundTrip(before, after);

        expect(id(second, 'prov:a2')).toBe(id(first, 'prov:a'));
        expect(id(second, 'prov:b2')).toBe(id(first, 'prov:b'));
        expect(id(second, 'prov:c2')).toBe(id(first, 'prov:c'));
        expect(second.minted).toEqual([]);
    });

    it('re-dating one of three same-named siblings keeps all three IDs', () => {
        const before = [
            t('prov:1', 0, '買い物', { originalText: '- [ ] 買い物 @2026-09-18', startDate: '2026-09-18' }),
            t('prov:2', 1, '買い物', { originalText: '- [ ] 買い物 @2026-09-19', startDate: '2026-09-19' }),
            t('prov:3', 2, '買い物', { originalText: '- [ ] 買い物 @2026-09-20', startDate: '2026-09-20' }),
        ];
        // Only the middle one moved: the outer two pair verbatim, and the single
        // leftover on each side shares its wording, so rung 4 finishes the job.
        const after = [
            t('prov:4', 0, '買い物', { originalText: '- [ ] 買い物 @2026-09-18', startDate: '2026-09-18' }),
            t('prov:5', 1, '買い物', { originalText: '- [ ] 買い物 @2026-09-21', startDate: '2026-09-21' }),
            t('prov:6', 2, '買い物', { originalText: '- [ ] 買い物 @2026-09-20', startDate: '2026-09-20' }),
        ];

        const { first, second } = roundTrip(before, after);

        expect(id(second, 'prov:4')).toBe(id(first, 'prov:1'));
        expect(id(second, 'prov:5')).toBe(id(first, 'prov:2'));
        expect(id(second, 'prov:6')).toBe(id(first, 'prov:3'));
        expect(second.minted).toEqual([]);
    });
});

describe('matchFile: nearest ordinal in an uneven bucket', () => {
    const open = (id: string, line: number, extra: Partial<Task> = {}) =>
        t(id, line, 'ポモドーロ', { originalText: '- [ ] ポモドーロ', ...extra });
    const done = (id: string, line: number, extra: Partial<Task> = {}) =>
        t(id, line, 'ポモドーロ', { originalText: '- [x] ポモドーロ', statusChar: 'x', ...extra });

    // Checking the third of four leaves "[ ]" four against three. A zip slid the
    // fourth line onto the third's ID and handed the third the fourth's.
    it('checking one of four identical lines keeps all four IDs', () => {
        const before = [open('prov:0', 0), open('prov:1', 1), open('prov:2', 2), open('prov:3', 3)];
        const after = [open('prov:a', 0), open('prov:b', 1), done('prov:c', 2), open('prov:d', 3)];

        const { first, second } = roundTrip(before, after);

        expect(['prov:a', 'prov:b', 'prov:c', 'prov:d'].map(p => id(second, p)))
            .toEqual(['prov:0', 'prov:1', 'prov:2', 'prov:3'].map(p => id(first, p)));
        expect(second.minted).toEqual([]);
    });

    // Two copies of a line, the second already checked; checking the first makes
    // them verbatim equal. "[x]" is one against two: the old checked line must
    // stay on the second, not jump to the first.
    it('two lines becoming identical keep their own IDs', () => {
        const dup = { blockId: 'dup1' };
        const before = [open('prov:0', 0, dup), done('prov:1', 1, dup)];
        const after = [done('prov:a', 0, dup), done('prov:b', 1, dup)];

        const { first, second } = roundTrip(before, after);

        expect(id(second, 'prov:a')).toBe(id(first, 'prov:0'));
        expect(id(second, 'prov:b')).toBe(id(first, 'prov:1'));
    });

    it('breaks a tie toward the smaller previous ordinal, and the place then speaks against it', () => {
        // "[ ]" at 0 and 2 before, one "[ ]" at 1 after: both gaps are 1, and
        // the tie goes to 0. But the row at 1 follows the row 1 was, as 2 did,
        // so its words and its place say 2 while the pair says 0, and 2 is
        // left to the "[x]" at 2 on its content alone. The "[x]" at 2 in turn
        // follows the row 0 was, as 1 did. Twins up to the status: no pair is
        // taken, and every row is new (I1).
        const before = [open('prov:0', 0), done('prov:1', 1), open('prov:2', 2)];
        const after = [done('prov:a', 0), open('prov:b', 1), done('prov:c', 2)];

        const { first, second } = roundTrip(before, after);

        const was = ['prov:0', 'prov:1', 'prov:2'].map(name => id(first, name));
        for (const name of ['prov:a', 'prov:b', 'prov:c']) expect(was).not.toContain(id(second, name));
    });
});

describe('matchFile: scopes', () => {
    it('a new instance at the head of a sibling group does not steal the other parent\'s child', () => {
        const buildBefore = () => {
            const p3 = t('prov:p3', 0, '週報 第3回');
            const c3 = t('prov:c3', 1, '資料集め');
            const p4 = t('prov:p4', 2, '週報 第4回');
            const c4 = t('prov:c4', 3, '資料集め');
            link(p3, c3);
            link(p4, c4);
            return [p3, c3, p4, c4];
        };
        // What `insertRecurrenceForTask` does: the new instance goes to the head of
        // the group, template children and all.
        const buildAfter = () => {
            const p5 = t('prov:p5', 0, '週報 第5回');
            const c5 = t('prov:c5', 1, '資料集め');
            const p3 = t('prov:p3b', 2, '週報 第3回');
            const c3 = t('prov:c3b', 3, '資料集め');
            const p4 = t('prov:p4b', 4, '週報 第4回');
            const c4 = t('prov:c4b', 5, '資料集め');
            link(p5, c5);
            link(p3, c3);
            link(p4, c4);
            return [p5, c5, p3, c3, p4, c4];
        };

        const { first, second } = roundTrip(buildBefore(), buildAfter());

        // Mutation: match the file flat and the three identical "資料集め" lines zip
        // by file position — the hub that was showing the 3rd week's child would
        // quietly start showing the 5th week's.
        expect(id(second, 'prov:c3b')).toBe(id(first, 'prov:c3'));
        expect(id(second, 'prov:c4b')).toBe(id(first, 'prov:c4'));
        expect(id(second, 'prov:c5')).not.toBe(id(first, 'prov:c3'));
        expect(id(second, 'prov:c5')).not.toBe(id(first, 'prov:c4'));
        expect(second.minted).toEqual([id(second, 'prov:p5'), id(second, 'prov:c5')]);
        expect(second.retired).toEqual([]);
    });

    it('a child is rescued by the 2nd pass even when its parent is a new task', () => {
        const buildBefore = () => {
            const parent = t('prov:p', 0, '企画A', {
                originalText: '- [ ] 企画A @2026-09-01',
                startDate: '2026-09-01',
            });
            const child = t('prov:c', 1, '資料集め');
            link(parent, child);
            return [parent, child];
        };
        // Both the wording and the date of the parent changed, so it is a new task
        // by the "when in doubt, mint" default — but the child is untouched.
        const buildAfter = () => {
            const parent = t('prov:p2', 0, '企画B', {
                originalText: '- [ ] 企画B @2026-09-02',
                startDate: '2026-09-02',
            });
            const child = t('prov:c2', 1, '資料集め');
            link(parent, child);
            return [parent, child];
        };

        const { first, second } = roundTrip(buildBefore(), buildAfter());

        // Mutation: make the parent scope a hard partition (drop the 2nd pass) and
        // the child is renumbered along with its parent — "a group of tasks vanished".
        expect(id(second, 'prov:c2')).toBe(id(first, 'prov:c'));
        expect(id(second, 'prov:p2')).not.toBe(id(first, 'prov:p'));
        expect(second.minted).toEqual([id(second, 'prov:p2')]);
        expect(second.retired).toEqual([id(first, 'prov:p')]);
        // The rescued child is re-parented onto the parent's brand new runtime ID.
        const childEntry = second.entries.find(e => e.runtimeId === id(second, 'prov:c2'));
        expect(childEntry?.parent).toBe(id(second, 'prov:p2'));
    });

    it('a parent whose wording alone changed keeps its ID, and its scope with it', () => {
        const buildBefore = () => {
            const parent = t('prov:p', 0, '企画A', {
                originalText: '- [ ] 企画A @2026-09-01',
                startDate: '2026-09-01',
            });
            const child = t('prov:c', 1, '資料集め', { originalText: '- [ ] 資料集め ==> daily' });
            link(parent, child);
            return [parent, child];
        };
        const buildAfter = () => {
            const parent = t('prov:p2', 0, '企画X', {
                originalText: '- [ ] 企画X @2026-09-01',
                startDate: '2026-09-01',
            });
            const child = t('prov:c2', 1, '資料集め', { originalText: '- [ ] 資料集め' });
            link(parent, child);
            return [parent, child];
        };

        const { first, second } = roundTrip(buildBefore(), buildAfter());

        // Rung 4 fires inside the root scope: one leftover on each side, sharing
        // their dates. The child then matches inside the scope that stayed open.
        expect(id(second, 'prov:p2')).toBe(id(first, 'prov:p'));
        expect(id(second, 'prov:c2')).toBe(id(first, 'prov:c'));
        expect(second.minted).toEqual([]);
        expect(second.retired).toEqual([]);
    });
});

describe('matchFile: the rows it hands back', () => {
    it('maps every task and describes the tree in file order', () => {
        const root = t('prov:root', 0, 'root');
        const a = t('prov:a', 1, 'A');
        const a1 = t('prov:a1', 2, 'A1');
        const a2 = t('prov:a2', 3, 'A2');
        const b = t('prov:b', 4, 'B');
        link(root, a, b);
        link(a, a1, a2);
        // Deliberately out of file order: the matcher sorts by line itself.
        const tasks = [b, a2, root, a, a1];

        const result = matchFile([], tasks, makeMint());

        expect(result.mapping.size).toBe(5);
        for (const task of tasks) {
            expect(result.mapping.has(task.id)).toBe(true);
        }
        const runtime = (provisionalId: string) => result.mapping.get(provisionalId)!;
        expect(result.entries.map(e => e.runtimeId)).toEqual([
            runtime('prov:root'),
            runtime('prov:a'),
            runtime('prov:a1'),
            runtime('prov:a2'),
            runtime('prov:b'),
        ]);
        expect(result.entries.map(e => e.parent)).toEqual([
            null,
            runtime('prov:root'),
            result.mapping.get('prov:a'),
            result.mapping.get('prov:a'),
            runtime('prov:root'),
        ]);
        // Ordinals are per scope, not per file.
        expect(result.entries.map(e => e.ordinal)).toEqual([0, 0, 0, 1, 1]);
        expect(result.entries.map(e => e.file)).toEqual(Array(5).fill('note.md'));
        expect(result.entries[1].fingerprint.contentKey).toBe('A');
        // A first scan has nothing to match against, so every row is minted.
        expect(result.minted).toHaveLength(5);
    });

    it('is deterministic: the same input twice gives the same answer', () => {
        const build = () => [t('prov:1', 0, '確認'), t('prov:2', 1, '確認'), t('prov:3', 2, '別件')];
        const previous = matchFile([], build(), makeMint()).entries;

        const left = matchFile(previous, build(), makeMint());
        const right = matchFile(previous, build(), makeMint());

        expect([...left.mapping]).toEqual([...right.mapping]);
        expect(left.entries).toEqual(right.entries);
    });

    it('an empty file retires everything it knew', () => {
        const first = matchFile([], [t('prov:a', 0, 'A')], makeMint());
        const second = matchFile(first.entries, [], makeMint());

        expect(second.entries).toEqual([]);
        expect(second.mapping.size).toBe(0);
        expect(second.retired).toEqual([first.mapping.get('prov:a')]);
    });
});

describe('matchWithoutRepeatedIds', () => {
    // The damage a duplicate does is permanent: the store is keyed by ID, so
    // one row overwrites the other and the file shows a task short of its
    // lines, while the ledger keeps both positions and one entry — which is
    // then what the next scan compares against. So the answer is checked
    // before it is used, and the ladder, which cannot repeat a row, answers
    // instead.
    const answer = (...runtimeIds: string[]): MatchResult => ({
        mapping: new Map(runtimeIds.map((id, i) => [`prov:${i}`, id])),
        entries: runtimeIds.map((runtimeId, i) => ({
            runtimeId, file: 'f.md', parent: null, ordinal: i,
            fingerprint: { parserId: 'tv-inline', originalText: '', contentKey: '', dateKey: '', blockId: null },
        })),
        minted: [],
        retired: [],
        guessed: new Map(),
        disputed: new Set(),
    });
    const claims: Reading = { states: [{ rows: [] }], after: false, partner: [] };

    it('keeps an answer that gives each row its own ID', () => {
        const runs: Array<readonly unknown[]> = [];
        const guarded = matchWithoutRepeatedIds(reading => {
            runs.push(reading.states);
            return answer('r1', 'r2');
        }, claims);

        expect(guarded.withoutClaims).toBe(false);
        expect(runs).toHaveLength(1);
        expect(guarded.result.entries.map(entry => entry.runtimeId)).toEqual(['r1', 'r2']);
    });

    it('matches again with no claims when one ID landed on two rows', () => {
        const seen: number[] = [];
        const guarded = matchWithoutRepeatedIds(reading => {
            seen.push(reading.states.length);
            return reading.states.length > 0 ? answer('r1', 'r1', 'r2') : answer('r1', 'r3', 'r2');
        }, claims);

        expect(seen).toEqual([1, 0]);
        expect(guarded.withoutClaims).toBe(true);
        expect(guarded.result.entries.map(entry => entry.runtimeId)).toEqual(['r1', 'r3', 'r2']);
    });

    it('does not run twice when there were no claims to blame', () => {
        let runs = 0;
        const guarded = matchWithoutRepeatedIds(() => {
            runs++;
            return answer('r1', 'r1');
        }, { states: [], after: true, partner: [] });

        expect(runs).toBe(1);
        expect(guarded.withoutClaims).toBe(false);
    });
});

describe('matchFile: the check of the evidence', () => {
    // Two scopes whose rows were rewritten into each other's words: each pair
    // is contradicted by the other's row. Every pair is weighed against the
    // same run, so which pair the check looks at first does not matter.
    const build = (texts: string[]): Task[] => {
        const [p1, a, p2, b] = texts.map((text, line) => t(`prov:${line}`, line, text));
        link(p1, a);
        link(p2, b);
        return [p1, a, p2, b];
    };

    it('takes the same pairs apart whatever order the rows come in', () => {
        const mint = makeMint();
        const first = matchFile([], build(['P1', 'A', 'P2', 'B']), mint);
        const kept = (result: MatchResult): Array<string | null> =>
            ['prov:0', 'prov:1', 'prov:2', 'prov:3'].map(name => {
                const runtimeId = id(result, name);
                return first.entries.some(entry => entry.runtimeId === runtimeId) ? runtimeId : null;
            });

        const inOrder = matchFile(first.entries, build(['P1', 'A2', 'P2', 'A']), mint);
        const reversed = matchFile([...first.entries].reverse(), build(['P1', 'A2', 'P2', 'A']).reverse(), mint);

        expect(kept(inOrder)).toEqual([id(first, 'prov:0'), null, id(first, 'prov:2'), null]);
        expect(kept(reversed)).toEqual(kept(inOrder));
    });
});

describe('matchFile: a rerun of the ladder after the check (I1-counter3)', () => {
    // The ladder over two parsed files, with no claims: what a scan does after
    // an outside edit. Answers, per line of the second file, the name its row
    // had in the first file (by line), or null for a new name.
    const heldFrom = (before: string[], after: string[]): Array<number | null> => {
        const mint = makeMint();
        const first = matchFile([], FileParsePipeline.parse('note.md', before, DEFAULT_SETTINGS).tasks, mint);
        const lineOf = new Map(first.entries.map(entry => [entry.runtimeId, entry.line]));
        const tasks = FileParsePipeline.parse('note.md', after, DEFAULT_SETTINGS).tasks;
        const second = matchFile(first.entries, tasks, mint);
        return tasks.map(task => lineOf.get(id(second, task.id)) ?? null);
    };

    // SHAPE L1 (counterexample-3, seed 2942). The root B and the grandchild C
    // are deleted. What is left, `\t- [ ] B @d` and `\t- [ ] C`, is worded,
    // indented and dated as before, and `\t- [ ] B @d` is the only row of its
    // words on either side. The first ladder pairs both rows with their own
    // in pass 2, and the check takes the C pair apart (the deleted
    // `\t\t- [ ] C` reads the same). In the rerun, with that C out, the
    // deleted root `- [ ] B` finds `\t- [ ] B @d` its only rung-4 candidate
    // and pass 1 takes it before pass 2 can pair it with its own row; the
    // check takes that pair apart too, and B @d loses its name. Nothing speaks
    // against B @d and its own row, so the name stays (develop and 3c07a7cb
    // kept it).
    it('L1: a row worded, indented and dated as before keeps its name when a rerun offers it to a deleted row', () => {
        const held = heldFrom(
            ['- [ ] B', '\t- [ ] B @2026-09-21', '\t\t- [ ] C', '\t- [ ] C'],
            ['\t- [ ] B @2026-09-21', '\t- [ ] C'],
        );
        expect(held[0]).toBe(1);
        // `\t- [ ] C` may lose its name: the deleted grandchild reads the same
        // but for its indent, which is shape (i). Not asserted (develop and
        // 3c07a7cb kept it on line 3).
    });

    // SHAPE 4138 (counterexample-3). Of the three `D` rows, one goes: the two
    // left are `\t- [ ] D` twins under A, after B. Only the rerun after the
    // check takes the twins' pair apart. The rows with no twin, `- [x] A @d`
    // and `\t- [x] B @d`, are worded, dated and placed as before and keep
    // their names whatever the rerun does to the twins. (81162cc3 already
    // keeps them; it gives both twins new names where develop and 3c07a7cb
    // kept lines 1 and 4, which is shape (i) and not asserted.)
    it('4138: the rows with no twin keep their names when a rerun takes twins apart', () => {
        const held = heldFrom(
            ['- [x] A @2026-09-21', '\t- [ ] D', '\t- [x] B @2026-09-21', '- [ ] D', '\t- [ ] D'],
            ['- [x] A @2026-09-21', '\t- [x] B @2026-09-21', '\t- [ ] D', '\t- [ ] D'],
        );
        expect(held[0]).toBe(0);
        expect(held[1]).toBe(2);
    });
});
