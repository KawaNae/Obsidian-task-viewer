import { describe, it, expect, vi } from 'vitest';
import type { TimerState } from '../../../src/timer/TimerState';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { timerOn } from '../helpers/timerRig';

/**
 * A timer's record is put in beside its row by the one insert every timer
 * line takes (`TaskIndex.insertLine`), on the row its anchor finds in the
 * note as the disk holds it (`Operations.freshByAnchor`), and checked as
 * every write that names a row is (`WriteSession.row`): against the reading
 * the row was found in. Not on the row's text alone.
 */

const FILE = 'notes/a.md';

async function childTimer(contents: Map<string, string>): Promise<{ s: VaultSession; timer: TimerState }> {
    const s = vaultSession(contents);
    await s.scanAll();
    const target = s.index.getTasks().find(task => task.content === '対象')!;
    const timer = timerOn(target, 'child', 'countup', s.recorder.startAnchor(target) ?? undefined);
    return { s, timer };
}

const record = () => ({ endMs: Date.now(), seconds: 600, then: 'close' as const });

describe('a record goes under the row its anchor finds as the disk holds it', () => {
    it('a copy of the row put on its line from outside, before the scan: its anchor finds no one row, nothing written', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21 ^box', '- [ ] 下 @2026-09-21', ''].join('\n')]]);
        const { s, timer } = await childTimer(contents);
        // An edit from outside the plugin: the scan has not read it yet.
        const edited = ['- [ ] 対象 @2026-09-21 ^box', '- [ ] 対象 @2026-09-21 ^box', '- [ ] 下 @2026-09-21', ''].join('\n');
        contents.set(FILE, edited);

        expect(await s.recorder.recordSessionEnd(timer, record())).toBe(false);
        expect(contents.get(FILE)).toBe(edited);
        s.dispose();
    });

    it('the row only indented from outside, before the scan: the record goes under it where it now is', async () => {
        const contents = new Map([[FILE, ['- [ ] 親', '- [ ] 対象 @2026-09-21 ^box', ''].join('\n')]]);
        const { s, timer } = await childTimer(contents);
        contents.set(FILE, ['- [ ] 親', '    - [ ] 対象 @2026-09-21 ^box', ''].join('\n'));

        expect(await s.recorder.recordSessionEnd(timer, record())).toBe(true);
        await s.settle(FILE);
        const lines = contents.get(FILE)!.split('\n');
        expect(lines[1]).toBe('    - [ ] 対象 @2026-09-21 ^box');
        expect(lines[2]).toMatch(/^\s{5,}- \[x\] ⏱️ 対象 /);
        s.dispose();
    });
});

describe('the next running line and the release of the last one are one write', () => {
    it('▶ writes the line beside the tail and takes the tail\'s ^id off in the same write', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下 @2026-09-21', ''].join('\n')]]);
        const { s, timer } = await childTimer(contents);
        const target = s.index.getTasks().find(task => task.content === '対象')!;
        expect(await s.recorder.writeStart(timer, target)).toBe(true);
        await s.settle(FILE);
        const first = timer.tail!;
        expect(contents.get(FILE)).toContain(`^${first}`);

        const process = vi.spyOn(s.app.vault, 'process');
        expect(await s.recorder.startNextSession(timer)).toBe(true);
        await s.settle(FILE);

        expect(process).toHaveBeenCalledTimes(1);
        const lines = contents.get(FILE)!.split('\n').filter(line => line.trim() !== '');
        expect(lines.some(line => line.includes(`^${first}`))).toBe(false);
        expect(timer.tail).not.toBe(first);
        expect(timer.owned).not.toContain(first);
        const next = lines.findIndex(line => line.includes(`^${timer.tail}`));
        // Beside the last line, under the target: the target, the last line, the new one.
        expect(lines[next - 1]).toMatch(/^\s+- \[ \] 対象 @\d{4}-\d\d-\d\dT\d\d:\d\d$/);
        expect(lines[next]).toMatch(/^\s+- \[ \] /);
        expect(lines).toHaveLength(4);
        s.dispose();
    });
});
