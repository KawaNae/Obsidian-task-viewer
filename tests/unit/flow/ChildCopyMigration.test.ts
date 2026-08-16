import { describe, it, expect } from 'vitest';
import { childCopyMigrationWarning } from '../../../src/services/flow/ChildCopyMigration';
import { parseFlow } from '../../../src/services/flow/FlowParser';

/**
 * Who hears that child lines have stopped travelling to the next instance.
 *
 * The notice exists for a change nobody can see in the text they wrote, so
 * the interesting cases are the ones where it stays quiet: a command that
 * has already moved to a block, a task whose children are the records this
 * redesign was built to stop copying, and a command that generates nothing.
 */

const warn = (src: string, childLines: string[]) => {
    const { program, diagnostics } = parseFlow(src);
    if (!program) throw new Error(`failed to parse: ${src}`);
    return childCopyMigrationWarning(program, childLines, diagnostics);
};

const CHILD = '\t- [ ] 資料集め';
const RECORD = '\t- [x] ⏱️ 09:00-10:00';

describe('a command that still expects its children to be copied', () => {
    it('is told that they no longer are', () => {
        const d = warn('every mon', [CHILD]);

        expect(d?.code).toBe('flow.child-copy-retired');
        expect(d?.severity).toBe('warning');
    });

    it('is told even when only one child is not a record', () => {
        expect(warn('every mon', [RECORD, CHILD])?.code).toBe('flow.child-copy-retired');
    });

    it('is told about a plain note under the task', () => {
        // Notes were copied too, so their loss is the same loss.
        expect(warn('every mon', ['\t- 参考: 先週の議事録'])?.code).toBe('flow.child-copy-retired');
    });
});

describe('the tasks that hear nothing', () => {
    it('says nothing to a command that names a block', () => {
        expect(warn('every mon use("週報")', [CHILD])).toBeNull();
    });

    it('says nothing when every child is a timer record', () => {
        // This is the task the redesign was built for: records piling up
        // unfinished in each generation is the fault being fixed, so telling
        // its owner to migrate would argue against their own interest.
        expect(warn('every mon', [RECORD, '\t- [x] ⏱️ 13:00-14:30'])).toBeNull();
    });

    it('says nothing to a task with no children', () => {
        expect(warn('every mon', [])).toBeNull();
    });

    it('says nothing when the only children are the command itself', () => {
        expect(warn('every mon', ['\t- ==> x3', '\t- ==> until(2026-12-31)'])).toBeNull();
    });

    it('says nothing when nothing is generated', () => {
        // No schedule, no next instance, nothing to carry over.
        expect(warn('move([[Archive]])', [CHILD])).toBeNull();
    });

    it('says nothing to a command still carrying the retired clause', () => {
        // That line already carries a warning saying the same thing, and two
        // warnings about one change is one too many.
        expect(warn('every mon nochildren', [CHILD])).toBeNull();
    });

    it('ignores blank lines among the children', () => {
        expect(warn('every mon', ['', '   '])).toBeNull();
    });
});
