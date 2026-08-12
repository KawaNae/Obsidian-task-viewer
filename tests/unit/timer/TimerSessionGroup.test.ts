import { describe, expect, it } from 'vitest';
import {
    SESSION_RECORD_ICONS,
    isSessionRecord,
    looksLikeSessionGroup,
    resolveSessionGroup,
} from '../../../src/timer/TimerSessionGroup';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

/**
 * 「グループが既にあるか」はファイルの形から判断する。状態フラグにすると、
 * 再起動やユーザーの手編集とすぐ食い違う。
 */

function lookup(tasks: Task[]) {
    const byId = new Map(tasks.map(t => [t.id, t]));
    return (id: string) => byId.get(id);
}

const record = (id: string, overrides: Partial<Task> = {}) => makeTask({
    id, content: '⏱️', statusChar: 'x', startDate: '2026-08-13', startTime: '09:00',
    endDate: '2026-08-13', endTime: '10:00', ...overrides,
});

describe('isSessionRecord', () => {
    it('accepts a completed, timed line that starts with a timer icon', () => {
        expect(isSessionRecord(record('r1'))).toBe(true);
    });

    it('accepts every icon the recorder can write', () => {
        for (const icon of SESSION_RECORD_ICONS) {
            expect(isSessionRecord(record('r1', { content: `${icon} note` }))).toBe(true);
        }
    });

    it('rejects an unchecked line — a record is a fact, never a pending state', () => {
        expect(isSessionRecord(record('r1', { statusChar: ' ' }))).toBe(false);
    });

    it('rejects a line without a time (an allday task is not a session)', () => {
        expect(isSessionRecord(record('r1', { startTime: undefined }))).toBe(false);
    });

    it('rejects an ordinary completed child', () => {
        expect(isSessionRecord(record('r1', { content: 'just a subtask' }))).toBe(false);
    });

    it('rejects undefined (deleted child)', () => {
        expect(isSessionRecord(undefined)).toBe(false);
    });
});

describe('looksLikeSessionGroup', () => {
    it('is true for a task with a session record child', () => {
        const group = makeTask({ id: 'g1', content: 'task A', childIds: ['r1'] });
        const tasks = [group, record('r1')];
        expect(looksLikeSessionGroup(group, lookup(tasks))).toBe(true);
    });

    it('is false for a task whose children are ordinary subtasks', () => {
        const parent = makeTask({ id: 'p1', content: 'task A', childIds: ['c1'] });
        const child = makeTask({ id: 'c1', content: 'subtask', statusChar: 'x' });
        expect(looksLikeSessionGroup(parent, lookup([parent, child]))).toBe(false);
    });

    it('is false for a childless task', () => {
        const task = makeTask({ id: 't1', content: 'task A' });
        expect(looksLikeSessionGroup(task, lookup([task]))).toBe(false);
    });

    it('survives a dangling childId', () => {
        const parent = makeTask({ id: 'p1', childIds: ['gone'] });
        expect(looksLikeSessionGroup(parent, lookup([parent]))).toBe(false);
    });
});

describe('resolveSessionGroup', () => {
    it('walks from the anchor record up to its group', () => {
        const group = makeTask({ id: 'g1', content: 'task A', childIds: ['r1', 'r2'] });
        const anchor = record('r1', { parentId: 'g1' });
        const second = record('r2', { parentId: 'g1' });
        expect(resolveSessionGroup(anchor, lookup([group, anchor, second]))).toBe(group);
    });

    it('returns null while the first record is still the top-level task', () => {
        const anchor = record('r1');
        expect(resolveSessionGroup(anchor, lookup([anchor]))).toBeNull();
    });

    it('returns null when the parent is an ordinary task, not a session group', () => {
        // タイマーを普通の子タスクに掛けただけのケース。親を包んではいけない。
        const parent = makeTask({ id: 'p1', content: 'parent', childIds: ['c1'] });
        const anchor = makeTask({ id: 'c1', content: 'child', parentId: 'p1', statusChar: ' ' });
        expect(resolveSessionGroup(anchor, lookup([parent, anchor]))).toBeNull();
    });

    it('returns null when the anchor itself is gone', () => {
        expect(resolveSessionGroup(undefined, lookup([]))).toBeNull();
    });
});

describe('icon set stays in sync with the recorder', () => {
    it('covers every icon getTimerIcon can return', () => {
        const recorder = new TimerRecorder({} as never, {} as never, {} as never);
        const getIcon = (recorder as unknown as { getTimerIcon: (t: TimerInstance) => string }).getTimerIcon
            .bind(recorder);

        const variants: TimerInstance[] = [
            { timerType: 'countup' } as TimerInstance,
            { timerType: 'countdown' } as TimerInstance,
            { timerType: 'interval', intervalSource: 'pomodoro' } as TimerInstance,
            { timerType: 'interval' } as TimerInstance,
        ];

        for (const timer of variants) {
            expect(SESSION_RECORD_ICONS).toContain(getIcon(timer));
        }
    });
});
