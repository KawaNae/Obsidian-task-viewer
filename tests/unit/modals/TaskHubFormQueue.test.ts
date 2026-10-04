import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { TaskHubForm } from '../../../src/modals/hub/TaskHubForm';
import { refusalNotice, type IndexRefusal } from '../../../src/services/core/RefusalClause';
import type { WriteAnswer } from '../../../src/services/operations/WriteAnswer';
import type { FormIssue } from '../../../src/modals/form/FormIssue';
import { makeTask } from '../helpers/makeTask';
import type { Task } from '../../../src/types';

/**
 * ハブの即時コミット（`queue`）は、ローカルの model を先に書き換えてから
 * updateTask を投げる。続けて投げた書き込みの順は操作の層の行ごとの列が
 * 守る（`onRow`。Names.vault.test.ts）ので、フォームは並べない。書き込みは通知を
 * 出さない書き方で頼み（`tellRefusal: false`）、書けなかったら理由をフォームの
 * 末尾に1回出し、index が戻した写し（`IndexReads.getTask`）で refresh して楽観
 * 更新を捨てる（拒まれた欄の字は bindField が残す）。書けたなら echo を待つだけで、
 * ここでは refresh せず、前の拒否の文を取り下げる。閉じた後の拒否は通知になる。
 *
 * フォームの DOM 構築（constructor → render）は node の unit では組めないので、
 * `queue` が読むフィールドだけを持つインスタンスを prototype から作る。
 */

const REFUSED: IndexRefusal = { file: 'note.md', reason: { kind: 'changed' }, subject: '元の名前' };

function formAnswering(written: boolean, fresh: Task | undefined, refused: IndexRefusal | null = REFUSED) {
    const task = makeTask({ id: 'task-1', content: '元の名前' });
    const updateTask = vi.fn(async (): Promise<WriteAnswer> => (written ? { written: true } : { written: false, refused }));
    const getTask = vi.fn(() => fresh);
    const refresh = vi.fn();
    const said = new Map<string, readonly FormIssue<string>[]>();

    const form = Object.create(TaskHubForm.prototype) as TaskHubForm & Record<string, unknown>;
    Object.assign(form, {
        task,
        writing: new Set(),
        closed: false,
        deps: { operations: { updateTask }, index: { getTask } },
        issues: { set: (source: string, issues: readonly FormIssue<string>[]) => { said.set(source, issues); } },
        refresh,
    });

    const queue = (updates: Partial<Task> | null) =>
        (form as unknown as { queue(u: Partial<Task> | null): Promise<boolean> }).queue(updates);
    const drained = () => form.drained();
    return { form, queue, drained, updateTask, getTask, refresh, said };
}

beforeEach(() => { Notice.messages.length = 0; });

describe('TaskHubForm.queue', () => {
    it('refreshes from the index copy when the write was not made', async () => {
        const fresh = makeTask({ id: 'task-1', content: '元の名前' });
        const h = formAnswering(false, fresh);

        h.queue({ content: '新しい名前' });
        // 楽観更新は投げる前に載る。
        expect((h.form.task as Task).content).toBe('新しい名前');
        await h.drained();

        expect(h.updateTask).toHaveBeenCalledWith('task-1', { content: '新しい名前' }, { tellRefusal: false });
        expect(h.getTask).toHaveBeenCalledWith('task-1');
        expect(h.refresh).toHaveBeenCalledTimes(1);
        expect(h.refresh).toHaveBeenCalledWith(fresh);
    });

    it('says why the write was refused at the form\'s end, once, with no notice, and answers no', async () => {
        const h = formAnswering(false, makeTask({ id: 'task-1' }));

        expect(await h.queue({ content: '新しい名前' })).toBe(false);

        expect(h.said.get('write')).toEqual([{ at: 'form', tone: 'error', text: refusalNotice(REFUSED) }]);
        expect(Notice.messages).toEqual([]);
    });

    it('takes back what it said of a refusal once a write is made', async () => {
        const h = formAnswering(false, makeTask({ id: 'task-1' }));
        await h.queue({ content: '新しい名前' });
        h.updateTask.mockResolvedValueOnce({ written: true });

        expect(await h.queue({ content: '新しい名前' })).toBe(true);

        expect(h.said.get('write')).toEqual([]);
    });

    it('tells a refusal that comes once the hub has closed by a notice, and touches no field', async () => {
        const h = formAnswering(false, makeTask({ id: 'task-1' }));
        const write = h.queue({ content: '新しい名前' });
        h.form.dispose();
        await write;

        expect(Notice.messages).toEqual([refusalNotice(REFUSED)]);
        expect(h.said.has('write')).toBe(false);
        expect(h.refresh).not.toHaveBeenCalled();
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
