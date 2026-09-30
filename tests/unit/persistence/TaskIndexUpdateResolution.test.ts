import { describe, it, expect, vi } from 'vitest';
import { Notice } from 'obsidian';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import { makeTask } from '../helpers/makeTask';
import { formatRow } from '../../../src/services/parsing/TaskLineFormat';
import { DEFAULT_STATUS_DEFINITIONS, type Task } from '../../../src/types';

/**
 * Which values updateTask uses to find the line, and what it leaves the
 * index's copy: nothing changed, whether the write landed or not. What the
 * write left comes in as the index's next reading (`landed`), and only that
 * is told the views.
 */

const proto = TaskIndex.prototype as any;

function buildHost(task: Task, written = true) {
    task.reading ??= 'k1.1';
    return {
        store: {
            getTask: () => task,
            bumpRevision: vi.fn(),
            notifyListeners: vi.fn(),
        },
        settings: { scopeKeys: {}, statusDefinitions: DEFAULT_STATUS_DEFINITIONS },
        // A completion fires in its write; the fire itself is not measured here.
        commandExecutor: {
            fireOp: () => ({ op: { kind: "fire", plan: () => [] }, planned: () => null, writes: () => false }),
            reportNotRun: () => { },
        },
        writeCompleting: proto.writeCompleting,
        tellNotRun: proto.tellNotRun,
        scanner: { follow: () => null, holds: () => false },
        app: { vault: { getAbstractFileByPath: () => null } },
        repository: {
            write: vi.fn(async () => ({ written, refused: null, fires: [] })),
        },
        onRow: proto.onRow,
        rowNow: proto.rowNow,
        writeUpdate: proto.writeUpdate,
        // The dispose guard every write goes through; this index is open.
        disposed: false,
        refuseAfterDispose: proto.refuseAfterDispose,

        copyToPlan: proto.copyToPlan,
        planCopy: proto.planCopy,
        // A copy the index read, which the disk still holds (`checkCopy`).
        checks: { read: async () => task.originalText, follow: () => task.line, last: () => ({ n: 1, key: undefined }) },
        getTask: proto.getTask,

        reportRefusal: () => { /* the notice is not measured here */ },
    };
}

describe('updateTask: which task resolves the line', () => {
    it('names the row, planned from the line the file still holds', async () => {
        const task = makeTask({
            content: '⏱️ 設計', startDate: '2026-08-14', startTime: '10:00', statusChar: ' ',
            originalText: '- [ ] ⏱️ 設計 @2026-08-14T10:00',
        });
        const host = buildHost(task);

        await proto.updateTask.call(host, task.id, {
            startTime: '11:00', endTime: '11:30', statusChar: 'x',
        });

        const [, target, [op]] = host.repository.write.mock.calls[0];
        // By its line, with the text as the index read it: the file still
        // says 10:00, so that is what the write has to find there.
        expect(target.line).toBe(task.line);
        expect(target.basis).toEqual({ text: '- [ ] ⏱️ 設計 @2026-08-14T10:00' });
        // The line is rewritten from the updated values.
        expect(op).toEqual({ kind: 'update', text: '- [x] ⏱️ 設計 @2026-08-14T11:00>11:30', childOps: [] });
    });

    it('writes the copy with the updates laid over it, planned from the copy', async () => {
        const task = makeTask({ content: 'x', startTime: '10:00', originalText: '- [ ] x @T10:00' });
        const host = buildHost(task);

        await proto.updateTask.call(host, task.id, { startTime: '11:00', originalText: '- [ ] x @T11:00' });

        const [, target, [op]] = host.repository.write.mock.calls[0];
        expect(target.basis.text).toBe('- [ ] x @T10:00');
        expect(op.text).toBe(formatRow({ ...task, startTime: '11:00' }));
        expect(task.startTime).toBe('10:00');
    });
});

describe('updateTask: the index\'s copy', () => {
    for (const written of [true, false]) {
        it(`is left as it was, and nothing told, when the write ${written ? 'landed' : 'landed nowhere'}`, async () => {
            const task = makeTask({ content: 'x', startTime: '10:00', statusChar: ' ' });
            const host = buildHost(task, written);
            const before = { ...task };

            await proto.updateTask.call(host, task.id, { startTime: '11:00', statusChar: 'x', endTime: '12:00' });

            expect(task).toEqual(before);
            expect(host.store.bumpRevision).not.toHaveBeenCalled();
            expect(host.store.notifyListeners).not.toHaveBeenCalled();
        });
    }
});

/**
 * The answer updateTask gives its caller. The UI mostly ignores it and relies
 * on the notice the write layer raises when it refuses (see
 * `reportRefusal` below); the API turns a `false` into an error,
 * because a CLI that prints the new values after a write that never happened
 * is the only consumer that cannot see the notice.
 */
describe('updateTask: the answer', () => {
    it('answers no and raises no notice of its own when the write landed nowhere', async () => {
        // The write that gave up has already told the user why, through the
        // channel's `refused` (reportRefusal). A second notice here would
        // say the same thing twice.
        const task = makeTask({ content: 'x', startTime: '10:00' });
        const host = buildHost(task, false);
        Notice.messages.length = 0;

        const written = await proto.updateTask.call(host, task.id, { startTime: '11:00' });

        expect(written).toBe(false);
        expect(Notice.messages).toHaveLength(0);
    });

    it('answers yes and stays quiet when the write landed', async () => {
        const task = makeTask({ content: 'x', startTime: '10:00' });
        const host = buildHost(task, true);
        Notice.messages.length = 0;

        const written = await proto.updateTask.call(host, task.id, { startTime: '11:00' });

        expect(written).toBe(true);
        expect(Notice.messages).toHaveLength(0);
    });

    it('answers no for a read-only task, without touching the repository', async () => {
        const task = makeTask({ content: 'x', isReadOnly: true });
        const host = buildHost(task, true);

        const written = await proto.updateTask.call(host, task.id, { startTime: '11:00' });

        expect(written).toBe(false);
        expect(host.repository.write).not.toHaveBeenCalled();
    });
});

describe('reportRefusal', () => {
    it('raises one notice per refusal, naming what the write was about', () => {
        for (const reason of [
            { kind: 'gone' },
            { kind: 'changed' },
            { kind: 'unreadable' },
        ] as const) {
            Notice.messages.length = 0;

            // What it learns besides (`learnFrom`) asks an index with no reconciler nothing.
            proto.reportRefusal.call({ learnFrom: proto.learnFrom }, { file: 'note.md', reason, subject: '週報' });

            expect(Notice.messages).toHaveLength(1);
            expect(Notice.messages[0]).toContain('週報');
        }
    });
});
