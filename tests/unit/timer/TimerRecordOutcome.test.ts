import { describe, expect, it, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import type { PendingRecord, TimerState } from '../../../src/timer/TimerState';
import { step, type TimerEvent } from '../../../src/timer/TimerTransitions';
import type TaskViewerPlugin from '../../../src/main';
import { makeTask } from '../helpers/makeTask';
import en from '../../../src/i18n/locales/en.json';
import { opsOver } from '../helpers/anchoredRow';
import { timerOn, type MeasureKind } from '../helpers/timerRig';

/**
 * 記録の成否と通知。記録を書けたときだけ記録の通知（`notice.timerRecorded`）を
 * 1回出す。経路（走行中の行を閉じる、予備の記録を足す、self の対象の行）と
 * 測り方で文言は変わらず、種類（Timer、Countdown、Pomodoro）だけを言う。
 * 書けなかったときは通知を出さずに偽を返す（理由は書き込みの層が1回だけ出す。
 * ここの偽の書き込みは通知を出さないので、recorder 自身が出した数だけが数えられる）。
 * 対象を引けないときは recorder 自身が解決の失敗を1回だけ出す。
 */

const FILE = 'notes/a.md';
const CHILD_ID = 'tv-inline:notes/a.md:ln:5';
const PARENT_ID = 'tv-inline:notes/a.md:ln:3';
const TARGET = 'tv-timer-anchor';
const RUNNING = 'tv-timer-1';

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

const outlet = {
    dispatch: (timer: TimerState, event: TimerEvent) => { Object.assign(timer, step(timer, event, Date.now())); },
    timers: () => [],
};

function makeHarness(options: Options = {}) {
    const inserted: string[] = [];
    const updates: { id: string; updates: Record<string, unknown> }[] = [];
    const childExists = options.childExists !== false;
    const resolvable = options.resolvable !== false;

    const parent = makeTask({ id: PARENT_ID, file: FILE, line: 2, content: 'parent', blockId: TARGET, anchor: TARGET });
    const child = makeTask({ id: CHILD_ID, file: FILE, line: 3, content: '', blockId: RUNNING, anchor: RUNNING });
    const visible = childExists ? [parent, child] : [parent];

    const taskIndex = {
        getTask: (id: string) => visible.find(t => t.id === id),
        getTaskByAnchor: (file: string, anchor: string) => {
            if (anchor === TARGET && !resolvable) return undefined;
            return visible.find(t => t.file === file && t.anchor === anchor);
        },
        getTasks: () => visible,
        updateTask: async (id: string, u: Record<string, unknown>) => {
            updates.push({ id, updates: u });
            return options.updateResult ?? true;
        },
    };

    const plugin = {
        settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 },
        getIndex: () => taskIndex,
        getOperations: () => ({
            ...opsOver(taskIndex),
            insertLine: async (_parentId: string, line: string, _place: string) => {
                inserted.push(line);
                return options.insertResult ?? true;
            },
        }),
    } as unknown as TaskViewerPlugin;

    const recorder = new TimerRecorder(plugin, outlet, () => 'tv-timer-2');
    return { recorder, inserted, updates, parent };
}

type Harness = ReturnType<typeof makeHarness>;

interface Shape { kind?: MeasureKind; self?: boolean; tail?: string | null }

/** `parent` に始めた child のタイマー。尻尾は `shape.tail`（無ければ走行中の行を書いていない）。 */
function makeTimer(h: Harness, shape: Shape = {}): TimerState {
    return { ...timerOn(h.parent, shape.self ? 'self' : 'child', shape.kind ?? 'countup'), tail: shape.tail ?? null };
}

/** 止めた時点で固定する記録: 10 分。 */
function recordFor(then: PendingRecord['then'] = 'close'): PendingRecord {
    return { endMs: Date.now(), seconds: 600, then };
}

/** 各経路: どの書き込みが結果を持つか、記録の通知が言う種類。 */
const paths: { name: string; shape: Shape; write: 'insert' | 'update'; kind: string }[] = [
    { name: 'countup, an added record', shape: {}, write: 'insert', kind: 'Timer' },
    { name: 'countdown, an added record', shape: { kind: { countdown: 600 } }, write: 'insert', kind: 'Countdown' },
    { name: 'pomodoro, an added record', shape: { kind: 'pomodoro' }, write: 'insert', kind: 'Pomodoro' },
    { name: 'the running line closed', shape: { tail: RUNNING }, write: 'update', kind: 'Timer' },
    { name: 'pomodoro, the running line closed', shape: { kind: 'pomodoro', tail: RUNNING }, write: 'update', kind: 'Pomodoro' },
    // self の 1 本目: 開始の書き込みで尻尾を対象の錨に置いている。
    { name: 'self, the target row', shape: { self: true, tail: TARGET }, write: 'update', kind: 'Timer' },
];

describe('recordSessionEnd answers whether the record was written', () => {
    beforeEach(() => { Notice.messages.length = 0; });

    it.each(paths)('$name: not written → false, no notice', async ({ shape, write }) => {
        const h = makeHarness(write === 'insert' ? { insertResult: false } : { updateResult: false });

        const recorded = await h.recorder.recordSessionEnd(makeTimer(h, shape), recordFor());

        expect(recorded).toBe(false);
        expect(write === 'insert' ? h.inserted : h.updates).toHaveLength(1);
        expect(Notice.messages).toHaveLength(0);
    });

    it.each(paths)('$name: written → true, one notice that says recorded and its kind', async ({ shape, write, kind }) => {
        const h = makeHarness();

        const recorded = await h.recorder.recordSessionEnd(makeTimer(h, shape), recordFor());

        expect(recorded).toBe(true);
        expect(write === 'insert' ? h.inserted : h.updates).toHaveLength(1);
        expect(Notice.messages).toHaveLength(1);
        expect(isNotice(Notice.messages[0], 'timerRecorded')).toBe(true);
        expect(Notice.messages[0]).toContain(` ${kind} `);
    });

    it('self: a refused write leaves the tail on the target row', async () => {
        const h = makeHarness({ updateResult: false });
        const timer = makeTimer(h, { self: true, tail: TARGET });

        await h.recorder.recordSessionEnd(timer, recordFor());

        expect(timer.tail).toBe(TARGET);
    });

    it('an added record not written: the tail and the opening are as they were', async () => {
        const h = makeHarness({ insertResult: false });
        const timer = makeTimer(h);

        await h.recorder.recordSessionEnd(timer, recordFor());

        expect(timer.tail).toBeNull();
        expect(timer.opening).toBeNull();
        expect(timer.owned).toEqual([]);
    });
});

describe('the running line was lost: a record is added instead', () => {
    beforeEach(() => { Notice.messages.length = 0; });

    it('says only that it was recorded, once', async () => {
        const h = makeHarness({ childExists: false });

        const recorded = await h.recorder.recordSessionEnd(makeTimer(h, { tail: RUNNING }), recordFor());

        expect(recorded).toBe(true);
        expect(h.inserted).toHaveLength(1);
        expect(Notice.messages).toHaveLength(1);
        expect(isNotice(Notice.messages[0], 'timerRecorded')).toBe(true);
    });

    it('says nothing when the added record was not written', async () => {
        const h = makeHarness({ childExists: false, insertResult: false });

        const recorded = await h.recorder.recordSessionEnd(makeTimer(h, { tail: RUNNING }), recordFor());

        expect(recorded).toBe(false);
        expect(h.inserted).toHaveLength(1);
        expect(Notice.messages).toHaveLength(0);
    });
});

describe('the target cannot be resolved', () => {
    beforeEach(() => { Notice.messages.length = 0; });

    it.each<{ name: string; shape: Shape }>([
        { name: 'child, an added record', shape: {} },
        { name: 'self', shape: { self: true, tail: TARGET } },
    ])('$name: says the target was not found, once, and answers false', async ({ shape }) => {
        const h = makeHarness({ resolvable: false });

        const recorded = await h.recorder.recordSessionEnd(makeTimer(h, shape), recordFor());

        expect(recorded).toBe(false);
        expect(h.inserted).toHaveLength(0);
        expect(h.updates).toHaveLength(0);
        expect(Notice.messages).toHaveLength(1);
        expect(isNotice(Notice.messages[0], 'timerTargetNotFound')).toBe(true);
    });
});
