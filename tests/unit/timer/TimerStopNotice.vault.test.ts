import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import type { RecordMode, TimerState } from '../../../src/timer/TimerState';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { begin, timerOn, timerRig, type TimerRig } from '../helpers/timerRig';
import en from '../../../src/i18n/locales/en.json';

/**
 * ■ を1回押したときに利用者が聞くのは、ちょうど1件。書けたなら記録の通知
 * （`notice.timerRecorded`）、書けなかったなら拒否の理由。実物の TaskIndex、
 * 書き込みの層、TimerRecorder、TimerLifecycle を通す。走行中の行は、index が
 * 読み直す前に外から書き換えるか消す。
 */

(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
    addEventListener: () => { }, removeEventListener: () => { },
};

const FILE = 'notes/a.md';

type NoticeKey = keyof typeof en.notice;

function isNotice(message: string, key: NoticeKey): boolean {
    const template = en.notice[key] as string;
    const pattern = template
        .split(/\{\{\w+\}\}/)
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
    return new RegExp(`^${pattern}$`, 's').test(message);
}

/** 閉じたあとの片付け（錨を外す書き込み）まで待つ。 */
async function settleAll(s: VaultSession) {
    for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 0));
        await s.settle(FILE);
    }
}

/** 1 本目の行を書いて、1 分走ったタイマー。 */
async function start(s: VaultSession, mode: RecordMode): Promise<{ rig: TimerRig; timer: TimerState }> {
    await s.scanAll();
    const rig = timerRig(s);
    const target = s.index.getTasks().find(task => task.content === '対象')!;
    const timer = await begin(rig, timerOn(target, mode, 'countup', s.recorder.startAnchor(target) ?? undefined), target);
    await s.settle(FILE);
    vi.setSystemTime(Date.now() + 60_000);
    return { rig, timer };
}

describe('one press of ■ says one thing', () => {
    let contents: Map<string, string>;
    let s: VaultSession;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 8, 21, 9, 0, 0));
        contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n')]]);
        s = vaultSession(contents);
    });
    afterEach(() => { s.dispose(); vi.useRealTimers(); });

    it('written: one notice, and it is the success', async () => {
        const { rig, timer } = await start(s, 'child');
        Notice.messages.length = 0;

        await rig.lifecycle.stop(timer, 'close');

        expect(Notice.messages).toHaveLength(1);
        expect(isNotice(Notice.messages[0], 'timerRecorded')).toBe(true);
        expect(rig.board.has(timer)).toBe(false);
        await settleAll(s);
        // The running line closed, and the anchors the timer put on taken off as it closed.
        expect(contents.get(FILE)).toMatch(/^- \[ \] 対象 @2026-09-21\n\t- \[x\] ⏱️ 対象 @[^^]*$/m);
        expect(contents.get(FILE)).not.toContain('^tv-t-');
    });

    // An edit from outside that the index was never told of: the timer looks
    // its rows up by anchor in a reading of the note as the disk holds it
    // (`TaskIndex.freshByAnchor`), and goes on with what the anchor finds.
    it('the running line was removed behind the index: it is found gone, and the record is written in its place', async () => {
        const { rig, timer } = await start(s, 'child');
        // 外から走行中の行を消す。index はまだ読み直していない。
        const anchor = `^${timer.tail}`;
        contents.set(FILE, contents.get(FILE)!.split('\n').filter(line => !line.includes(anchor)).join('\n'));
        Notice.messages.length = 0;

        await rig.lifecycle.stop(timer, 'close');

        expect(Notice.messages, Notice.messages.join(' | ')).toHaveLength(1);
        expect(isNotice(Notice.messages[0], 'timerRecorded'), Notice.messages[0]).toBe(true);
        expect(rig.board.has(timer)).toBe(false);
        await settleAll(s);
        // The fallback record, under the target: the removed line is not written back.
        expect(contents.get(FILE)).not.toContain(anchor);
        expect(contents.get(FILE)).toMatch(/^- \[ \] 対象 .*\n\t- \[x\] ⏱️ 対象 /);
    });

    it('the running line was rewritten behind the index: the anchor finds it, and the record is written there', async () => {
        const { rig, timer } = await start(s, 'self');
        // self の記録先（対象タスクの行）を、index が読み直す前に書き換える。
        contents.set(FILE, contents.get(FILE)!.replace('- [ ] 対象', '- [ ] 別の名前'));
        Notice.messages.length = 0;

        await rig.lifecycle.stop(timer, 'close');

        expect(Notice.messages, Notice.messages.join(' | ')).toHaveLength(1);
        expect(isNotice(Notice.messages[0], 'timerRecorded'), Notice.messages[0]).toBe(true);
        expect(rig.board.has(timer)).toBe(false);
        await settleAll(s);
        expect(contents.get(FILE)).toMatch(/^- \[x\] ⏱️ 別の名前 @/);
    });

    // A read that fails for a moment (EBUSY on Windows) says nothing of
    // whether the running line is there: no record is added in its place.
    it('the note could not be read for a moment: nothing written, the record kept pending, one notice; pressed again, the running line is closed', async () => {
        const { rig, timer } = await start(s, 'child');
        const before = contents.get(FILE);
        const busy = Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
        vi.spyOn(s.app.vault, 'read').mockRejectedValueOnce(busy);
        Notice.messages.length = 0;

        await rig.lifecycle.stop(timer, 'close');

        expect(Notice.messages, Notice.messages.join(' | ')).toHaveLength(1);
        expect(isNotice(Notice.messages[0], 'notReadable'), Notice.messages[0]).toBe(true);
        expect(contents.get(FILE)).toBe(before);
        expect(timer.session.kind).toBe('pending');
        expect(rig.board.has(timer)).toBe(true);

        Notice.messages.length = 0;
        await rig.lifecycle.stop(timer, 'close');

        expect(Notice.messages, Notice.messages.join(' | ')).toHaveLength(1);
        expect(isNotice(Notice.messages[0], 'timerRecorded'), Notice.messages[0]).toBe(true);
        expect(rig.board.has(timer)).toBe(false);
        await settleAll(s);
        // The running line closed: one record under the target, not two.
        expect(contents.get(FILE)!.split('\n').filter(line => line.includes('⏱️'))).toHaveLength(1);
        expect(contents.get(FILE)).toMatch(/^\t- \[x\] ⏱️ 対象 @/m);
    });
});
