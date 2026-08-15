import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { InlineTaskWriter } from '../../../src/services/persistence/writers/InlineTaskWriter';
import { TaskCloner } from '../../../src/services/persistence/TaskCloner';
import { TaskRepository } from '../../../src/services/persistence/TaskRepository';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { makeTask } from '../helpers/makeTask';
import type { Task } from '../../../src/types';

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

const FILE = 'note.md';

function harness(initial: string) {
    let content = initial;
    const file = new TFile();
    const app = {
        vault: {
            getAbstractFileByPath: () => file,
            process: async (_f: TFile, fn: (data: string) => string) => { content = fn(content); },
            read: async () => content,
        },
    } as any;
    const fileOps = new FileOperations(app);
    return {
        writer: new InlineTaskWriter(app, fileOps),
        cloner: new TaskCloner(app, fileOps),
        repo: new TaskRepository(app),
        lines: () => content.split('\n'),
        text: () => content,
    };
}

const parent = (overrides: Partial<Task> = {}) => makeTask({
    content: 'parent', file: FILE, line: 0, originalText: '- [ ] parent @2026-08-15',
    startDate: '2026-08-15', ...overrides,
});

// ── delete: the extent decides what disappears with the parent ──

describe('deleteTaskFromFile removes the whole subtree', () => {
    it('takes tab-indented descendants', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
            '\t\t- [ ] grandchild',
            '- [ ] sibling',
        ].join('\n'));

        await h.writer.deleteTaskFromFile(parent());

        expect(h.lines()).toEqual(['- [ ] sibling']);
    });

    it('takes space-indented descendants', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '    - [ ] child',
            '        - [ ] grandchild',
            '- [ ] sibling',
        ].join('\n'));

        await h.writer.deleteTaskFromFile(parent());

        expect(h.lines()).toEqual(['- [ ] sibling']);
    });

    it('stops at a blank line, leaving what follows', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
            '',
            '\t- [ ] stranded',
        ].join('\n'));

        await h.writer.deleteTaskFromFile(parent());

        expect(h.lines()).toEqual(['', '\t- [ ] stranded']);
    });

    it('takes a fenced block whole, so no half fence is left behind', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t```md',
            '\t- [ ] looks like a task',
            '\t```',
            '\t- [ ] child',
            '- [ ] sibling',
        ].join('\n'));

        await h.writer.deleteTaskFromFile(parent());

        expect(h.lines()).toEqual(['- [ ] sibling']);
    });

    it('leaves a sibling at the same depth untouched', async () => {
        const h = harness([
            '\t- [ ] parent @2026-08-15',
            '\t\t- [ ] child',
            '\t- [ ] sibling',
        ].join('\n'));

        await h.writer.deleteTaskFromFile(parent({ line: 0, originalText: '\t- [ ] parent @2026-08-15' }));

        expect(h.lines()).toEqual(['\t- [ ] sibling']);
    });
});

// ── insert position: the extent decides where "after the subtree" is ──

describe('insertLineAfterTask lands past the subtree', () => {
    it('goes after the deepest descendant', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
            '\t\t- [ ] grandchild',
            '- [ ] sibling',
        ].join('\n'));

        await h.writer.insertLineAfterTask(parent(), '- [x] record');

        expect(h.lines()[3]).toBe('\t- [x] record');
        expect(h.lines()[4]).toBe('- [ ] sibling');
    });

    it('does not count trailing blank lines as part of the subtree', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
            '',
            '- [ ] sibling',
        ].join('\n'));

        await h.writer.insertLineAfterTask(parent(), '- [x] record');

        expect(h.lines()[2]).toBe('\t- [x] record');
    });

    it('steps over a fenced block rather than into it', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t```md',
            '\t- [ ] looks like a task',
            '\t```',
            '- [ ] sibling',
        ].join('\n'));

        await h.writer.insertLineAfterTask(parent(), '- [x] record');

        expect(h.lines()[4]).toBe('\t- [x] record');
        expect(h.lines()[5]).toBe('- [ ] sibling');
    });
});

// ── sibling insert: the extent is walked repeatedly, once per completed run ──

describe('insertSiblingAfterTask walks whole subtrees', () => {
    const anchor = '- [x] ⏱️ rec @2026-08-15T10:00>10:30';
    const anchorTask = () => makeTask({
        content: '⏱️ rec', file: FILE, line: 0, originalText: anchor,
        statusChar: 'x', startDate: '2026-08-15', startTime: '10:00',
    });

    it('places the new record past the anchor and its children', async () => {
        const h = harness([
            anchor,
            '\t- [ ] note under the record',
            '- [ ] next',
        ].join('\n'));

        await h.writer.insertSiblingAfterTask(anchorTask(), '- [ ] ⏱️ rec @2026-08-15T11:00');

        expect(h.lines()[2]).toBe('- [ ] ⏱️ rec @2026-08-15T11:00');
        expect(h.lines()[3]).toBe('- [ ] next');
    });

    it('skips a completed run, subtrees and all', async () => {
        const second = '- [x] ⏱️ rec @2026-08-15T11:00>11:30';
        const h = harness([
            anchor,
            '\t- [ ] note',
            second,
            '\t- [ ] another note',
            '- [ ] next',
        ].join('\n'));

        await h.writer.insertSiblingAfterTask(
            anchorTask(), '- [ ] ⏱️ rec @2026-08-15T12:00', { afterCompletedRun: true }
        );

        expect(h.lines()[4]).toBe('- [ ] ⏱️ rec @2026-08-15T12:00');
        expect(h.lines()[5]).toBe('- [ ] next');
    });
});

// ── duplicate: the extent decides what gets copied ──

describe('duplicateInlineTask copies the subtree', () => {
    it('copies descendants and strips their block ids', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child ^abc123',
            '\t\t- [ ] grandchild',
        ].join('\n'));

        await h.cloner.duplicateInlineTask(parent());

        expect(h.lines()).toEqual([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
            '\t\t- [ ] grandchild',
            '- [ ] parent @2026-08-15',
            '\t- [ ] child ^abc123',
            '\t\t- [ ] grandchild',
        ]);
    });

    it('copies a fenced block verbatim', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t```md',
            '\t- [ ] sample',
            '\t```',
        ].join('\n'));

        await h.cloner.duplicateInlineTask(parent());

        expect(h.lines().slice(0, 4)).toEqual([
            '- [ ] parent @2026-08-15',
            '\t```md',
            '\t- [ ] sample',
            '\t```',
        ]);
        expect(h.lines()).toHaveLength(8);
    });
});

// ── same-file move: the extent decides what travels ──

describe('appendTaskWithChildren carries the subtree', () => {
    it('re-indents descendants by stripping the old parent prefix', async () => {
        // The prefix removed is the parent's own indentation, so a top-level
        // parent removes nothing and the descendants keep their depth.
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
            '\t\t- [ ] grandchild',
        ].join('\n'));

        await h.writer.appendTaskWithChildren(FILE, '- [x] parent @2026-08-15', parent());

        expect(h.lines().slice(3)).toEqual([
            '- [x] parent @2026-08-15',
            '\t- [ ] child',
            '\t\t- [ ] grandchild',
        ]);
    });

    it('strips the prefix when the parent was itself indented', async () => {
        const h = harness([
            '\t- [ ] parent @2026-08-15',
            '\t\t- [ ] child',
            '\t\t\t- [ ] grandchild',
        ].join('\n'));

        await h.writer.appendTaskWithChildren(
            FILE, '- [x] parent @2026-08-15',
            parent({ line: 0, originalText: '\t- [ ] parent @2026-08-15' })
        );

        expect(h.lines().slice(3)).toEqual([
            '- [x] parent @2026-08-15',
            '\t- [ ] child',
            '\t\t- [ ] grandchild',
        ]);
    });

    it('carries a fenced block without cutting it', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t```md',
            '\t- [ ] sample',
            '\t```',
        ].join('\n'));

        await h.writer.appendTaskWithChildren(FILE, '- [x] parent @2026-08-15', parent());

        expect(h.lines().slice(4)).toEqual([
            '- [x] parent @2026-08-15',
            '\t```md',
            '\t- [ ] sample',
            '\t```',
        ]);
    });
});

// ── recurrence: the extent decides what the next instance inherits ──

describe('insertRecurrenceForTask copies the subtree into the new instance', () => {
    const NEXT = '- [ ] parent @2026-08-16';

    it('copies descendants, resets their checkboxes and drops block ids', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t- [x] done child ^abc123',
            '\t\t- [x] done grandchild',
        ].join('\n'));

        await h.cloner.insertRecurrenceForTask(parent(), NEXT);

        expect(h.lines().slice(0, 3)).toEqual([
            NEXT,
            '\t- [ ] done child',
            '\t\t- [ ] done grandchild',
        ]);
    });

    it('leaves the flow child lines of the fired task behind', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t- ==> every 1d',
            '\t- [ ] real child',
        ].join('\n'));

        await h.cloner.insertRecurrenceForTask(parent(), NEXT);

        // The consumed command must not travel to the new instance.
        expect(h.lines().slice(0, 2)).toEqual([NEXT, '\t- [ ] real child']);
    });

    it('copies nothing when told not to', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
        ].join('\n'));

        await h.cloner.insertRecurrenceForTask(parent(), NEXT, false);

        expect(h.lines()[0]).toBe(NEXT);
        expect(h.lines()[1]).toBe('- [ ] parent @2026-08-15');
    });

    // Characterization of a defect, not of intended behaviour. The checkbox
    // reset reads every copied line as a checkbox, so a `- [x]` written inside
    // a fence — a code sample, not a task — is rewritten as `- [ ]`. The line
    // is being *interpreted*, which is exactly what the fence is supposed to
    // prevent. Pinned here so the fix shows up as a diff.
    it('rewrites checkboxes inside a fence (defect, pinned)', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t```md',
            '\t- [x] sample',
            '\t```',
        ].join('\n'));

        await h.cloner.insertRecurrenceForTask(parent(), NEXT);

        expect(h.lines().slice(0, 4)).toEqual([
            NEXT,
            '\t```md',
            '\t- [ ] sample',   // should stay `- [x]`
            '\t```',
        ]);
    });

    it('lands at the head of the sibling group', async () => {
        const h = harness([
            '- [ ] older @2026-08-13',
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
        ].join('\n'));

        await h.cloner.insertRecurrenceForTask(
            parent({ line: 1 }), NEXT
        );

        expect(h.lines()[0]).toBe(NEXT);
    });
});

// ── conversion and replacement: the extent decides what is read or replaced ──

describe('the extent is also what conversion and replacement act on', () => {
    it('collectChildBodyLines normalises against the shallowest child', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
            '\t\t- [ ] grandchild',
            '\t- tv-color:: ff0000',
        ].join('\n'));

        const body = await h.repo.collectChildBodyLines(parent());

        // Property lines are dropped (they become frontmatter); the rest keeps
        // its relative depth after the common prefix is removed.
        expect(body).toEqual(['- [ ] child', '\t- [ ] grandchild']);
    });

    // Characterization of a defect. The property filter reads every line as a
    // possible `- key:: value`, so a line written inside a fence — a sample,
    // not a declaration — is dropped from the converted body. The content is
    // lost: it is not promoted to frontmatter either, because the fence means
    // the parser never saw it as a property. Same root as the checkbox reset
    // above: a line is interpreted where the fence says it should not be.
    it('drops property-looking lines inside a fence (defect, pinned)', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t```md',
            '\t- key:: not a property here',
            '\t```',
        ].join('\n'));

        const body = await h.repo.collectChildBodyLines(parent());

        expect(body).toEqual(['```md', '```']);   // the middle line should survive
    });

    it('replaceInlineTaskWithWikilink swallows the whole subtree', async () => {
        const h = harness([
            '- [ ] parent @2026-08-15',
            '\t- [ ] child',
            '\t\t- [ ] grandchild',
            '- [ ] sibling',
        ].join('\n'));

        await h.repo.replaceInlineTaskWithWikilink(parent(), 'Tasks/Parent.md');

        expect(h.lines()).toEqual([
            '- [[Tasks/Parent|Parent]]',
            '- [ ] sibling',
        ]);
    });
});

// ── mixed indentation: what the visual-width change is expected to alter ──
//
// These pin today's behaviour so the change is visible as a diff. A tab counts
// as one character but four columns, so a tab-indented line currently reads as
// shallower than a space-indented one at the same visual depth.
describe('mixed indentation (current behaviour, revisited by the width change)', () => {
    it('treats a 4-space child of a tab parent as a descendant', async () => {
        // 1 char vs 4 chars: the space line looks deeper, so it is collected.
        const h = harness([
            '\t- [ ] parent @2026-08-15',
            '    - [ ] same visual depth, spelled with spaces',
            '\t- [ ] sibling',
        ].join('\n'));

        await h.writer.deleteTaskFromFile(parent({ line: 0, originalText: '\t- [ ] parent @2026-08-15' }));

        // The middle line goes with the parent today. Visually it is a sibling.
        expect(h.lines()).toEqual(['\t- [ ] sibling']);
    });

    it('does not treat a tab child of a 4-space parent as a descendant', async () => {
        // The mirror image: 1 char is not greater than 4, so it ends the subtree.
        const h = harness([
            '    - [ ] parent @2026-08-15',
            '\t- [ ] same visual depth, spelled with a tab',
            '    - [ ] sibling',
        ].join('\n'));

        await h.writer.deleteTaskFromFile(parent({ line: 0, originalText: '    - [ ] parent @2026-08-15' }));

        expect(h.lines()).toEqual([
            '\t- [ ] same visual depth, spelled with a tab',
            '    - [ ] sibling',
        ]);
    });
});
