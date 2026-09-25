import { describe, it, expect, vi } from 'vitest';
import { Notice } from 'obsidian';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import { makeTask } from '../helpers/makeTask';
import { DEFAULT_STATUS_DEFINITIONS, type Task } from '../../../src/types';

/**
 * Which values updateTask uses to find the line, and what it does when the
 * write reports that it found nothing.
 *
 * The two are related: the index is updated before the write, so a write that
 * cannot find its line leaves the index holding something the file never got.
 */

const proto = TaskIndex.prototype as any;

function buildHost(task: Task, written = true) {
    return {
        store: {
            getTask: () => task,
            bumpRevision: vi.fn(),
            notifyListeners: vi.fn(),
        },
        settings: { scopeKeys: {}, statusDefinitions: DEFAULT_STATUS_DEFINITIONS },
        // A completion fires in its write; the fire itself is not measured here.
        commandExecutor: {
            fireOp: () => ({ op: { kind: "fire", plan: () => [] }, planned: () => null, away: () => null }),
            settleFire: async () => { },
        },
        settleFire: proto.settleFire,
        writeCompleting: proto.writeCompleting,
        scanner: { requestScan: vi.fn(async () => {}) },
        app: { vault: { getAbstractFileByPath: () => null } },
        repository: {
            updateTaskInFile: vi.fn(async () => ({ written, refused: null, made: [], rows: new Map() })),
        },
        draggingFilePath: null,
        // The revert lives on the prototype; the host stands in for `this`.
        revertUnwrittenUpdate: proto.revertUnwrittenUpdate,
        adoptWrittenRow: proto.adoptWrittenRow,
        onRow: proto.onRow,
        writeUpdate: proto.writeUpdate,
        // The dispose guard every write goes through; this index is open.
        disposed: false,
        refuseAfterDispose: proto.refuseAfterDispose,

        copyForWrite: proto.copyForWrite,

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

        const [target, toWrite] = host.repository.updateTaskInFile.mock.calls[0];
        // By its line, with the text as the index read it: the file still
        // says 10:00, so that is what the write has to find there.
        expect(target.line).toBe(task.line);
        expect(target.basis).toEqual({ text: '- [ ] ⏱️ 設計 @2026-08-14T10:00' });
        // The line is rewritten from the updated values.
        expect(toWrite.startTime).toBe('11:00');
        expect(toWrite.endTime).toBe('11:30');
        expect(toWrite.statusChar).toBe('x');
    });

    it('writes from the live task, planned from the snapshot', async () => {
        const task = makeTask({ content: 'x', startTime: '10:00', originalText: '- [ ] x @T10:00' });
        const host = buildHost(task);

        await proto.updateTask.call(host, task.id, { startTime: '11:00', originalText: '- [ ] x @T11:00' });

        const [target, toWrite] = host.repository.updateTaskInFile.mock.calls[0];
        expect(target.basis.text).toBe('- [ ] x @T10:00');
        expect(toWrite).toBe(task);
        expect(task.startTime).toBe('11:00');
    });
});

describe('updateTask: when the write lands nowhere', () => {
    it('puts the touched fields back', async () => {
        const task = makeTask({ content: 'x', startTime: '10:00', statusChar: ' ' });
        const host = buildHost(task, false);

        await proto.updateTask.call(host, task.id, { startTime: '11:00', statusChar: 'x' });

        expect(task.startTime).toBe('10:00');
        expect(task.statusChar).toBe(' ');
    });

    it('drops a field the update introduced', async () => {
        const task = makeTask({ content: 'x' });
        const host = buildHost(task, false);

        await proto.updateTask.call(host, task.id, { endTime: '12:00' });

        expect(task.endTime).toBeUndefined();
    });

    it('leaves fields the update did not touch alone', async () => {
        const task = makeTask({ content: 'x', startTime: '10:00', endTime: '10:30' });
        const host = buildHost(task, false);

        await proto.updateTask.call(host, task.id, { startTime: '11:00' });

        expect(task.endTime).toBe('10:30');
    });

    it('notifies so the UI drops the value it briefly showed', async () => {
        const task = makeTask({ content: 'x', startTime: '10:00' });
        const host = buildHost(task, false);

        await proto.updateTask.call(host, task.id, { startTime: '11:00' });

        // Once for the optimistic update, once for the revert.
        expect(host.store.notifyListeners).toHaveBeenCalledTimes(2);
    });

    it('keeps the update when the write succeeded', async () => {
        const task = makeTask({ content: 'x', startTime: '10:00' });
        const host = buildHost(task, true);

        await proto.updateTask.call(host, task.id, { startTime: '11:00' });

        expect(task.startTime).toBe('11:00');
        expect(host.store.notifyListeners).toHaveBeenCalledTimes(1);
    });
});

/**
 * The answer updateTask gives its caller. The UI ignores it and keeps relying
 * on the revert and on the notice the write layer raises when it refuses (see
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
        expect(host.repository.updateTaskInFile).not.toHaveBeenCalled();
    });
});

describe('reportRefusal', () => {
    it('raises one notice per refusal, naming what the write was about', () => {
        for (const reason of [
            { kind: 'ambiguous', count: 2 },
            { kind: 'gone' },
            { kind: 'changed' },
        ] as const) {
            Notice.messages.length = 0;

            proto.reportRefusal.call({}, { file: 'note.md', reason, subject: '週報' });

            expect(Notice.messages).toHaveLength(1);
            expect(Notice.messages[0]).toContain('週報');
        }
    });
});

/**
 * The copy a card's update wrote is brought up to the lines the write left, so
 * the next write planned from it — a second update, a deletion fire — is not
 * refused against our own write before the scan reads it (stage F5).
 */
describe('updateTask: the copy follows the write', () => {
    const LEFT = ['- [x] x @T11:00', '    - key:: v'];

    function hostLeaving(task: Task, left: readonly string[] | undefined, read: readonly string[] = task.subtreeLines ?? [], at = 0) {
        const host = buildHost(task);
        host.repository.updateTaskInFile = vi.fn(async () => ({
            written: true, refused: null, made: [], rows: new Map(left ? [[task.line, { at: task.line + at, read, left }]] : []),
        })) as never;
        return host;
    }

    const SCANNED = ['- [ ] x @T10:00', '    - key:: v'];

    it('takes the row\'s line number, line and subtree from what the write left', async () => {
        const task = makeTask({ content: 'x', startTime: '10:00', originalText: SCANNED[0], subtreeLines: SCANNED });
        const line = task.line;

        await proto.updateTask.call(hostLeaving(task, LEFT, SCANNED, 2), task.id, { startTime: '11:00', statusChar: 'x' });

        expect(task.originalText).toBe('- [x] x @T11:00');
        expect(task.subtreeLines).toEqual(LEFT);
        expect(task.line).toBe(line + 2);
    });

    it('takes the line but not a subtree the write found other than the copy has it', async () => {
        // A child written in from outside since the scan: the update did not
        // plan from the subtree and did not check it, so the next delete must
        // not come to plan from it either.
        const task = makeTask({ content: 'x', startTime: '10:00', originalText: SCANNED[0], subtreeLines: SCANNED });
        const found = [...SCANNED, '    - [ ] 外から足した子'];

        await proto.updateTask.call(
            hostLeaving(task, ['- [x] x @T11:00', ...found.slice(1)], found), task.id, { startTime: '11:00', statusChar: 'x' });

        expect(task.originalText).toBe('- [x] x @T11:00');
        expect(task.subtreeLines).toBeUndefined();
    });

    it('leaves a copy the store no longer holds alone: a scan has read the write', async () => {
        const task = makeTask({ content: 'x', startTime: '10:00', originalText: '- [ ] x @T10:00' });
        const host = hostLeaving(task, LEFT);
        const replaced = { ...task };
        let calls = 0;
        // The first lookup finds the task; by the time the write is back, the
        // scan has put its own reading in the store.
        host.store.getTask = (() => (calls++ === 0 ? task : replaced)) as never;

        await proto.updateTask.call(host, task.id, { startTime: '11:00' });

        expect(task.originalText).toBe('- [ ] x @T10:00');
    });

    it('leaves the copy as it was when the write did not land', async () => {
        const task = makeTask({ content: 'x', startTime: '10:00', originalText: '- [ ] x @T10:00' });

        await proto.updateTask.call(buildHost(task, false), task.id, { startTime: '11:00' });

        expect(task.originalText).toBe('- [ ] x @T10:00');
        expect(task.subtreeLines).toBeUndefined();
    });
});
