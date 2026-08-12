import { describe, expect, it, beforeEach } from 'vitest';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import type TaskViewerPlugin from '../../../src/main';
import type { App } from 'obsidian';
import { makeTask } from '../helpers/makeTask';

/**
 * child モードでは開始時に placeholder の子タスクが 1 行書かれる
 * (`createChildAtStart`)。停止時はその行を更新するだけで、新しい行を足しては
 * ならない — **1 セッション = 1 行**。
 *
 * countdown / interval の停止は `addCountdownRecord` / `addIntervalRecord` を
 * 直接呼んでおり、placeholder を無視して 2 行目を書いていた。停止経路を
 * `recordSessionEnd` に集約したことをここで pin する。
 */

interface Harness {
    recorder: TimerRecorder;
    inserted: string[];
    updates: { id: string; updates: Record<string, unknown> }[];
}

const CHILD_ID = 'tv-inline:notes/a.md:ln:5';
const PARENT_ID = 'tv-inline:notes/a.md:ln:3';

function makeHarness(options: { childExists?: boolean } = {}): Harness {
    const inserted: string[] = [];
    const updates: { id: string; updates: Record<string, unknown> }[] = [];
    const childExists = options.childExists !== false;

    const parent = makeTask({ id: PARENT_ID, file: 'notes/a.md', line: 2, content: 'parent', blockId: 'tv-timer-anchor' });
    const child = makeTask({ id: CHILD_ID, file: 'notes/a.md', line: 3, content: '', blockId: 'tv-timer-1' });

    const taskIndex = {
        getTask: (id: string) => {
            if (id === CHILD_ID) return childExists ? child : undefined;
            return id === PARENT_ID ? parent : undefined;
        },
        getTasks: () => (childExists ? [parent, child] : [parent]),
        getTaskByFileLine: () => parent,
        updateTask: async (id: string, u: Record<string, unknown>) => { updates.push({ id, updates: u }); },
        waitForScan: async () => { /* unused */ },
    };

    const plugin = {
        settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 },
        getTaskIndex: () => taskIndex,
        getTaskWriteService: () => ({
            insertChildTask: async (_parentId: string, line: string) => { inserted.push(line); },
        }),
    } as unknown as TaskViewerPlugin;

    const storageUtils = { generateTimerTargetId: () => 'tv-timer-2' } as unknown as TimerStorageUtils;
    const recorder = new TimerRecorder({} as App, plugin, storageUtils);

    // resolver は plugin 経由で index を引く。テストでは常に parent に解決させる。
    (recorder as unknown as { resolver: { resolveTvInline: () => unknown; resolveTvFile: () => unknown } }).resolver = {
        resolveTvInline: () => parent,
        resolveTvFile: () => parent,
    };

    return { recorder, inserted, updates };
}

function makeTimer(overrides: Partial<TimerInstance> = {}): TimerInstance {
    return {
        id: 'timer-1',
        taskId: PARENT_ID,
        taskName: 'parent',
        taskOriginalText: '- [ ] parent',
        taskFile: 'notes/a.md',
        startTimeMs: 0,
        pausedElapsedTime: 600,
        phase: 'work',
        isRunning: false,
        isExpanded: true,
        intervalId: null,
        customLabel: '',
        recordMode: 'child',
        parserId: 'tv-inline',
        taskColor: '',
        timerType: 'countup',
        elapsedTime: 600,
        recordedChildTaskId: CHILD_ID,
        ...overrides,
    } as TimerInstance;
}

describe('recordSessionEnd: one session writes one line', () => {
    let h: Harness;
    beforeEach(() => { h = makeHarness(); });

    it('countup updates the placeholder instead of inserting a second line', async () => {
        await h.recorder.recordSessionEnd(makeTimer());
        expect(h.inserted).toHaveLength(0);
        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].id).toBe(CHILD_ID);
        expect(h.updates[0].updates.statusChar).toBe('x');
    });

    it('countdown updates the placeholder instead of inserting a second line', async () => {
        const timer = makeTimer({ timerType: 'countdown', timeRemaining: 0, totalTime: 600 } as Partial<TimerInstance>);
        await h.recorder.recordSessionEnd(timer);
        expect(h.inserted).toHaveLength(0);
        expect(h.updates).toHaveLength(1);
    });

    it('interval updates the placeholder instead of inserting a second line', async () => {
        const timer = makeTimer({
            timerType: 'interval',
            intervalSource: 'pomodoro',
            groups: [],
            currentGroupIndex: 0,
            currentSegmentIndex: 0,
            currentRepeatIndex: 0,
            segmentTimeRemaining: 0,
            totalElapsedTime: 600,
            totalDuration: 600,
        } as Partial<TimerInstance>);
        await h.recorder.recordSessionEnd(timer);
        expect(h.inserted).toHaveLength(0);
        expect(h.updates).toHaveLength(1);
    });

    it('falls back to inserting a record when the placeholder was deleted', async () => {
        const gone = makeHarness({ childExists: false });
        await gone.recorder.recordSessionEnd(makeTimer());
        expect(gone.inserted).toHaveLength(1);
        expect(gone.updates).toHaveLength(0);
    });

    it('inserts a single record when no placeholder was created', async () => {
        await h.recorder.recordSessionEnd(makeTimer({ recordedChildTaskId: undefined }));
        expect(h.inserted).toHaveLength(1);
        expect(h.updates).toHaveLength(0);
    });

    it('self mode updates the task itself and writes no child line', async () => {
        await h.recorder.recordSessionEnd(makeTimer({ recordMode: 'self', recordedChildTaskId: undefined }));
        expect(h.inserted).toHaveLength(0);
        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].id).toBe(PARENT_ID);
        expect(h.updates[0].updates.statusChar).toBe('x');
    });

    it('self mode keeps the anchor on the record line so the next session can find it', async () => {
        // 記録で content も日時も書き換わるため、id を落とすと再開後のセッションが
        // 対象を引き直せない（実機で「再開しても記録されない」として現れた）。
        // 自動生成 id の掃除はタイマーを閉じるときに行う。
        await h.recorder.recordSessionEnd(makeTimer({
            recordMode: 'self', recordedChildTaskId: undefined, autoGeneratedTargetId: true,
        }));
        expect(h.updates[0].updates.blockId).toBe('tv-timer-anchor');
    });
});

/**
 * 上のテストは recordSessionEnd 自体の振る舞いしか見ない。「停止ボタンが
 * そこを通る」という結びつきは DOM を組まないと動かせないので、代わりに
 * 呼び出し側に直呼びが残っていないことをソースレベルで固定する。
 */
describe('stop paths do not bypass recordSessionEnd', () => {
    const files = ['src/timer/TimerRenderer.ts', 'src/timer/TimerLifecycle.ts'];

    it.each(files)('%s calls no per-type record API directly', async (file) => {
        const { readFileSync } = await import('node:fs');
        const source = readFileSync(file, 'utf8');
        expect(source).not.toMatch(/recorder\.addCountupRecord\(/);
        expect(source).not.toMatch(/recorder\.addCountdownRecord\(/);
        expect(source).not.toMatch(/recorder\.addIntervalRecord\(/);
        expect(source).not.toMatch(/recorder\.updateTaskDirectly\(/);
        expect(source).toMatch(/recorder\.recordSessionEnd\(/);
    });
});
