import { describe, expect, it, beforeEach } from 'vitest';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import type TaskViewerPlugin from '../../../src/main';
import type { App } from 'obsidian';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

/**
 * グループが育った後の面倒: 状態を持つのはグループ行、レコードは事実として
 * `[x]` のまま。帯（`@初回>最終`）は作業した日に合わせて伸ばす。
 */

const GROUP_ID = 'tv-inline:notes/a.md:ln:3';
const RECORD_ID = 'tv-inline:notes/a.md:ln:4';

function today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function build(options: { groupStartDate?: string; groupEndDate?: string; withGroup?: boolean } = {}) {
    const updates: { id: string; updates: Record<string, unknown> }[] = [];
    const withGroup = options.withGroup !== false;

    const record = makeTask({
        id: RECORD_ID,
        file: 'notes/a.md',
        line: 3,
        content: '⏱️',
        statusChar: 'x',
        startDate: '2026-08-13',
        startTime: '09:00',
        endTime: '10:00',
        blockId: 'tv-timer-anchor',
        parentId: withGroup ? GROUP_ID : undefined,
    });
    const group = makeTask({
        id: GROUP_ID,
        file: 'notes/a.md',
        line: 2,
        content: 'task A',
        statusChar: ' ',
        startDate: options.groupStartDate ?? '2026-08-13',
        endDate: options.groupEndDate,
        childIds: [RECORD_ID],
    });

    const tasks = withGroup ? [group, record] : [record];
    const taskIndex = {
        getTask: (id: string) => tasks.find(t => t.id === id),
        getTasks: () => tasks,
        updateTask: async (id: string, u: Record<string, unknown>) => { updates.push({ id, updates: u }); },
        waitForScan: async () => { /* unused */ },
    };

    const plugin = {
        settings: {},
        getTaskIndex: () => taskIndex,
        getTaskWriteService: () => ({ insertChildTask: async () => { /* unused */ } }),
    } as unknown as TaskViewerPlugin;

    const recorder = new TimerRecorder({} as App, plugin, {} as unknown as TimerStorageUtils);
    (recorder as unknown as { resolver: { resolveTvInline: () => Task; resolveTvFile: () => Task } }).resolver = {
        resolveTvInline: () => record,
        resolveTvFile: () => record,
    };

    return { recorder, updates, group, record };
}

function makeTimer(overrides: Partial<TimerInstance> = {}): TimerInstance {
    return {
        id: 'timer-1',
        taskId: RECORD_ID,
        taskName: 'task A',
        taskOriginalText: '- [ ] task A',
        taskFile: 'notes/a.md',
        startTimeMs: 0,
        pausedElapsedTime: 60,
        phase: 'work',
        isRunning: false,
        runState: 'suspended',
        sessionCount: 1,
        recordedElapsedTime: 60,
        isExpanded: false,
        intervalId: null,
        customLabel: '',
        recordMode: 'child',
        parserId: 'tv-inline',
        taskColor: '',
        timerType: 'countup',
        elapsedTime: 60,
        ...overrides,
    } as TimerInstance;
}

describe('resolveGroup', () => {
    it('finds the group through the record anchor', () => {
        const h = build();
        expect(h.recorder.resolveGroup(makeTimer())?.id).toBe(GROUP_ID);
    });

    it('returns null before the group exists', () => {
        const h = build({ withGroup: false });
        expect(h.recorder.resolveGroup(makeTimer())).toBeNull();
    });

    it('returns null for a daily-note timer', () => {
        const h = build();
        expect(h.recorder.resolveGroup(makeTimer({ taskId: 'daily-2026-08-13' }))).toBeNull();
    });
});

describe('syncGroupDateSpan', () => {
    it('stretches the span to today once work crosses into another day', async () => {
        const h = build({ groupStartDate: '2020-01-01' });
        await h.recorder.syncGroupDateSpan(makeTimer());

        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].id).toBe(GROUP_ID);
        expect(h.updates[0].updates.endDate).toBe(today());
    });

    it('leaves a same-day group alone', async () => {
        const h = build({ groupStartDate: today() });
        await h.recorder.syncGroupDateSpan(makeTimer());
        expect(h.updates).toHaveLength(0);
    });

    it('never walks the end date backwards', async () => {
        const h = build({ groupStartDate: '2020-01-01', groupEndDate: '2099-12-31' });
        await h.recorder.syncGroupDateSpan(makeTimer());
        expect(h.updates).toHaveLength(0);
    });

    it('is a no-op while no group exists', async () => {
        const h = build({ withGroup: false });
        await h.recorder.syncGroupDateSpan(makeTimer());
        expect(h.updates).toHaveLength(0);
    });
});

describe('completeTargetTask', () => {
    let h: ReturnType<typeof build>;
    beforeEach(() => { h = build(); });

    it('completes the group, not the record', async () => {
        await h.recorder.completeTargetTask(makeTimer());

        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].id).toBe(GROUP_ID);
        expect(h.updates[0].updates.statusChar).toBe('x');
    });

    it('completes the task itself when no group has formed', async () => {
        const solo = build({ withGroup: false });
        // グループ未形成 = レコードがまだトップレベルのタスク行そのもの。
        // 既に [x] なので触らない。
        await solo.recorder.completeTargetTask(makeTimer());
        expect(solo.updates).toHaveLength(0);
    });
});
