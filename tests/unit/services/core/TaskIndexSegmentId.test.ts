import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskIndex } from '../../../../src/services/core/TaskIndex';
import { clearLog, getLogEntries } from '../../../../src/log/log';
import { makeTask } from '../../helpers/makeTask';
import type { Task } from '../../../../src/types';

/**
 * What `updateTask` does when a display-layer segment ID reaches it.
 *
 * Segment IDs (`…##seg:YYYY-MM-DD`) name one half of a task that crosses the
 * visual day boundary. They belong to the display layer: `TaskWriteService`
 * resolves every one of them to the original task before the write layer sees
 * it, which is what makes "synthetic IDs never reach TaskIndex" hold by
 * construction rather than by convention (see that class's doc, and its own
 * tests in TaskWriteServiceChildLine.test.ts).
 *
 * TaskIndex used to answer a segment ID by re-deriving the boundary date and
 * mapping the segment's edit back onto the original's fields — ~75 lines that
 * reimplemented `splitDisplayTaskAtBoundary`. Nothing has been able to reach
 * that code since the write boundary started resolving IDs, so it is gone.
 * What is pinned here is what replaced it: the ID is normalised at the door
 * and the bypass is reported, so a future caller that skips
 * `TaskWriteService` loses no write and does not go unnoticed.
 */

const proto = TaskIndex.prototype as unknown as {
    updateTask(taskId: string, updates: Partial<Task>): Promise<void>;
    revertUnwrittenUpdate(...args: unknown[]): void;
};

function buildHost(task: Task) {
    return {
        store: {
            // The store only knows the real ID — a segment ID looked up
            // verbatim finds nothing, which is the failure this guards.
            getTask: (id: string) => (id === task.id ? task : undefined),
            bumpRevision: vi.fn(),
            notifyListeners: vi.fn(),
        },
        settings: { tvFileKeys: {} },
        syncDetector: { markLocalEdit: vi.fn() },
        scanner: { requestScan: vi.fn(async () => { }) },
        app: { vault: { getAbstractFileByPath: () => null } },
        repository: {
            updateTaskInFile: vi.fn(async () => true),
            updateTvFile: vi.fn(async () => true),
        },
        draggingFilePath: null,
        revertUnwrittenUpdate: proto.revertUnwrittenUpdate,
    };
}

describe('updateTask: a segment ID that skipped the write boundary', () => {
    beforeEach(() => clearLog());

    it('writes to the original task instead of dropping the update', async () => {
        const task = makeTask({ id: 'tv-inline:note.md:ln:5', startTime: '22:00' });
        const host = buildHost(task);

        await proto.updateTask.call(host, `${task.id}##seg:2026-08-22`, { startTime: '23:00' });

        // Mutation: delete `taskId = segmentInfo.baseId` and the store lookup
        // misses, so nothing is written and the update is silently lost.
        expect(host.repository.updateTaskInFile).toHaveBeenCalledTimes(1);
        const [, toWrite] = host.repository.updateTaskInFile.mock.calls[0] as unknown as [Task, Task];
        expect(toWrite.startTime).toBe('23:00');
        expect(task.startTime).toBe('23:00');
    });

    it('says so in the log, so the bypass is findable', async () => {
        const task = makeTask({ id: 'tv-inline:note.md:ln:5' });
        const host = buildHost(task);

        await proto.updateTask.call(host, `${task.id}##seg:2026-08-22`, { statusChar: 'x' });

        // Mutation: drop the logWarn and the bypass writes correctly but
        // invisibly — the invariant erodes with nothing to notice it.
        const warnings = getLogEntries().filter(e => e.level === 'warn');
        expect(warnings).toHaveLength(1);
        expect(warnings[0].message).toContain('##seg:2026-08-22');
    });

    it('leaves a plain ID alone', async () => {
        const task = makeTask({ id: 'tv-inline:note.md:ln:5' });
        const host = buildHost(task);

        await proto.updateTask.call(host, task.id, { statusChar: 'x' });

        expect(host.repository.updateTaskInFile).toHaveBeenCalledTimes(1);
        expect(getLogEntries().filter(e => e.level === 'warn')).toHaveLength(0);
    });
});
