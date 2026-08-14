import { describe, expect, it } from 'vitest';
import { NextTaskSuggester } from '../../../src/timer/NextTaskSuggester';
import type TaskViewerPlugin from '../../../src/main';
import type { DisplayTask } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

/**
 * idle タイマーの次タスク提案は、そこから 1 タップでタイマーが始まる導線である。
 * 読み取り専用の記法（day-planner / tasks-plugin）にはタイマーの記録を書けない
 * ので、提案に載せると「計測はできたのに何も残らない」という結末になる。
 * カードメニューが読み取り専用を弾いているのと同じ規則で候補から外す。
 *
 * 判定は実時刻に対して行われるので、テストの日時は「今」から作る。
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** 「今」から分単位でずらした日付と時刻。 */
function at(offsetMinutes: number): { date: string; time: string } {
    const d = new Date(Date.now() + offsetMinutes * 60_000);
    return {
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
}

function window(startOffset: number, endOffset: number, overrides: Partial<DisplayTask> = {}): DisplayTask {
    const s = at(startOffset);
    const e = at(endOffset);
    return {
        ...makeTask({ id: overrides.id ?? 'rw' }),
        effectiveStartDate: s.date,
        effectiveStartTime: s.time,
        effectiveEndDate: e.date,
        effectiveEndTime: e.time,
        effectiveDue: undefined,
        childEntries: [],
        ...overrides,
    } as DisplayTask;
}

function makeSuggester(tasks: DisplayTask[]): NextTaskSuggester {
    let revision = 0;
    const plugin = {
        settings: { statusDefinitions: [], startHour: 0 },
        getTaskIndex: () => ({ getRevision: () => ++revision }),
        getTaskReadService: () => ({
            getStartHour: () => 0,
            getVisibleDisplayTasks: () => tasks,
            getTask: (id: string) => tasks.find(t => t.id === id),
        }),
    } as unknown as TaskViewerPlugin;
    return new NextTaskSuggester(plugin);
}

describe('NextTaskSuggester: read-only tasks', () => {
    it('suggests a writable task whose window contains now', () => {
        const got = makeSuggester([window(-30, 30)]).getSuggestion();
        expect(got?.kind).toBe('current');
        expect(got?.task.id).toBe('rw');
    });

    it('skips a read-only task in the same window', () => {
        const tasks = [window(-30, 30, { id: 'ro', isReadOnly: true, parserId: 'day-planner' })];
        expect(makeSuggester(tasks).getSuggestion()).toBeNull();
    });

    it('skips a read-only task that would otherwise win as the current one', () => {
        // 開始が遅い方が 'current' として勝つ。除外が効かないと ro が返る。
        const tasks = [
            window(-10, 30, { id: 'ro', isReadOnly: true }),
            window(-30, 30, { id: 'rw' }),
        ];
        expect(makeSuggester(tasks).getSuggestion()?.task.id).toBe('rw');
    });
});
