import { describe, expect, it } from 'vitest';
import { TimerTaskResolver } from '../../../src/timer/TimerTaskResolver';
import type TaskViewerPlugin from '../../../src/main';
import { makeTask } from '../helpers/makeTask';

/**
 * 対象の解決手段はどれも候補に tvInline / tvFile を要求するので、読み取り専用の
 * 記法（day-planner / tasks-plugin）は「見つからない」のと同じ経路で落ちる。
 * 原因は別物なので、失敗の文言を選ぶ材料として区別を返す。
 */
describe('TimerTaskResolver.explainFailure', () => {
    const resolverFor = (tasks: ReturnType<typeof makeTask>[]) => new TimerTaskResolver({
        getTaskIndex: () => ({ getTask: (id: string) => tasks.find(t => t.id === id) }),
    } as unknown as TaskViewerPlugin);

    it('read-only when the id resolves to a task the timer cannot write', () => {
        const task = makeTask({ id: 'dp', parserId: 'day-planner', isReadOnly: true });
        expect(resolverFor([task]).explainFailure({ taskId: 'dp' })).toBe('read-only');
    });

    it('not-found when nothing sits at that id', () => {
        expect(resolverFor([]).explainFailure({ taskId: 'gone' })).toBe('not-found');
    });

    it('not-found when the task is writable (the line was lost, not the format)', () => {
        const task = makeTask({ id: 'rw' });
        expect(resolverFor([task]).explainFailure({ taskId: 'rw' })).toBe('not-found');
    });
});
