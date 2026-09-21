import { describe, it, expect } from 'vitest';
import { writeBench, FILE } from '../helpers/writeBench';

/**
 * A deletion fire takes the line the user deleted, never the one it just
 * wrote.
 *
 * The two used to be indistinguishable. The fire wrote the next instance and
 * then removed the original, and the second write resolved the original by its
 * text — which the instance repeats exactly whenever the original carries no
 * date and no block id, the command living in a child line. The delete took
 * the instance, the file came back to what it started as, and the task was
 * still there.
 *
 * How the two are told apart here: the subtrees are byte-identical, so the
 * file afterwards cannot say which of them went. The original is given one
 * extra child that the generated copy does not have. If `元の子` survives, the
 * delete took the wrong one.
 */

/** The next instance a `use("週報")` block writes: the same words, no child. */
const GENERATED = {
    kind: 'generated' as const,
    parentLine: '- [ ] 週報',
    flowLines: ['use("週報")'],
    children: [],
};

describe('deletion fire: which line the delete takes', () => {
    it('takes the original when the instance is worded exactly like it', async () => {
        const h = await writeBench([
            '- [ ] 週報',
            '\t- ==> use("週報")',
            '\t- [ ] 元の子',
        ].join('\n'));

        const task = h.taskAt(0);

        const removed = await h.writer.replaceTaskWithInstances(task, [GENERATED]);

        expect(removed).toBe(true);
        expect(h.lines()).toEqual([
            '- [ ] 週報',
            '\t- ==> use("週報")',
        ]);
    });

    it('takes the original when a sibling stands above it', async () => {
        // The instance goes to the head of the sibling group, so the original
        // is no longer where its stored line says — the shift that used to
        // point the delete at the wrong one.
        const h = await writeBench([
            '- [ ] 兄弟',
            '- [ ] 週報',
            '\t- ==> use("週報")',
            '\t- [ ] 元の子',
        ].join('\n'));

        const task = h.taskAt(1);

        const removed = await h.writer.replaceTaskWithInstances(task, [GENERATED]);

        expect(removed).toBe(true);
        expect(h.lines()).toEqual([
            '- [ ] 週報',
            '\t- ==> use("週報")',
            '- [ ] 兄弟',
        ]);
    });

    it('takes the original when it carries a block id', async () => {
        // This shape was already right — a block id that names one line
        // resolves before any text is read. It stays as a case because it is
        // the one thing that used to stand between this bug and every
        // deletion fire.
        const h = await writeBench([
            '- [ ] 週報 ^tv-abc',
            '\t- ==> use("週報")',
            '\t- [ ] 元の子',
        ].join('\n'));

        const task = h.taskAt(0);

        const removed = await h.writer.replaceTaskWithInstances(task, [GENERATED]);

        expect(removed).toBe(true);
        expect(h.lines()).toEqual([
            '- [ ] 週報',
            '\t- ==> use("週報")',
        ]);
    });

    it('writes the recurrence where the two writes used to put it', async () => {
        // A dated recurrence never reads like the line it comes from, so this
        // shape was never wrong. It is here to hold the placement: one write
        // has to leave the file where two of them did.
        const h = await writeBench([
            '- [ ] 兄弟 @2026-09-21',
            '- [ ] 週報 @2026-09-21 ==> every mon',
            '\t- [ ] 元の子',
        ].join('\n'));

        const task = h.taskAt(1);

        const removed = await h.writer.replaceTaskWithInstances(task, [
            { kind: 'recurrence', content: '- [ ] 週報 @2026-09-28 ==> every mon', flowLines: [] },
        ]);

        expect(removed).toBe(true);
        expect(h.lines()).toEqual([
            '- [ ] 週報 @2026-09-28 ==> every mon',
            '- [ ] 兄弟 @2026-09-21',
        ]);
    });

    it('writes nothing at all when the line cannot be resolved', async () => {
        // Neither half happens. An instance written beside an original that
        // could not be removed is what this call exists to make impossible,
        // and the insert has no append-at-the-end of its own to strand one.
        const before = [
            '- [ ] 別のタスク',
            '',
        ].join('\n');
        // The task was read, then taken out of the file by something else.
        const h = await writeBench(['- [ ] 週報', before].join('\n'));
        const task = h.taskAt(0);
        h.edit(before);

        const removed = await h.writer.replaceTaskWithInstances(task, [GENERATED]);

        expect(removed).toBe(false);
        expect(h.lines().join('\n')).toBe(before);
        expect(h.refused).toEqual([{ file: FILE, reason: { kind: 'gone' }, subject: '週報' }]);
    });
});
