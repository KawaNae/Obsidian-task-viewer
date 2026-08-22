import { describe, it, expect, vi } from 'vitest';
import { createTvFileCallback } from '../../../src/interaction/menu/builders/createTvFileCallback';
import type { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import type { CreateTaskResult } from '../../../src/modals/CreateTaskModal';

/**
 * Turning a plain checkbox line into a tv-file.
 *
 * Two things are pinned here, and only one of them is arithmetic.
 *
 * The route: the callback hands the work to `TaskWriteService`, which is what
 * puts the write inside `TaskIndex`'s notify wrapper. The other copy of this
 * callback used to call `TaskRepository.createTvFile` directly, and that path
 * left the views waiting on the vault's own create event instead.
 *
 * The arithmetic: a task given an end time but no end date ends on the day it
 * started. Both copies agreed on this, which is how it stayed correct while
 * the routes diverged — and why it is worth stating once, out loud.
 */

function harness() {
    const createTvFileFromData = vi.fn(async () => 'Tasks/new.md');
    const writeService = { createTvFileFromData } as unknown as TaskWriteService;
    return { callback: createTvFileCallback(writeService), createTvFileFromData };
}

const base: CreateTaskResult = { content: '設計レビュー' };

describe('checkbox → tv-file conversion', () => {
    it('goes through the write service', async () => {
        const { callback, createTvFileFromData } = harness();

        const path = await callback({ ...base, startDate: '2026-08-22' }, ' ');

        // Mutation: route the callback back to TaskRepository.createTvFile and
        // the write escapes TaskIndex's notify wrapper — nothing here is called.
        expect(createTvFileFromData).toHaveBeenCalledTimes(1);
        expect(path).toBe('Tasks/new.md');
    });

    it('carries the status char the menu chose', async () => {
        const { callback, createTvFileFromData } = harness();

        await callback(base, 'x');

        expect(createTvFileFromData.mock.calls[0][0]).toMatchObject({
            content: '設計レビュー', statusChar: 'x',
        });
    });

    it('ends a task on the day it started when only an end time is given', async () => {
        const { callback, createTvFileFromData } = harness();

        await callback({
            ...base, startDate: '2026-08-22', startTime: '10:00', endTime: '11:30',
        }, ' ');

        // Mutation: drop the inference and endDate arrives undefined, which
        // reads as an all-day task rather than a 90-minute one.
        expect(createTvFileFromData.mock.calls[0][0]).toMatchObject({
            startDate: '2026-08-22', endDate: '2026-08-22', endTime: '11:30',
        });
    });

    it('leaves an explicit end date alone', async () => {
        const { callback, createTvFileFromData } = harness();

        await callback({
            ...base, startDate: '2026-08-22', startTime: '22:00',
            endDate: '2026-08-23', endTime: '01:00',
        }, ' ');

        // Mutation: infer unconditionally and a task crossing midnight is
        // pulled back onto its start date.
        expect(createTvFileFromData.mock.calls[0][0]).toMatchObject({
            endDate: '2026-08-23', endTime: '01:00',
        });
    });

    it('infers nothing when there is no end time', async () => {
        const { callback, createTvFileFromData } = harness();

        await callback({ ...base, startDate: '2026-08-22' }, ' ');

        expect(createTvFileFromData.mock.calls[0][0].endDate).toBeUndefined();
    });

    it('infers nothing when there is no start date to infer from', async () => {
        const { callback, createTvFileFromData } = harness();

        await callback({ ...base, endTime: '11:30' }, ' ');

        expect(createTvFileFromData.mock.calls[0][0].endDate).toBeUndefined();
    });
});
