import { describe, it, expect, vi } from 'vitest';
import { getTimerElapsedSeconds, type TimerInstance } from '../../../src/timer/TimerInstance';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * A timer's record is put in beside its row by the one insert every timer
 * line takes (`TaskIndex.insertRecord`), planned from the index's copy of the
 * row and checked as every write that names a row is (`WriteSession.row`):
 * against the reading the copy was read in. Not on the row's text alone.
 */

const FILE = 'notes/a.md';

async function childTimer(contents: Map<string, string>): Promise<{ s: VaultSession; timer: TimerInstance }> {
    const s = vaultSession(contents);
    await s.scanAll();
    const target = s.index.getTasks().find(task => task.content === '対象')!;
    const timer = s.creator.createTimer({
        taskId: target.id, taskName: target.content, taskFile: target.file, taskOriginalText: target.originalText,
        timerTargetId: target.anchor, timerType: 'countup', recordMode: 'child', autoStart: true,
    });
    return { s, timer };
}

describe('a record is checked against the reading its row was read in', () => {
    it('a copy of the row put on its line from outside, before the scan: refused, nothing under the copy', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下 @2026-09-21', ''].join('\n')]]);
        const { s, timer } = await childTimer(contents);
        // An edit from outside the plugin: the scan has not read it yet.
        const edited = ['- [ ] 対象 @2026-09-21', '- [ ] 対象 @2026-09-21', '- [ ] 下 @2026-09-21', ''].join('\n');
        contents.set(FILE, edited);

        expect(await s.recorder.recordSessionEnd(timer, {
            endMs: Date.now(),
            seconds: getTimerElapsedSeconds(timer),
            then: 'close',
        })).toBe(false);
        expect(contents.get(FILE)).toBe(edited);
    });

    it('the row only indented from outside, before the scan: refused', async () => {
        const contents = new Map([[FILE, ['- [ ] 親', '- [ ] 対象 @2026-09-21', ''].join('\n')]]);
        const { s, timer } = await childTimer(contents);
        const edited = ['- [ ] 親', '    - [ ] 対象 @2026-09-21', ''].join('\n');
        contents.set(FILE, edited);

        expect(await s.recorder.recordSessionEnd(timer, {
            endMs: Date.now(),
            seconds: getTimerElapsedSeconds(timer),
            then: 'close',
        })).toBe(false);
        expect(contents.get(FILE)).toBe(edited);
    });
});

describe('the next session line and the release of the last one are one write', () => {
    it('▶ writes the line beside the tail and takes the tail\'s ^id off in the same write', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下 @2026-09-21', ''].join('\n')]]);
        const { s, timer } = await childTimer(contents);
        await s.recorder.createChildAtStart(timer);
        await s.settle(FILE);
        const first = timer.tailRecordBlockId!;
        expect(contents.get(FILE)).toContain(`^${first}`);

        const process = vi.spyOn(s.app.vault, 'process');
        expect(await s.recorder.startNextSession(timer)).toBe(true);
        await s.settle(FILE);

        expect(process).toHaveBeenCalledTimes(1);
        const lines = contents.get(FILE)!.split('\n').filter(line => line.trim() !== '');
        expect(lines.some(line => line.includes(`^${first}`))).toBe(false);
        const next = lines.findIndex(line => line.includes(`^${timer.tailRecordBlockId}`));
        expect(timer.tailRecordBlockId).not.toBe(first);
        // Beside the last line, under the target: the target, the last line, the new one.
        expect(lines[next - 1]).toMatch(/^\s+- \[ \] 対象 @\d{4}-\d\d-\d\dT\d\d:\d\d$/);
        expect(lines[next]).toMatch(/^\s+- \[ \] /);
        expect(lines).toHaveLength(4);
    });
});
