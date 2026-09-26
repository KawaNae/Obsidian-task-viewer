import { describe, it, expect, afterEach, vi } from 'vitest';
import { getTimerElapsedSeconds, type PendingRecord, type TimerInstance, type TimerRecordMode } from '../../../src/timer/TimerInstance';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * A timer whose target moves within its note (F8). A timer that closes with
 * ■ takes its own anchor off in the write that records it, so the move in
 * that write carries a row without it. A timer that stays open while its
 * target moves — self's ⏸ completes the target, and a child's or sibling's
 * target can be completed by hand while it runs — keeps finding the target
 * and its tail by their anchors, which the move carries.
 */

const FILE = 'notes/a.md';

afterEach(() => vi.useRealTimers());

function lines(contents: Map<string, string>): string[] {
    return contents.get(FILE)!.split('\n');
}

function recordFor(timer: TimerInstance, then: PendingRecord['then']): PendingRecord {
    return { endMs: Date.now(), seconds: getTimerElapsedSeconds(timer), then };
}

async function started(contents: Map<string, string>, mode: TimerRecordMode): Promise<{ s: VaultSession; timer: TimerInstance }> {
    const s = vaultSession(contents);
    await s.scanAll();
    const target = s.index.getTasks().find(task => task.content === '対象')!;
    const timer = s.creator.createTimer({
        taskId: target.id, taskName: target.content, taskFile: target.file, taskOriginalText: target.originalText,
        timerTargetId: target.anchor, timerType: 'countup', recordMode: mode, autoStart: true,
    });
    s.onOpenTimers(() => [timer]);
    expect(await s.recorder.writeStart(timer)).toBe(true);
    await s.settle(FILE);
    return { s, timer };
}

const NOTE = ['# note', '- [ ] 対象 @2026-09-21 ==> move([[#Done]])', '    - [ ] 子', '## Done', ''];

describe('self, closed with ■, on a target that moves', () => {
    it('takes its anchor off in the record\'s write, before the move carries the row', async () => {
        const contents = new Map([[FILE, NOTE.join('\n')]]);
        const { s, timer } = await started(contents, 'self');
        const anchor = timer.timerTargetId!;
        expect(lines(contents)[1]).toContain(`^${anchor}`);

        const process = vi.spyOn(s.app.vault, 'process');
        expect(await s.recorder.recordSessionEnd(timer, recordFor(timer, 'close'))).toBe(true);
        await s.settle(FILE);

        expect(process).toHaveBeenCalledTimes(1);
        const after = lines(contents);
        expect(after.slice(0, 2)).toEqual(['# note', '## Done']);
        expect(after[2]).toMatch(/^- \[x\] ⏱️ ?対象 /);
        expect(after[3]).toBe('    - [ ] 子');
        expect(contents.get(FILE)).not.toContain('^tv-t-');
        s.dispose();
    });

    it('keeps the anchor of a row the user anchored', async () => {
        const contents = new Map([[FILE, NOTE.map(line => line.replace('move([[#Done]])', 'move([[#Done]]) ^mine')).join('\n')]]);
        const { s, timer } = await started(contents, 'self');
        expect(timer.timerTargetId).toBe('mine');

        expect(await s.recorder.recordSessionEnd(timer, recordFor(timer, 'close'))).toBe(true);
        await s.settle(FILE);

        expect(lines(contents)[2]).toMatch(/ \^mine$/);
        s.dispose();
    });
});

describe('a timer that stays open while its target moves', () => {
    it('self, after ⏸: the completed target moved with its anchor, and the timer still finds it, across a reload', async () => {
        const contents = new Map([[FILE, NOTE.join('\n')]]);
        const { s, timer } = await started(contents, 'self');
        const anchor = timer.timerTargetId!;

        expect(await s.recorder.recordSessionEnd(timer, recordFor(timer, 'suspend'))).toBe(true);
        await s.settle(FILE);

        const after = lines(contents);
        expect(after[1]).toBe('## Done');
        expect(after[2]).toMatch(new RegExp(`^- \\[x\\] .*対象 .*\\^${anchor}$`));
        expect(s.recorder.resolveTarget(timer)?.line).toBe(2);
        expect(s.recorder.resolveTailRecord(timer)?.line).toBe(2);
        s.dispose();

        const reloaded = vaultSession(contents);
        await reloaded.scanAll();
        expect(reloaded.recorder.resolveTarget(timer)?.content).toMatch(/対象/);
        reloaded.dispose();
    });

    it.each<TimerRecordMode>(['child', 'sibling'])('%s: its target completed by hand moves with its anchor, and the timer finds target and tail', async (mode) => {
        const start = mode === 'sibling'
            ? ['# note', '- [ ] 親 @2026-09-21 ==> move([[#Done]])', '    - [x] 対象 @2026-09-21', '## Done', '']
            : NOTE;
        const contents = new Map([[FILE, start.join('\n')]]);
        const { s, timer } = await started(contents, mode);
        const moving = mode === 'sibling' ? '親' : '対象';

        const row = s.index.getTasks().find(task => task.content === moving)!;
        expect(await s.index.updateTask(row.id, { statusChar: 'x' })).toBe(true);
        await s.settle(FILE);

        expect(lines(contents)[1]).toBe('## Done');
        const target = s.recorder.resolveTarget(timer);
        const tail = s.recorder.resolveTailRecord(timer);
        expect(target?.content).toBe('対象');
        expect(target!.line).toBeGreaterThan(1);
        expect(tail?.line).toBeGreaterThan(1);
        s.dispose();
    });
});
