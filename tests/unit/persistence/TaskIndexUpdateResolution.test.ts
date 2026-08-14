import { describe, it, expect, vi } from 'vitest';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import { makeTask } from '../helpers/makeTask';
import type { Task } from '../../../src/types';

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
        settings: { tvFileKeys: {} },
        syncDetector: { markLocalEdit: vi.fn() },
        scanner: { requestScan: vi.fn(async () => {}) },
        app: { vault: { getAbstractFileByPath: () => null } },
        repository: {
            updateTaskInFile: vi.fn(async () => written),
            updateTvFile: vi.fn(async () => written),
        },
        draggingFilePath: null,
        // The revert lives on the prototype; the host stands in for `this`.
        revertUnwrittenUpdate: proto.revertUnwrittenUpdate,
    };
}

describe('updateTask: which task resolves the line', () => {
    it('looks the line up with the values the file still holds', async () => {
        const task = makeTask({
            content: '⏱️ 設計', startDate: '2026-08-14', startTime: '10:00', statusChar: ' ',
        });
        const host = buildHost(task);

        await proto.updateTask.call(host, task.id, {
            startTime: '11:00', endTime: '11:30', statusChar: 'x',
        });

        const [lookup, toWrite] = host.repository.updateTaskInFile.mock.calls[0];
        // The file still says 10:00, so that is what the search must ask for.
        expect(lookup.startTime).toBe('10:00');
        expect(lookup.statusChar).toBe(' ');
        // The line is rewritten from the updated values.
        expect(toWrite.startTime).toBe('11:00');
        expect(toWrite.endTime).toBe('11:30');
        expect(toWrite.statusChar).toBe('x');
    });

    it('does not let the snapshot alias the live task', async () => {
        const task = makeTask({ content: 'x', startTime: '10:00' });
        const host = buildHost(task);

        await proto.updateTask.call(host, task.id, { startTime: '11:00' });

        const [lookup] = host.repository.updateTaskInFile.mock.calls[0];
        expect(lookup).not.toBe(task);
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
