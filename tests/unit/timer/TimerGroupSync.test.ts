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

function build(options: { groupStartDate?: string; groupEndDate?: string; withGroup?: boolean; anchorMissing?: boolean } = {}) {
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

    const writes: { kind: string; parentId?: string; line?: string; opts?: Record<string, unknown> }[] = [];
    const writeService = {
        insertChildTask: async (parentId: string, line: string) => { writes.push({ kind: 'insert', parentId, line }); },
        appendChildTask: async (parentId: string, line: string) => { writes.push({ kind: 'append', parentId, line }); },
        wrapTaskInGroup: async (taskId: string, opts: Record<string, unknown>) => { writes.push({ kind: 'wrap', parentId: taskId, opts }); },
    };

    const plugin = {
        settings: {},
        getTaskIndex: () => taskIndex,
        getTaskWriteService: () => writeService,
    } as unknown as TaskViewerPlugin;

    const recorder = new TimerRecorder({} as App, plugin, {
        generateTimerTargetId: () => 'tv-timer-new',
    } as unknown as TimerStorageUtils);
    (recorder as unknown as { resolver: { resolveTvInline: () => Task | undefined; resolveTvFile: () => Task | undefined } }).resolver = {
        resolveTvInline: () => (options.anchorMissing ? undefined : record),
        resolveTvFile: () => (options.anchorMissing ? undefined : record),
    };

    return { recorder, updates, writes, group, record };
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

describe('startNextSession', () => {
    it('appends under the group once one exists', async () => {
        const h = build();
        await h.recorder.startNextSession(makeTimer());

        expect(h.writes).toHaveLength(1);
        expect(h.writes[0].kind).toBe('append');
        expect(h.writes[0].parentId).toBe(GROUP_ID);
    });

    it('wraps the first record into a group on the first resume', async () => {
        const h = build({ withGroup: false });
        await h.recorder.startNextSession(makeTimer());

        expect(h.writes).toHaveLength(1);
        const wrap = h.writes[0];
        expect(wrap.kind).toBe('wrap');
        expect(wrap.parentId).toBe(RECORD_ID);
        expect(wrap.opts?.groupStartDate).toBe('2026-08-13');
        // レコードがアイコンだけ（child モードで名前を付けていない）なら、
        // 剥がすと空になるのでタイマーが覚えているタスク名に落ちる。
        expect(wrap.opts?.groupContent).toBe('task A');
        expect(wrap.opts?.sessionLine).toContain('tv-timer-new');
    });

    it('keeps the icon off a named record when wrapping', async () => {
        const h = build({ withGroup: false });
        h.record.content = '⏱️ task A';
        await h.recorder.startNextSession(makeTimer());
        expect(h.writes[0].opts?.groupContent).toBe('task A');
    });

    it('is born as a multi-day span when the resume lands on a later day', async () => {
        const h = build({ withGroup: false });
        h.record.startDate = '2020-01-01';
        await h.recorder.startNextSession(makeTimer());
        expect(h.writes[0].opts?.groupEndDate).toBe(today());
    });

    it('stays single-day when resumed on the same day', async () => {
        const h = build({ withGroup: false });
        h.record.startDate = today();
        await h.recorder.startNextSession(makeTimer());
        expect(h.writes[0].opts?.groupEndDate).toBeUndefined();
    });

    it('falls back to a child insert when the anchor is gone', async () => {
        // レコード行を消されてもセッションは落とさない（notice も出さない）。
        const h = build({ withGroup: false, anchorMissing: true });
        await h.recorder.startNextSession(makeTimer());
        expect(h.writes.map(w => w.kind)).not.toContain('wrap');
    });

    it('never wraps a daily-note timer', async () => {
        const h = build({ withGroup: false });
        await h.recorder.startNextSession(makeTimer({ taskId: 'daily-2026-08-13' }));
        expect(h.writes.map(w => w.kind)).not.toContain('wrap');
    });
});

/**
 * ターゲット別の扱い。tvFile / daily は最初から恒久的な器を持つので変形しない
 * （子を積むだけ）。read-only ターゲットは書き込み層が弾く。
 */
describe('target matrix', () => {
    it('never wraps a tv-file timer — it already owns a container', async () => {
        const h = build({ withGroup: false });
        await h.recorder.startNextSession(makeTimer({ parserId: 'tv-file' }));

        expect(h.writes.map(w => w.kind)).not.toContain('wrap');
        expect(h.writes[0].kind).toBe('insert');
    });

    it('does not treat a tv-file task as a session group', () => {
        const h = build();
        expect(h.recorder.resolveGroup(makeTimer({ parserId: 'tv-file' }))).toBeNull();
    });

    it('keeps completing the tv-file task itself', async () => {
        const h = build();
        await h.recorder.completeTargetTask(makeTimer({ parserId: 'tv-file' }));
        // グループではなくアンカー（tv-file タスク）が対象。既に [x] なので更新なし。
        expect(h.updates).toHaveLength(0);
    });

    it('writes nothing for a daily-note timer on completion', async () => {
        const h = build();
        await h.recorder.completeTargetTask(makeTimer({ taskId: 'daily-2026-08-13' }));
        expect(h.updates).toHaveLength(0);
    });
});

/**
 * 「既にセッションを持つタスクに新しいタイマーを掛けたら append で始める」は
 * ウィジェットの開始経路が判定する。DOM 無しでは動かせないので、判定を
 * 通していること自体をソースで固定する。
 */
describe('start path consults the group shape', () => {
    it('TimerWidget asks looksLikeSessionGroup before choosing the record mode', async () => {
        const { readFileSync } = await import('node:fs');
        const source = readFileSync('src/timer/TimerWidget.ts', 'utf8');
        expect(source).toMatch(/looksLikeSessionGroup/);
        expect(source).toMatch(/recordMode: 'child'/);
        expect(source).toMatch(/appendSessionAtStart/);
    });
});
