import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { targetOf, type PendingRecord, type RecordMode, type TimerState } from '../../../src/timer/TimerState';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { timerOn as startCommand, widgetOver } from '../helpers/timerRig';
import en from '../../../src/i18n/locales/en.json';

/** 止めた時点で固定する記録: 1 分。 */
function recordFor(): PendingRecord {
    return { endMs: Date.now(), seconds: 60, then: 'close' };
}

/**
 * A timer runs on its target's anchor. The start command takes it from the
 * row (`TimerRecorder.startAnchor`): the row's own `^id` when it has one, or
 * a new one, which the start write puts on the row in the one write that
 * starts the timer (the start time on the row for self, the first running
 * line for child and sibling). A row whose `^id` another row carries too
 * cannot be anchored, and the timer does not start.
 */

const FILE = 'notes/a.md';

afterEach(() => vi.useRealTimers());

function lines(contents: Map<string, string>): string[] {
    return contents.get(FILE)!.split('\n').filter(line => line.trim() !== '');
}

/** The timer the start command makes on the row reading `content`, with the anchor it takes. */
async function timerOn(s: VaultSession, mode: RecordMode, content = '対象'): Promise<TimerState> {
    await s.scanAll();
    const target = s.index.getTasks().find(task => task.content === content)!;
    const anchor = s.recorder.startAnchor(target);
    expect(anchor).not.toBeNull();
    return startCommand(target, mode, 'countup', anchor!);
}

function targetRow(s: VaultSession, content = '対象') {
    return s.index.getTasks().find(task => task.content === content)!;
}

describe('the start write puts the anchor on the target, in the same write', () => {
    it.each<[RecordMode, string[]]>([
        ['self', ['- [ ] 対象 @2026-09-21', '- [ ] 下', '']],
        ['child', ['- [ ] 対象 @2026-09-21', '- [ ] 下', '']],
        ['sibling', ['- [x] 対象 @2026-09-21', '- [ ] 下', '']],
    ])('%s: one write, and the target row carries the timer\'s anchor', async (mode, start) => {
        const contents = new Map([[FILE, start.join('\n')]]);
        const s = vaultSession(contents);
        const timer = await timerOn(s, mode);
        const anchor = targetOf(timer)!;
        // The start command took a new anchor; the row has none yet.
        expect(anchor).toBe('tv-t-test1');
        expect(contents.get(FILE)).not.toContain('^');

        const process = vi.spyOn(s.app.vault, 'process');
        expect(await s.recorder.writeStart(timer, targetRow(s))).toBe(true);
        await s.settle(FILE);

        expect(process).toHaveBeenCalledTimes(1);
        // 付けたのはこの書き込みなので、閉じるときに外してよい錨として記録される。
        expect(timer.owned).toContain(anchor);
        const targetLine = lines(contents).find(line => line.includes('対象') && line.endsWith(`^${anchor}`));
        expect(targetLine).toBeDefined();
        expect(s.index.getTaskByAnchor(FILE, anchor)?.content).toBe('対象');
        // The tail: the target itself for self, the line written for the others.
        if (mode === 'self') expect(timer.tail).toBe(anchor);
        else expect(lines(contents).some(line => line.endsWith(`^${timer.tail}`) && !line.includes('@2026-09-21 '))).toBe(true);
        s.dispose();
    });

    it('a target that has an anchor keeps it: no second ^id', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21 ^mine', ''].join('\n')]]);
        const s = vaultSession(contents);
        const timer = await timerOn(s, 'child');
        expect(targetOf(timer)).toBe('mine');

        expect(await s.recorder.writeStart(timer, targetRow(s))).toBe(true);
        await s.settle(FILE);
        // 付けたのはこのタイマーではない。閉じても外さない。
        expect(timer.owned).not.toContain('mine');
        expect(lines(contents)[0]).toBe('- [ ] 対象 @2026-09-21 ^mine');
        s.dispose();
    });
});

describe('a target that cannot be anchored: the timer does not start', () => {
    function stubWindow(): void {
        const store = new Map<string, string>();
        (globalThis as unknown as { window: unknown }).window = {
            setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
            addEventListener: () => { }, removeEventListener: () => { },
            localStorage: {
                getItem: (k: string) => store.get(k) ?? null,
                setItem: (k: string, v: string) => { store.set(k, v); },
                removeItem: (k: string) => { store.delete(k); },
            },
        };
    }

    it('a ^id another row carries too: no anchor, told so once, nothing written', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21 ^dup', '- [ ] 別 ^dup', ''].join('\n')]]);
        const before = contents.get(FILE);
        const s = vaultSession(contents);
        await s.scanAll();
        Notice.messages.length = 0;

        expect(s.recorder.startAnchor(targetRow(s))).toBeNull();
        expect(contents.get(FILE)).toBe(before);
        expect(Notice.messages).toEqual([en.notice.timerAnchorShared.replace('{{id}}', 'dup')]);
        s.dispose();
    });

    it('the start command on that row opens no timer', async () => {
        stubWindow();
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21 ^dup', '- [ ] 別 ^dup', ''].join('\n')]]);
        const before = contents.get(FILE);
        const s = vaultSession(contents);
        await s.scanAll();
        const widget = widgetOver(s);
        Notice.messages.length = 0;

        widget.startTimer(targetRow(s), 'child', { kind: 'countup' });
        await new Promise(r => setTimeout(r, 0));

        expect(widget.board.values()).toEqual([]);
        expect(contents.get(FILE)).toBe(before);
        expect(Notice.messages).toHaveLength(1);
        s.dispose();
    });

    it('a start write refused (the file changed since the reading): not started, nothing written', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', ''].join('\n')]]);
        const s = vaultSession(contents);
        const timer = await timerOn(s, 'self');
        const task = targetRow(s);
        const edited = ['- [ ] 上', '- [ ] 対象 @2026-09-21', ''].join('\n');
        contents.set(FILE, edited);

        expect(await s.recorder.writeStart(timer, task)).toBe(false);
        expect(contents.get(FILE)).toBe(edited);
        expect(timer.tail).toBeNull();
        expect(timer.owned).toEqual([]);
        expect(timer.opening).toBeNull();
        s.dispose();
    });
});

describe('the target is found by its anchor after a reload', () => {
    it('child: the running line gone, a line added above and a twin, reloaded: the record goes under the anchored target', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下', ''].join('\n')]]);
        const s = vaultSession(contents);
        const timer = await timerOn(s, 'child');
        expect(await s.recorder.writeStart(timer, targetRow(s))).toBe(true);
        await s.settle(FILE);
        const anchor = targetOf(timer)!;
        const saved = JSON.parse(JSON.stringify(timer)) as TimerState;
        s.dispose();

        // From outside: the running line deleted, a twin of the target and a line above.
        const kept = lines(contents).filter(line => !line.includes(`^${timer.tail}`));
        contents.set(FILE, ['- [ ] 上', '- [ ] 対象 @2026-09-21', ...kept, ''].join('\n'));

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 5_000);
        const next = vaultSession(contents);
        await next.scanAll();
        expect(await next.recorder.recordSessionEnd(saved, recordFor())).toBe(true);
        await next.settle(FILE);

        const after = lines(contents);
        const at = after.findIndex(line => line.endsWith(`^${anchor}`));
        expect(at).toBe(2);
        expect(after[at + 1]).toMatch(/^\s+- \[x\] /);
        expect(after[1]).toBe('- [ ] 対象 @2026-09-21');
        next.dispose();
    });

    it('self: the next running line leaves the target\'s anchor on it while the timer runs', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', ''].join('\n')]]);
        const s = vaultSession(contents);
        const timer = await timerOn(s, 'self');
        expect(await s.recorder.writeStart(timer, targetRow(s))).toBe(true);
        await s.settle(FILE);
        const anchor = targetOf(timer)!;

        expect(await s.recorder.startNextSession(timer)).toBe(true);
        await s.settle(FILE);
        expect(targetOf(timer)).toBe(anchor);
        expect(timer.owned).toContain(anchor);
        expect(lines(contents)[0]).toMatch(new RegExp(`\\^${anchor}$`));
        expect(timer.tail).not.toBe(anchor);
        s.dispose();
    });
});
