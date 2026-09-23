import { describe, it, expect, vi } from 'vitest';
import { TaskHubForm } from '../../../src/modals/hub/TaskHubForm';
import { makeTask } from '../helpers/makeTask';
import type { Task } from '../../../src/types';

/**
 * ハブの即時コミット（`queue`）は、ローカルの model を先に書き換えてから
 * updateTask を投げる。書けなかったら、index が戻した写し
 * （`readService.getTask`）で refresh し、楽観更新を捨てる。書けたなら echo を
 * 待つだけで、ここでは refresh しない。
 *
 * フォームの DOM 構築（constructor → render）は node の unit では組めないので、
 * `queue` が読むフィールドだけを持つインスタンスを prototype から作る。
 */

function formAnswering(written: boolean, fresh: Task | undefined) {
    const task = makeTask({ id: 'task-1', content: '元の名前' });
    const updateTask = vi.fn(async () => written);
    const getTask = vi.fn(() => fresh);
    const refresh = vi.fn();

    const form = Object.create(TaskHubForm.prototype) as TaskHubForm & Record<string, unknown>;
    Object.assign(form, {
        task,
        commitChain: Promise.resolve(),
        deps: { writeService: { updateTask }, readService: { getTask } },
        refresh,
    });

    const queue = (updates: Partial<Task> | null) =>
        (form as unknown as { queue(u: Partial<Task> | null): void }).queue(updates);
    const drained = () => form.commitChain as Promise<void>;
    return { form, queue, drained, updateTask, getTask, refresh };
}

describe('TaskHubForm.queue', () => {
    it('refreshes from the index copy when the write was not made', async () => {
        const fresh = makeTask({ id: 'task-1', content: '元の名前' });
        const h = formAnswering(false, fresh);

        h.queue({ content: '新しい名前' });
        // 楽観更新は投げる前に載る。
        expect((h.form.task as Task).content).toBe('新しい名前');
        await h.drained();

        expect(h.updateTask).toHaveBeenCalledWith('task-1', { content: '新しい名前' });
        expect(h.getTask).toHaveBeenCalledWith('task-1');
        expect(h.refresh).toHaveBeenCalledTimes(1);
        expect(h.refresh).toHaveBeenCalledWith(fresh);
    });

    it('does not refresh when the write was made', async () => {
        const h = formAnswering(true, makeTask({ id: 'task-1' }));

        h.queue({ content: '新しい名前' });
        await h.drained();

        expect(h.updateTask).toHaveBeenCalledTimes(1);
        expect(h.refresh).not.toHaveBeenCalled();
    });

    it('does not refresh from nothing when the task is gone from the index', async () => {
        const h = formAnswering(false, undefined);

        h.queue({ content: '新しい名前' });
        await h.drained();

        expect(h.getTask).toHaveBeenCalledWith('task-1');
        expect(h.refresh).not.toHaveBeenCalled();
    });
});
