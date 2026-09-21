import { describe, it, expect } from 'vitest';
import { matchFile as matchWithEvidence } from '../../../../../src/services/core/identity/IdentityMatcher';
import type { LedgerEntry } from '../../../../../src/services/core/identity/IdentityLedger';
import { rowsOnlyEvidence } from '../../../helpers/rowsOnlyEvidence';
import type { MatchResult } from '../../../../../src/services/core/identity/IdentityMatcher';
import type { ClaimedRow, Hint, PendingHint } from '../../../../../src/services/core/identity/IdentityHints';
import { makeTask } from '../../../helpers/makeTask';

/** The matcher, weighing claims about a file made only of its rows (see rowsOnlyEvidence). */
function matchFile(
    previous: LedgerEntry[],
    tasks: Task[],
    mint: (task: Task) => string,
    pending?: readonly PendingHint[],
) {
    return matchWithEvidence(previous, tasks, mint,
        pending ? rowsOnlyEvidence(previous, tasks, pending) : undefined);
}
import type { Task } from '../../../../../src/types';

/**
 * Rung 0: what the plugin's own writes tell the matcher, and what the matcher
 * does with it.
 *
 * The case rung 0 exists for is the duplicate. The copy carries the same text
 * as the original, so the ladder sees one row against two identical lines and
 * hands the old ID to whichever comes first. The hub that was open on the
 * original then follows the copy. Nothing in the file can tell the two apart;
 * only the write that made them knows.
 */

function makeMint() {
    let seq = 0;
    return (task: Task): string => `${task.parserId}:${task.file}:seq:${++seq}`;
}

function t(id: string, line: number, text: string, extra: Partial<Task> = {}): Task {
    return makeTask({
        id, line, originalText: text,
        content: text.replace(/^\s*- \[.\] /, ''),
        ...extra,
    });
}

function link(parent: Task, ...children: Task[]): void {
    for (const child of children) {
        child.parentId = parent.id;
        parent.childIds.push(child.id);
    }
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
        ? { runtimeId: `w${++coined}`, created: true, text }
        : { runtimeId, created: false, text }),
});

/** A row a write made, under the name it coined — said out loud, so two
 * claims in one chain can agree on it the way two real writes do. */
const made = (runtimeId: string, text: string): ClaimedRow => ({ runtimeId, created: true, text });

/** A row a write kept. */
const kept = (runtimeId: string, text: string): ClaimedRow => ({ runtimeId, created: false, text });

function pendingOf(...hints: Hint[]): PendingHint[] {
    return hints.map((hint, i) => ({ seq: i + 1, at: 0, hint }));
}

function runtimeId(result: MatchResult, provisionalId: string): string {
    const id = result.mapping.get(provisionalId);
    if (!id) throw new Error(`no mapping for ${provisionalId}`);
    return id;
}

const POMODORO = '- [ ] ポモドーロ';

describe('rung 0: the duplicate', () => {
    it('leaves the original its ID and mints for the copy', () => {
        const mint = makeMint();
        const first = matchFile([], [t('prov:0', 0, POMODORO)], mint);
        const original = runtimeId(first, 'prov:0');

        // The copy went in above; both lines read the same.
        const second = matchFile(
            first.entries,
            [t('prov:0', 0, POMODORO), t('prov:1', 1, POMODORO)],
            mint,
            pendingOf(claim([null, POMODORO], [original, POMODORO])),
        );

        expect(second.consumedHints).toBe(1);
        expect(runtimeId(second, 'prov:1')).toBe(original);
        expect(second.minted).toEqual([runtimeId(second, 'prov:0')]);
    });

    it('without the claim, the old ID slides onto the copy', () => {
        // The behaviour rung 0 is there to correct, pinned so the difference
        // stays visible.
        const mint = makeMint();
        const first = matchFile([], [t('prov:0', 0, POMODORO)], mint);
        const original = runtimeId(first, 'prov:0');

        const second = matchFile(
            first.entries,
            [t('prov:0', 0, POMODORO), t('prov:1', 1, POMODORO)],
            mint,
        );

        expect(runtimeId(second, 'prov:0')).toBe(original);
    });

    it('adopts nothing when the scan read the file before the write', () => {
        const mint = makeMint();
        const first = matchFile([], [t('prov:0', 0, POMODORO)], mint);
        const original = runtimeId(first, 'prov:0');

        const second = matchFile(
            first.entries,
            [t('prov:0', 0, POMODORO)],
            mint,
            pendingOf(claim([null, POMODORO], [original, POMODORO])),
        );

        expect(second.consumedHints).toBe(0);
        expect(runtimeId(second, 'prov:0')).toBe(original);
        expect(second.minted).toEqual([]);
    });
});

describe('rung 0: a line the write named', () => {
    // A created line is named by the write that made it, not by the scan that
    // first reads it — and two scans can read the same created line. The
    // second one must find the row it already has, not a row it has to mint.

    it('finds the row the write made, rather than minting a second one', () => {
        const mint = makeMint();
        const first = matchFile([], [t('prov:0', 0, POMODORO)], mint);
        const original = runtimeId(first, 'prov:0');
        const done = '- [x] ポモドーロ';
        const copy = 'coined:1';

        // W1 put a copy above the original and named it. W2 ticked the
        // original off, building on W1's base, so the copy keeps that name.
        const w1: Hint = { rows: [made(copy, POMODORO), kept(original, POMODORO)] };
        const w2: Hint = { rows: [made(copy, POMODORO), kept(original, done)] };

        // S1's read started before W2 landed, so it reads what W1 left.
        const s1 = matchFile(
            first.entries,
            [t('prov:0', 0, POMODORO), t('prov:1', 1, POMODORO)],
            mint,
            pendingOf(w1, w2),
        );
        expect(s1.consumedHints).toBe(1);
        expect(runtimeId(s1, 'prov:0')).toBe(copy);
        expect(s1.minted).toEqual([copy]);

        // S2 reads what W2 left, with W2's claim still pending. The copy is
        // now a row the ledger holds, so this scan continues it.
        const s2 = matchFile(
            s1.entries,
            [t('prov:0', 0, POMODORO), t('prov:1', 1, done)],
            mint,
            pendingOf(w2),
        );
        expect(s2.consumedHints).toBe(1);
        expect(runtimeId(s2, 'prov:0')).toBe(copy);
        expect(runtimeId(s2, 'prov:1')).toBe(original);
        // Neither gone nor new: the line has not moved since S1 recorded it.
        expect(s2.retired).toEqual([]);
        expect(s2.minted).toEqual([]);
    });

    it('keeps the first copy\'s name when a second duplicate follows it', () => {
        // The shape the duplicate-twice bug took: a scan between the two
        // writes, and a claim describing both copies at once.
        const mint = makeMint();
        const first = matchFile([], [t('prov:0', 0, POMODORO)], mint);
        const original = runtimeId(first, 'prov:0');
        const copy = 'coined:1';
        const copyAgain = 'coined:2';

        const w1: Hint = { rows: [made(copy, POMODORO), kept(original, POMODORO)] };
        const w2: Hint = {
            rows: [made(copyAgain, POMODORO), made(copy, POMODORO), kept(original, POMODORO)],
        };

        const s1 = matchFile(
            first.entries,
            [t('prov:0', 0, POMODORO), t('prov:1', 1, POMODORO)],
            mint,
            pendingOf(w1),
        );
        expect(runtimeId(s1, 'prov:0')).toBe(copy);

        const s2 = matchFile(
            s1.entries,
            [t('prov:0', 0, POMODORO), t('prov:1', 1, POMODORO), t('prov:2', 2, POMODORO)],
            mint,
            pendingOf(w2),
        );
        expect(s2.consumedHints).toBe(1);
        expect(runtimeId(s2, 'prov:0')).toBe(copyAgain);
        expect(runtimeId(s2, 'prov:1')).toBe(copy);
        expect(runtimeId(s2, 'prov:2')).toBe(original);
        expect(s2.minted).toEqual([copyAgain]);
        expect(s2.retired).toEqual([]);
    });
});

describe('rung 0: rewrite and retire', () => {
    it('carries the ID onto the rewritten line', () => {
        const mint = makeMint();
        const before = '- [ ] 報告 @2026-09-21';
        const after = '- [x] 別の名前 @2026-09-28';
        const first = matchFile([], [t('prov:0', 0, before)], mint);
        const held = runtimeId(first, 'prov:0');

        const second = matchFile(
            first.entries,
            [t('prov:0', 0, after)],
            mint,
            pendingOf(claim([held, after])),
        );

        // Text and dates both changed, which is a new task to the ladder — the
        // documented limit of "when in doubt, mint". The write knew better.
        expect(second.consumedHints).toBe(1);
        expect(runtimeId(second, 'prov:0')).toBe(held);
        expect(second.minted).toEqual([]);
    });

    it('retires a row without letting its twin inherit', () => {
        const mint = makeMint();
        const first = matchFile(
            [],
            [t('prov:0', 0, POMODORO), t('prov:1', 1, POMODORO)],
            mint,
        );
        const gone = runtimeId(first, 'prov:0');
        const survivor = runtimeId(first, 'prov:1');

        const second = matchFile(
            first.entries,
            [t('prov:1', 0, POMODORO)],
            mint,
            pendingOf(claim([survivor, POMODORO])),
        );

        expect(second.consumedHints).toBe(1);
        expect(runtimeId(second, 'prov:1')).toBe(survivor);
        expect(second.retired).toEqual([gone]);
    });

    it('follows two rewrites of one row through a text a sibling also holds', () => {
        // The shape a position-based match got wrong: A moves d1 → d2 → d3
        // while B sits at d2 throughout.
        const mint = makeMint();
        const first = matchFile(
            [],
            [t('prov:a', 0, '- [ ] foo @2026-09-21'), t('prov:b', 1, '- [ ] foo @2026-09-22')],
            mint,
        );
        const a = runtimeId(first, 'prov:a');
        const b = runtimeId(first, 'prov:b');

        const second = matchFile(
            first.entries,
            [t('prov:a', 0, '- [ ] foo @2026-09-23'), t('prov:b', 1, '- [ ] foo @2026-09-22')],
            mint,
            pendingOf(
                claim([a, '- [ ] foo @2026-09-22'], [b, '- [ ] foo @2026-09-22']),
                claim([a, '- [ ] foo @2026-09-23'], [b, '- [ ] foo @2026-09-22']),
            ),
        );

        expect(second.consumedHints).toBe(2);
        expect(runtimeId(second, 'prov:a')).toBe(a);
        expect(runtimeId(second, 'prov:b')).toBe(b);
        expect(second.minted).toEqual([]);
    });
});

describe('rung 0: children', () => {
    const CHILD = '\t- [ ] 共通の子';

    it('settles the children of the file it answers for', () => {
        // Two parents whose children are worded identically, and the plugin
        // ticked one of the parents. A claim covers every row of the file, so
        // the children are settled by name rather than left to the ladder,
        // where two identical children can only be told apart by their scope.
        const mint = makeMint();
        const parentA = t('prov:a', 0, '- [ ] 親A');
        const childA = t('prov:a1', 1, CHILD);
        const parentB = t('prov:b', 2, '- [ ] 親B');
        const childB = t('prov:b1', 3, CHILD);
        link(parentA, childA);
        link(parentB, childB);
        const first = matchFile([], [parentA, childA, parentB, childB], mint);
        const heldA = runtimeId(first, 'prov:a');
        const heldB = runtimeId(first, 'prov:b');
        const heldChildA = runtimeId(first, 'prov:a1');
        const heldChildB = runtimeId(first, 'prov:b1');

        const parentA2 = t('prov:a', 0, '- [x] 親A');
        const childA2 = t('prov:a1', 1, CHILD);
        const parentB2 = t('prov:b', 2, '- [ ] 親B');
        const childB2 = t('prov:b1', 3, CHILD);
        link(parentA2, childA2);
        link(parentB2, childB2);

        const second = matchFile(
            first.entries,
            [parentA2, childA2, parentB2, childB2],
            mint,
            pendingOf(claim(
                [heldA, '- [x] 親A'], [heldChildA, CHILD],
                [heldB, '- [ ] 親B'], [heldChildB, CHILD],
            )),
        );

        expect(second.consumedHints).toBe(1);
        expect(runtimeId(second, 'prov:a')).toBe(heldA);
        expect(runtimeId(second, 'prov:a1')).toBe(heldChildA);
        expect(runtimeId(second, 'prov:b1')).toBe(heldChildB);
        expect(second.minted).toEqual([]);
    });

    it('hands the whole file to the ladder when an external edit came with it', () => {
        // The user swapped the two blocks since the last scan while the plugin
        // ticked both parents. The claims describe the file in its old order,
        // so none of them is what was read, and the scoped ladder — not rung 0
        // — is what keeps each child with its own parent.
        const mint = makeMint();
        const parentA = t('prov:a', 0, '- [ ] 親A');
        const childA = t('prov:a1', 1, CHILD);
        const parentB = t('prov:b', 2, '- [ ] 親B');
        const childB = t('prov:b1', 3, CHILD);
        link(parentA, childA);
        link(parentB, childB);
        const first = matchFile([], [parentA, childA, parentB, childB], mint);
        const heldA = runtimeId(first, 'prov:a');
        const heldB = runtimeId(first, 'prov:b');
        const heldChildA = runtimeId(first, 'prov:a1');
        const heldChildB = runtimeId(first, 'prov:b1');

        const parentB2 = t('prov:b', 0, '- [x] 親B');
        const childB2 = t('prov:b1', 1, CHILD);
        const parentA2 = t('prov:a', 2, '- [x] 親A');
        const childA2 = t('prov:a1', 3, CHILD);
        link(parentA2, childA2);
        link(parentB2, childB2);

        const second = matchFile(
            first.entries,
            [parentB2, childB2, parentA2, childA2],
            mint,
            pendingOf(claim(
                [heldA, '- [x] 親A'], [heldChildA, CHILD],
                [heldB, '- [x] 親B'], [heldChildB, CHILD],
            )),
        );

        expect(second.consumedHints).toBe(0);
        expect(runtimeId(second, 'prov:a1')).toBe(heldChildA);
        expect(runtimeId(second, 'prov:b1')).toBe(heldChildB);
    });
});

describe('rung 0: what it does not disturb', () => {
    it('gives exactly the ladder\'s answer when no claim is adopted', () => {
        const before = [t('prov:0', 0, '- [ ] 一つ目'), t('prov:1', 1, '- [ ] 二つ目')];
        const after = () => [t('prov:0', 0, '- [ ] 一つ目'), t('prov:1', 1, '- [x] 二つ目')];

        const firstA = matchFile([], before, makeMint());
        const withoutHints = matchFile(firstA.entries, after(), makeMint());

        const firstB = matchFile([], before, makeMint());
        const withStaleHint = matchFile(
            firstB.entries, after(), makeMint(),
            // A claim about rows this file does not have.
            pendingOf(claim(['nobody', '- [ ] どこかの行'])),
        );

        expect(withStaleHint.consumedHints).toBe(0);
        expect([...withStaleHint.mapping]).toEqual([...withoutHints.mapping]);
        expect(withStaleHint.entries).toEqual(withoutHints.entries);
        expect(withStaleHint.minted).toEqual(withoutHints.minted);
        expect(withStaleHint.retired).toEqual(withoutHints.retired);
    });
});

describe('rung 0: a flow firing', () => {
    // Three writes, of which the middle and the last report. What the last one
    // has to avoid saying is that anything was issued or lost: the file has the
    // same two rows it had a moment earlier, one of them simply reads without
    // its `==>` now.
    const LIVE = '- [ ] ポモドーロ ==> every 1d';
    const FIRED = '- [x] ポモドーロ ==> every 1d';
    const STRIPPED = '- [x] ポモドーロ';

    it('issues one name for the instance and none for the strip', () => {
        const mint = makeMint();
        const ticked = matchFile([], [t('prov:0', 0, FIRED)], mint);
        const original = runtimeId(ticked, 'prov:0');

        // The next instance goes in above the line that fired.
        const afterInstance = matchFile(
            ticked.entries,
            [t('prov:0', 0, LIVE), t('prov:1', 1, FIRED)],
            mint,
            pendingOf(claim([null, LIVE], [original, FIRED])),
        );
        const instance = runtimeId(afterInstance, 'prov:0');
        expect(runtimeId(afterInstance, 'prov:1')).toBe(original);
        expect(afterInstance.minted).toEqual([instance]);
        expect(afterInstance.retired).toEqual([]);

        // The `==>` comes off the fired line. Both rows are the ledger's by
        // now, so the claim carries them as kept — nothing is new here.
        const afterStrip = matchFile(
            afterInstance.entries,
            [t('prov:0', 0, LIVE), t('prov:1', 1, STRIPPED)],
            mint,
            pendingOf({ rows: [kept(instance, LIVE), kept(original, STRIPPED)] }),
        );
        expect(runtimeId(afterStrip, 'prov:0')).toBe(instance);
        expect(runtimeId(afterStrip, 'prov:1')).toBe(original);
        expect(afterStrip.minted).toEqual([]);
        expect(afterStrip.retired).toEqual([]);
    });

    it('carries the instance through the strip when no scan recorded it first', () => {
        // The two writes with no scan in between: the strip's claim is built on
        // what the instance's claim left, so it names the instance under the
        // name that write coined — still created, since no scan has recorded it.
        const mint = makeMint();
        const ticked = matchFile([], [t('prov:0', 0, FIRED)], mint);
        const original = runtimeId(ticked, 'prov:0');

        const afterBoth = matchFile(
            ticked.entries,
            [t('prov:0', 0, LIVE), t('prov:1', 1, STRIPPED)],
            mint,
            pendingOf(
                claim([null, LIVE], [original, FIRED]),
                { rows: [made('w-instance', LIVE), kept(original, STRIPPED)] },
            ),
        );

        expect(afterBoth.consumedHints).toBe(2);
        expect(runtimeId(afterBoth, 'prov:0')).toBe('w-instance');
        expect(runtimeId(afterBoth, 'prov:1')).toBe(original);
        expect(afterBoth.retired).toEqual([]);
    });
});
