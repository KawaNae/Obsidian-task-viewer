import { describe, it, expect, vi } from 'vitest';
import { TaskHubForm } from '../../../src/modals/hub/TaskHubForm';
import { makeTask } from '../helpers/makeTask';
import type { Task } from '../../../src/types';

/**
 * ハブの即時コミット（`queue`）は、ローカルの model を先に書き換えてから
 * updateTask を投げる。続けて投げた書き込みの順は操作の層の行ごとの列が
 * 守る（`onRow`。Names.vault.test.ts）ので、フォームは並べない。書けなかったら、index が戻した写し
 * （`IndexReads.getTask`）で refresh し、楽観更新を捨てる。書けたなら echo を
 * 待つだけで、ここでは refresh しない。
 *
 * フォームの DOM 構築（constructor → render）は node の unit では組めないので、
 * `queue` が読むフィールドだけを持つインスタンスを prototype から作る。
 */

function formAnswering(written: boolean, fresh: Task | undefined) {
    const task = makeTask({ id: 'task-1', content: '元の名前' });
    const updateTask = vi.fn(async () => ({ written }));
    const getTask = vi.fn(() => fresh);
    const refresh = vi.fn();

    const form = Object.create(TaskHubForm.prototype) as TaskHubForm & Record<string, unknown>;
    Object.assign(form, {
        task,
        writing: new Set(),
        deps: { operations: { updateTask }, index: { getTask } },
        refresh,
    });

    const queue = (updates: Partial<Task> | null) =>
        (form as unknown as { queue(u: Partial<Task> | null): void }).queue(updates);
    const drained = () => form.drained();
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

describe('TaskHubForm.drained', () => {
    it('resolves once every write asked is answered, those asked while it waits too', async () => {
        const h = formAnswering(true, makeTask({ id: 'task-1' }));
        const order: string[] = [];
        let release!: () => void;
        h.updateTask.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); order.push('first'); return { written: true }; });
        let releaseSecond!: () => void;
        h.updateTask.mockImplementationOnce(async () => { await new Promise<void>(resolve => { releaseSecond = resolve; }); order.push('second'); return { written: true }; });

        h.queue({ content: 'A' });
        const drained = h.form.drained().then(() => { order.push('drained'); });
        await Promise.resolve();
        h.queue({ content: 'B' });
        // Both are asked at once: the order is the operations' to keep.
        expect(h.updateTask).toHaveBeenCalledTimes(2);
        release();
        await Promise.resolve();
        releaseSecond();
        await drained;

        expect(order).toEqual(['first', 'second', 'drained']);
    });
});
