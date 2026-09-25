import { describe, expect, it, beforeEach } from 'vitest';
import { Notice, type App } from 'obsidian';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import type TaskViewerPlugin from '../../../src/main';
import { makeTask } from '../helpers/makeTask';
import en from '../../../src/i18n/locales/en.json';

/**
 * 記録の成否と通知。記録を書けたときだけ成功の通知を1回出し、書けなかったときは
 * 成功の通知を出さずに偽を返す（理由は書き込みの層が1回だけ出す。ここの偽の
 * 書き込みは通知を出さないので、recorder 自身が出した数だけが数えられる）。
 * 対象を引けないときは recorder 自身が解決の失敗を1回だけ出す。
 */

const CHILD_ID = 'tv-inline:notes/a.md:ln:5';
const PARENT_ID = 'tv-inline:notes/a.md:ln:3';

type NoticeKey = keyof typeof en.notice;

/** en の文面の {{…}} を任意の文字列と見て、通知がその鍵のものか。 */
function isNotice(message: string, key: NoticeKey): boolean {
    const template = en.notice[key] as string;
    const pattern = template
        .split(/\{\{\w+\}\}/)
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
    return new RegExp(`^${pattern}$`, 's').test(message);
}

interface Options {
    childExists?: boolean;
    resolvable?: boolean;
    updateResult?: boolean;
    insertResult?: boolean;
}

function makeHarness(options: Options = {}) {
    const inserted: string[] = [];
    const updates: { id: string; updates: Record<string, unknown> }[] = [];
    const childExists = options.childExists !== false;
    const resolvable = options.resolvable !== false;

    const parent = makeTask({ id: PARENT_ID, file: 'notes/a.md', line: 2, content: 'parent', blockId: 'tv-timer-anchor', anchor: 'tv-timer-anchor' });
    const child = makeTask({ id: CHILD_ID, file: 'notes/a.md', line: 3, content: '', blockId: 'tv-timer-1', anchor: 'tv-timer-1' });
    const visible = childExists ? [parent, child] : [parent];

    const taskIndex = {
        getTask: (id: string) => {
            if (id === CHILD_ID) return childExists ? child : undefined;
            if (id === PARENT_ID) return resolvable ? parent : undefined;
            return undefined;
        },
        getTaskByAnchor: (file: string, anchor: string) => visible.find(t => t.file === file && t.anchor === anchor),
        getTasks: () => visible,
        getTaskByFileLine: () => parent,
        updateTask: async (id: string, u: Record<string, unknown>) => {
            updates.push({ id, updates: u });
            return options.updateResult ?? true;
        },
        waitForScan: async () => { /* unused */ },
    };

    const plugin = {
        settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 },
        getTaskIndex: () => taskIndex,
        getTaskWriteService: () => ({
            recordChildTask: async (_parentId: string, line: string) => {
                inserted.push(line);
                return options.insertResult ?? true;
            },
        }),
    } as unknown as TaskViewerPlugin;

    const storageUtils = { generateTimerTargetId: () => 'tv-timer-2' } as unknown as TimerStorageUtils;
    const recorder = new TimerRecorder({} as App, plugin, storageUtils);

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
        runState: 'running',
        sessionCount: 0,
        recordedElapsedTime: 0,
        isExpanded: true,
        intervalId: null,
        recordMode: 'child',
        parserId: 'tv-inline',
        taskColor: '',
        timerType: 'countup',
        elapsedTime: 600,
        ...overrides,
    } as TimerInstance;
}

const INTERVAL: Partial<TimerInstance> = {
    timerType: 'interval',
    intervalSource: 'pomodoro',
    groups: [],
    currentGroupIndex: 0,
    currentSegmentIndex: 0,
    currentRepeatIndex: 0,
    segmentTimeRemaining: 0,
    totalElapsedTime: 600,
    totalDuration: 600,
} as Partial<TimerInstance>;

const COUNTDOWN: Partial<TimerInstance> = { timerType: 'countdown', timeRemaining: 0, totalTime: 600 } as Partial<TimerInstance>;

/** 各経路: どの書き込みが結果を持つか、成功で出る通知の鍵。 */
const paths: {
    name: string;
    timer: Partial<TimerInstance>;
    write: 'insert' | 'update';
    success: NoticeKey;
}[] = [
    { name: 'countup child record', timer: {}, write: 'insert', success: 'timerRecorded' },
    { name: 'countdown record', timer: COUNTDOWN, write: 'insert', success: 'countdownRecorded' },
    { name: 'interval record', timer: INTERVAL, write: 'insert', success: 'kindRecorded' },
    { name: 'the running line (updateChildAtEnd)', timer: { tailRecordBlockId: 'tv-timer-1' }, write: 'update', success: 'kindRecorded' },
    { name: 'self (updateTaskDirectly)', timer: { recordMode: 'self' }, write: 'update', success: 'taskUpdated' },
];

describe('recordSessionEnd answers whether the record was written', () => {
    beforeEach(() => { Notice.messages.length = 0; });

    it.each(paths)('$name: not written → false, no success notice', async ({ timer, write }) => {
        const h = makeHarness(write === 'insert' ? { insertResult: false } : { updateResult: false });

        const recorded = await h.recorder.recordSessionEnd(makeTimer(timer));

        expect(recorded).toBe(false);
        expect(write === 'insert' ? h.inserted : h.updates).toHaveLength(1);
        expect(Notice.messages).toHaveLength(0);
    });

    it.each(paths)('$name: written → true, one success notice', async ({ timer, write, success }) => {
        const h = makeHarness();

        const recorded = await h.recorder.recordSessionEnd(makeTimer(timer));

        expect(recorded).toBe(true);
        expect(write === 'insert' ? h.inserted : h.updates).toHaveLength(1);
        expect(Notice.messages).toHaveLength(1);
        expect(isNotice(Notice.messages[0], success)).toBe(true);
    });

    it('self does not take the running line as the tail when the write was refused', async () => {
        const h = makeHarness({ updateResult: false });
        const timer = makeTimer({ recordMode: 'self' });

        await h.recorder.recordSessionEnd(timer);

        expect(timer.tailRecordBlockId).toBeUndefined();
    });
});

describe('the running line was lost: a record is added instead', () => {
    beforeEach(() => { Notice.messages.length = 0; });

    it('says only that it was recorded, once', async () => {
        const h = makeHarness({ childExists: false });

        const recorded = await h.recorder.recordSessionEnd(makeTimer({ tailRecordBlockId: 'tv-timer-1' }));

        expect(recorded).toBe(true);
        expect(h.inserted).toHaveLength(1);
        expect(Notice.messages).toHaveLength(1);
        expect(isNotice(Notice.messages[0], 'timerRecorded')).toBe(true);
    });

    it('says nothing of success when the added record was not written', async () => {
        const h = makeHarness({ childExists: false, insertResult: false });

        const recorded = await h.recorder.recordSessionEnd(makeTimer({ tailRecordBlockId: 'tv-timer-1' }));

        expect(recorded).toBe(false);
        expect(h.inserted).toHaveLength(1);
        expect(Notice.messages).toHaveLength(0);
    });
});

describe('the target cannot be resolved', () => {
    beforeEach(() => { Notice.messages.length = 0; });

    it.each([
        { name: 'child record', timer: {} },
        { name: 'self', timer: { recordMode: 'self' } as Partial<TimerInstance> },
    ])('$name: says the target was not found, once, and answers false', async ({ timer }) => {
        const h = makeHarness({ resolvable: false });

        const recorded = await h.recorder.recordSessionEnd(makeTimer(timer));

        expect(recorded).toBe(false);
        expect(h.inserted).toHaveLength(0);
        expect(h.updates).toHaveLength(0);
        expect(Notice.messages).toHaveLength(1);
        expect(isNotice(Notice.messages[0], 'timerTargetNotFound')).toBe(true);
    });
});
