import { describe, it, expect } from 'vitest';
import { matchFile } from '../../../../../src/services/core/identity/IdentityMatcher';
import type { MatchResult } from '../../../../../src/services/core/identity/IdentityMatcher';
import type { Hint, PendingHint } from '../../../../../src/services/core/identity/IdentityHints';
import { makeTask } from '../../../helpers/makeTask';
import type { Task } from '../../../../../src/types';

/**
 * Rung 0: what the plugin's own writes tell the matcher, and what the matcher
 * does with it.
 *
 * The case rung 0 exists for is the in-place duplicate. The copy is inserted
 * above the original with the same text, so the ladder sees one row against two
 * identical lines and hands the old ID to whichever comes first — the copy. The
 * hub that was open on the original then follows the copy. Nothing in the file
 * can tell the two apart; only the write that made them knows.
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

function pendingOf(...hints: Hint[]): PendingHint[] {
    return hints.map((hint, i) => ({ seq: i + 1, at: 0, hint }));
}

function runtimeId(result: MatchResult, provisionalId: string): string {
    const id = result.mapping.get(provisionalId);
    if (!id) throw new Error(`no mapping for ${provisionalId}`);
    return id;
}

const POMODORO = '- [ ] ポモドーロ';

describe('rung 0: the in-place duplicate', () => {
    it('leaves the original its ID and mints for the copy', () => {
        const mint = makeMint();
        const first = matchFile([], [t('prov:0', 0, POMODORO)], mint);
        const original = runtimeId(first, 'prov:0');

        // The copy went in above; both lines read the same.
        const second = matchFile(
            first.entries,
            [t('prov:0', 0, POMODORO), t('prov:1', 1, POMODORO)],
            mint,
            pendingOf({ kind: 'insert', text: POMODORO, line: 0 }),
        );

        expect(second.consumedHints).toBe(1);
        expect(runtimeId(second, 'prov:1')).toBe(original);
        expect(second.minted).toEqual([runtimeId(second, 'prov:0')]);
    });

    it('without the hint, the old ID slides onto the copy', () => {
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

    it('believes nothing when the scan read the file before the write', () => {
        const mint = makeMint();
        const first = matchFile([], [t('prov:0', 0, POMODORO)], mint);
        const original = runtimeId(first, 'prov:0');

        // A scan already in flight reads the one-line file. The hint is in the
        // log but the file does not bear it out yet.
        const second = matchFile(
            first.entries,
            [t('prov:0', 0, POMODORO)],
            mint,
            pendingOf({ kind: 'insert', text: POMODORO, line: 0 }),
        );

        expect(second.consumedHints).toBe(0);
        expect(runtimeId(second, 'prov:0')).toBe(original);
        expect(second.minted).toEqual([]);
    });
});

describe('rung 0: rewrite and retire', () => {
    it('carries the ID onto the rewritten line', () => {
        const mint = makeMint();
        const before = t('prov:0', 0, '- [ ] 報告 @2026-09-21');
        const first = matchFile([], [before], mint);
        const held = runtimeId(first, 'prov:0');

        const second = matchFile(
            first.entries,
            [t('prov:0', 0, '- [x] 別の名前 @2026-09-28')],
            mint,
            pendingOf({
                kind: 'rewrite', runtimeId: held,
                before: '- [ ] 報告 @2026-09-21', after: '- [x] 別の名前 @2026-09-28', line: 0,
            }),
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
            pendingOf({ kind: 'retire', runtimeId: gone, text: POMODORO }),
        );

        expect(second.consumedHints).toBe(1);
        expect(runtimeId(second, 'prov:1')).toBe(survivor);
        expect(second.retired).toEqual([gone]);
    });
});

describe('rung 0: the scopes it opens', () => {
    const CHILD = '\t- [ ] 共通の子';

    it('matches the children of a hinted parent within its own scope', () => {
        // Two parents whose children are worded identically, and the user has
        // swapped the two blocks since the last scan — while the plugin ticked
        // the checkbox on one of the parents.
        //
        // A hinted parent has to open its children's scope the way a laddered
        // one does. Without it the children fall to the 2nd pass, where the
        // previous rows come in the old file order and the current tasks in the
        // new one: the two identical children pair across the swap, and each
        // child takes its counterpart's ID.
        const mint = makeMint();
        const parentA = t('prov:a', 0, '- [ ] 親A');
        const childA = t('prov:a1', 1, CHILD);
        const parentB = t('prov:b', 2, '- [ ] 親B');
        const childB = t('prov:b1', 3, CHILD);
        link(parentA, childA);
        link(parentB, childB);
        const first = matchFile([], [parentA, childA, parentB, childB], mint);
        const heldA = runtimeId(first, 'prov:a');
        const heldChildA = runtimeId(first, 'prov:a1');
        const heldChildB = runtimeId(first, 'prov:b1');

        // B's block is now on top, and both parent lines were ticked.
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
            pendingOf(
                {
                    kind: 'rewrite', runtimeId: heldA,
                    before: '- [ ] 親A', after: '- [x] 親A', line: 2,
                },
                {
                    kind: 'rewrite', runtimeId: runtimeId(first, 'prov:b'),
                    before: '- [ ] 親B', after: '- [x] 親B', line: 0,
                },
            ),
        );

        expect(second.consumedHints).toBe(2);
        expect(runtimeId(second, 'prov:a')).toBe(heldA);
        expect(runtimeId(second, 'prov:a1')).toBe(heldChildA);
        expect(runtimeId(second, 'prov:b1')).toBe(heldChildB);
        expect(second.minted).toEqual([]);
    });
});

describe('rung 0: what it does not disturb', () => {
    it('gives the same answer as the ladder when there are no hints', () => {
        const mint = makeMint();
        const first = matchFile([], [t('prov:0', 0, '- [ ] 一つ目'), t('prov:1', 1, '- [ ] 二つ目')], mint);

        const withoutHints = matchFile(
            first.entries,
            [t('prov:0', 0, '- [ ] 一つ目'), t('prov:1', 1, '- [x] 二つ目')],
            mint,
        );
        const withStaleHint = matchFile(
            first.entries,
            [t('prov:0', 0, '- [ ] 一つ目'), t('prov:1', 1, '- [x] 二つ目')],
            makeMint(),
            // A hint about a line that is not in this file at all.
            pendingOf({ kind: 'insert', text: '- [ ] どこにもない', line: 9 }),
        );

        expect(withStaleHint.consumedHints).toBe(0);
        expect([...withStaleHint.mapping.keys()]).toEqual([...withoutHints.mapping.keys()]);
        expect(withStaleHint.minted.length).toBe(withoutHints.minted.length);
    });
});
