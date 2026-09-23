import { describe, it, expect } from 'vitest';
import { targetOf } from '../../../src/services/persistence/TaskRefs';
import type { Task } from '../../../src/types';
import { writeBench, FILE, type WriteBench } from '../helpers/writeBench';

/**
 * How far a task's subtree reaches, as seen by the writes that move it.
 *
 * `collectChildrenFromLines` is a *range* function: every caller uses the
 * result as a splice extent or an indent baseline, never as a list of task
 * lines. These tests pin the extent through the operations that depend on it,
 * so that a change to how depth is compared (visual width vs character count)
 * shows up as a diff here rather than as a silently truncated delete.
 *
 * Written before that change lands. What must not move:
 *   - a blank line ends the subtree
 *   - fenced content travels with the subtree, verbatim
 *   - the extent covers descendants, not just direct children
 *
 * What the width change is expected to affect is called out per test.
 */

// ── delete: the extent decides what disappears with the parent ──

describe('deleteTaskFromFile removes the whole subtree', () => {
    it('takes tab-indented descendants', async () => {
        const h = await writeBench([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
            '\t\t- [ ] grandchild',
            '- [ ] sibling',
        ].join('\n'));

        await h.writer.deleteTaskFromFile(h.taskAt(0));

        expect(h.lines()).toEqual(['- [ ] sibling']);
    });

    it('takes space-indented descendants', async () => {
        const h = await writeBench([
            '- [ ] parent @2026-08-15',
            '    - [ ] child',
            '        - [ ] grandchild',
            '- [ ] sibling',
        ].join('\n'));

        await h.writer.deleteTaskFromFile(h.taskAt(0));

        expect(h.lines()).toEqual(['- [ ] sibling']);
    });

    it('takes a child below a blank line too, leaving no orphan', async () => {
        const h = await writeBench([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
            '',
            '\t- [ ] once stranded',
            '',
            '- [ ] next',
        ].join('\n'));

        await h.writer.deleteTaskFromFile(h.taskAt(0));

        // The blank line after the subtree is not the parent's: it stays.
        expect(h.lines()).toEqual(['', '- [ ] next']);
    });

    it('takes a fenced block whole, so no half fence is left behind', async () => {
        const h = await writeBench([
            '- [ ] parent @2026-08-15',
            '\t```md',
            '\t- [ ] looks like a task',
            '\t```',
            '\t- [ ] child',
            '- [ ] sibling',
        ].join('\n'));

        await h.writer.deleteTaskFromFile(h.taskAt(0));

        expect(h.lines()).toEqual(['- [ ] sibling']);
    });

    it('leaves a sibling at the same depth untouched', async () => {
        const h = await writeBench([
            '\t- [ ] parent @2026-08-15',
            '\t\t- [ ] child',
            '\t- [ ] sibling',
        ].join('\n'));

        await h.writer.deleteTaskFromFile(h.taskAt(0));

        expect(h.lines()).toEqual(['\t- [ ] sibling']);
    });
});

// ── insert position: the extent decides where "after the subtree" is ──

describe('insertLineAfterTask lands past the subtree', () => {
    it('goes after the deepest descendant', async () => {
        const h = await writeBench([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
            '\t\t- [ ] grandchild',
            '- [ ] sibling',
        ].join('\n'));

        await h.writer.insertLineAfterTask(h.taskAt(0), '- [x] record');

        expect(h.lines()[3]).toBe('\t- [x] record');
        expect(h.lines()[4]).toBe('- [ ] sibling');
    });

    it('does not count trailing blank lines as part of the subtree', async () => {
        const h = await writeBench([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
            '',
            '- [ ] sibling',
        ].join('\n'));

        await h.writer.insertLineAfterTask(h.taskAt(0), '- [x] record');

        expect(h.lines()[2]).toBe('\t- [x] record');
    });

    it('steps over a fenced block rather than into it', async () => {
        const h = await writeBench([
            '- [ ] parent @2026-08-15',
            '\t```md',
            '\t- [ ] looks like a task',
            '\t```',
            '- [ ] sibling',
        ].join('\n'));

        await h.writer.insertLineAfterTask(h.taskAt(0), '- [x] record');

        expect(h.lines()[4]).toBe('\t- [x] record');
        expect(h.lines()[5]).toBe('- [ ] sibling');
    });
});

// ── sibling insert: the extent is walked repeatedly, once per completed run ──

describe('insertSiblingAfterTask walks whole subtrees', () => {
    const anchor = '- [x] ⏱️ rec @2026-08-15T10:00>10:30';
    it('places the new record past the anchor and its children', async () => {
        const h = await writeBench([
            anchor,
            '\t- [ ] note under the record',
            '- [ ] next',
        ].join('\n'));

        await h.writer.insertSiblingAfterTask(h.taskAt(0), '- [ ] ⏱️ rec @2026-08-15T11:00');

        expect(h.lines()[2]).toBe('- [ ] ⏱️ rec @2026-08-15T11:00');
        expect(h.lines()[3]).toBe('- [ ] next');
    });

    it('skips a completed run, subtrees and all', async () => {
        const second = '- [x] ⏱️ rec @2026-08-15T11:00>11:30';
        const h = await writeBench([
            anchor,
            '\t- [ ] note',
            second,
            '\t- [ ] another note',
            '- [ ] next',
        ].join('\n'));

        await h.writer.insertSiblingAfterTask(
            h.taskAt(0), '- [ ] ⏱️ rec @2026-08-15T12:00', { afterCompletedRun: true }
        );

        expect(h.lines()[4]).toBe('- [ ] ⏱️ rec @2026-08-15T12:00');
        expect(h.lines()[5]).toBe('- [ ] next');
    });
});

// ── duplicate: the extent decides what gets copied ──

describe('duplicateInlineTaskInPlace copies the subtree', () => {
    // The entry production uses for a duplicate with no day offset. An
    // all-day task holds no time to move past, so its copy is the line again.
    const verbatimOnce = { kind: 'verbatim', count: 1 } as const;

    it('copies descendants and strips their block ids', async () => {
        const h = await writeBench([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child ^abc123',
            '\t\t- [ ] grandchild',
        ].join('\n'));

        await h.cloner.duplicateInlineTaskInPlace(h.taskAt(0), verbatimOnce);

        expect(h.lines()).toEqual([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child ^abc123',
            '\t\t- [ ] grandchild',
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
            '\t\t- [ ] grandchild',
        ]);
    });

    it('copies a fenced block verbatim', async () => {
        const h = await writeBench([
            '- [ ] parent @2026-08-15',
            '\t```md',
            '\t- [ ] sample',
            '\t```',
        ].join('\n'));

        await h.cloner.duplicateInlineTaskInPlace(h.taskAt(0), verbatimOnce);

        expect(h.lines().slice(0, 4)).toEqual([
            '- [ ] parent @2026-08-15',
            '\t```md',
            '\t- [ ] sample',
            '\t```',
        ]);
        expect(h.lines()).toHaveLength(8);
    });
});

// ── duplicate with a day offset: the calendar axis, unchanged ──

describe('duplicateInlineTask shifts along the calendar', () => {
    const subtree = [
        '- [ ] parent @2026-08-15 ^abc123',
        '\t- [ ] child',
        '- [ ] other @2026-08-15',
    ].join('\n');

    it('puts the copy before the task and drops its block id', async () => {
        const h = await writeBench(subtree);

        await h.cloner.duplicateInlineTask(h.taskAt(0), { dayOffset: 1 });

        expect(h.lines()).toEqual([
            '- [ ] parent @2026-08-16',
            '\t- [ ] child',
            '- [ ] parent @2026-08-15 ^abc123',
            '\t- [ ] child',
            '- [ ] other @2026-08-15',
        ]);
    });

    it('writes count copies, latest first', async () => {
        const h = await writeBench(subtree);

        await h.cloner.duplicateInlineTask(h.taskAt(0), { dayOffset: 1, count: 3 });

        // Future-first, so scrolling down walks back towards the original.
        expect(h.lines().filter(l => l.startsWith('- [ ] parent'))).toEqual([
            '- [ ] parent @2026-08-18',
            '- [ ] parent @2026-08-17',
            '- [ ] parent @2026-08-16',
            '- [ ] parent @2026-08-15 ^abc123',
        ]);
    });

    it('gives every copy its own children', async () => {
        const h = await writeBench(subtree);

        await h.cloner.duplicateInlineTask(h.taskAt(0), { dayOffset: 2, count: 2 });

        expect(h.lines()).toEqual([
            '- [ ] parent @2026-08-18',
            '\t- [ ] child',
            '- [ ] parent @2026-08-17',
            '\t- [ ] child',
            '- [ ] parent @2026-08-15 ^abc123',
            '\t- [ ] child',
            '- [ ] other @2026-08-15',
        ]);
    });

    it('leaves the children on their own dates', async () => {
        const h = await writeBench([
            '- [ ] parent @2026-08-15T10:00>11:00',
            '\t- [ ] child @2026-08-15T13:00>13:30',
        ].join('\n'));

        await h.cloner.duplicateInlineTask(h.taskAt(0), { dayOffset: 1 });

        // A child's dates are its own, not an offset from its parent's.
        expect(h.lines()[1]).toBe('\t- [ ] child @2026-08-15T13:00>13:30');
    });
});

// ── same-file move: the extent decides what travels ──

/** A move within the file, as the executor writes it: one op, the row carried to the end. */
function moveToEnd(h: Awaited<ReturnType<typeof writeBench>>, text: string) {
    return h.writer.applyToTask(targetOf(h.taskAt(0)), [{ kind: 'move-to-end', text }]);
}

describe('a move within the file carries the subtree', () => {
    it('re-indents descendants by stripping the old parent prefix', async () => {
        // The prefix removed is the parent's own indentation, so a top-level
        // parent removes nothing and the descendants keep their depth.
        const h = await writeBench([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
            '\t\t- [ ] grandchild',
        ].join('\n'));

        await moveToEnd(h, '- [x] parent @2026-08-15');

        expect(h.lines()).toEqual([
            '- [x] parent @2026-08-15',
            '\t- [ ] child',
            '\t\t- [ ] grandchild',
        ]);
    });

    it('strips the prefix when the parent was itself indented', async () => {
        const h = await writeBench([
            '\t- [ ] parent @2026-08-15',
            '\t\t- [ ] child',
            '\t\t\t- [ ] grandchild',
        ].join('\n'));

        await moveToEnd(h, '- [x] parent @2026-08-15');

        expect(h.lines()).toEqual([
            '- [x] parent @2026-08-15',
            '\t- [ ] child',
            '\t\t- [ ] grandchild',
        ]);
    });

    it('carries a fenced block without cutting it', async () => {
        const h = await writeBench([
            '- [ ] parent @2026-08-15',
            '\t```md',
            '\t- [ ] sample',
            '\t```',
        ].join('\n'));

        await moveToEnd(h, '- [x] parent @2026-08-15');

        expect(h.lines()).toEqual([
            '- [x] parent @2026-08-15',
            '\t```md',
            '\t- [ ] sample',
            '\t```',
        ]);
    });
});

// ── recurrence: the extent decides what the next instance inherits ──

describe('a recurrence insert leaves the subtree with the instance that fired', () => {
    const NEXT = '- [ ] parent @2026-08-16';
    /** `applyToTask` with the one op a recurrence's next-instance insert makes. */
    const insertRecurrence = (h: WriteBench, task: Task, content: string, flowLines: string[] = []) =>
        h.writer.applyToTask(targetOf(task), [
            { kind: 'insert-instance', insert: { kind: 'recurrence', content, flowLines } },
        ]);

    it('writes the new instance and nothing under it', async () => {
        // What sits under a task is what that instance did. A block is where
        // the next instance's children are described, and a command without
        // one describes no children at all.
        const h = await writeBench([
            '- [ ] parent @2026-08-15',
            '\t- [x] done child ^abc123',
            '\t\t- [x] done grandchild',
        ].join('\n'));

        await insertRecurrence(h, h.taskAt(0), NEXT);

        expect(h.lines()).toEqual([
            NEXT,
            '- [ ] parent @2026-08-15',
            '\t- [x] done child ^abc123',
            '\t\t- [x] done grandchild',
        ]);
    });

    it('takes the flow line indent from the existing children', async () => {
        // The subtree is still read, for this and nothing else: a new
        // instance has no children of its own to copy a spelling from.
        const h = await writeBench([
            '- [ ] parent @2026-08-15',
            '    - [ ] real child',
        ].join('\n'));

        await insertRecurrence(h, h.taskAt(0), NEXT, ['every 1d']);

        expect(h.lines().slice(0, 2)).toEqual([NEXT, '    - ==> every 1d']);
    });

    it('falls back to the consumed command line for that spelling', async () => {
        // Only flow lines below: their indent is the one thing the file has
        // to say about how this task writes a level.
        const h = await writeBench([
            '- [ ] parent @2026-08-15',
            '    - ==> every 1d',
        ].join('\n'));

        await insertRecurrence(h, h.taskAt(0), NEXT, ['every 1d']);

        expect(h.lines().slice(0, 2)).toEqual([NEXT, '    - ==> every 1d']);
    });

    it('lands at the head of the sibling group', async () => {
        const h = await writeBench([
            '- [ ] older @2026-08-13',
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
        ].join('\n'));

        await insertRecurrence(h, h.taskAt(1), NEXT);

        expect(h.lines()[0]).toBe(NEXT);
    });
});

// ── conversion and replacement: the extent decides what is read or replaced ──

describe('mixed indentation is read by the width it shows at', () => {
    it('does not treat a 4-space line under a tab parent as a descendant', async () => {
        // A tab and four spaces are one depth: the space line is a sibling.
        const h = await writeBench([
            '\t- [ ] parent @2026-08-15',
            '    - [ ] same visual depth, spelled with spaces',
            '\t- [ ] sibling',
        ].join('\n'));

        await h.writer.deleteTaskFromFile(h.taskAt(0));

        expect(h.lines()).toEqual([
            '    - [ ] same visual depth, spelled with spaces',
            '\t- [ ] sibling',
        ]);
    });

    it('does not treat a tab child of a 4-space parent as a descendant', async () => {
        // The mirror image, which counting characters already read this way.
        const h = await writeBench([
            '    - [ ] parent @2026-08-15',
            '\t- [ ] same visual depth, spelled with a tab',
            '    - [ ] sibling',
        ].join('\n'));

        await h.writer.deleteTaskFromFile(h.taskAt(0));

        expect(h.lines()).toEqual([
            '\t- [ ] same visual depth, spelled with a tab',
            '    - [ ] sibling',
        ]);
    });
});
