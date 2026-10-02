import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PendingRecord, RecordMode, TimerState } from '../../../src/timer/TimerState';
import { makeFile, vaultSession, type VaultSession } from '../helpers/vaultSession';
import { timerOn } from '../helpers/timerRig';

/** 止めた時点で固定する記録: 1 分。 */
function recordFor(): PendingRecord {
    return { endMs: Date.now(), seconds: 60, then: 'close' };
}

/**
 * Stopping a timer after a reload writes into the running line it started.
 *
 * A timer keeps no task id: a runtime id lives for one reading, and after a
 * reload it names nothing, or a different row. The stop finds its line by
 * the line's own `^id` (`tail`), which survives the reload because it is in
 * the file, and closes it: no second record, no placeholder left `[ ]`.
 *
 * Each "session" here is a fresh TaskIndex over the same file contents, so
 * the reload gets a new ledger and new `seq:` numbers, exactly like the plugin.
 */

const FILE = 'notes/a.md';

function lines(contents: Map<string, string>): string[] {
    return contents.get(FILE)!.split('\n').filter(line => line.trim() !== '');
}

async function startTimer(first: VaultSession, mode: RecordMode): Promise<TimerState> {
    await first.scanAll();
    const target = first.index.getTasks().find(task => task.content === '対象')!;
    const timer = timerOn(target, mode, 'countup', first.recorder.startAnchor(target) ?? undefined);
    expect(await first.recorder.writeStart(timer, target)).toBe(true);
    await first.settle(FILE);
    expect(timer.tail).not.toBeNull();
    return timer;
}

/** What survives the reload: the saved fields. */
function persisted(timer: TimerState): TimerState {
    return JSON.parse(JSON.stringify(timer)) as TimerState;
}

afterEach(() => {
    vi.useRealTimers();
});

/** A reload happens later on the clock. */
function laterSession(contents: Map<string, string>) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 5_000);
    return vaultSession(contents);
}

describe('stopping a timer after a reload', () => {
    it.each<[RecordMode, RegExp]>([
        ['child', /^\s+- \[ \] /],
        ['sibling', /^- \[ \] /],
    ])('%s: closes the running line instead of adding a second record', async (mode, runningShape) => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n')]]);
        const timer = await startTimer(vaultSession(contents), mode);

        const before = lines(contents);
        const running = before.find(line => line.includes(`^${timer.tail}`))!;
        expect(running).toMatch(runningShape);

        // Reload: a new index, a new session of readings.
        const second = laterSession(contents);
        await second.scanAll();
        const restored = persisted(timer);

        expect(await second.recorder.recordSessionEnd(restored, recordFor())).toBe(true);
        await second.settle(FILE);

        const after = lines(contents);
        expect(after).toHaveLength(before.length);
        const record = after.find(line => line.includes(`^${timer.tail}`))!;
        expect(record).toMatch(/- \[x\] /);
        second.dispose();
    });

    // The tail anchor is looked up within `timer.file`, which the widget's
    // rename handler rewrites (`followed`). That alone finds the record after
    // a rename.
    it('finds the record after a rename', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n')]]);
        const live = vaultSession(contents);
        const timer = await startTimer(live, 'child');

        const renamed = 'notes/renamed.md';
        contents.set(renamed, contents.get(FILE)!);
        contents.delete(FILE);
        await live.fireVault('rename', makeFile(renamed), FILE);
        live.board.dispatch(timer, { type: 'followed', file: renamed });   // what TimerWidget.handleFileRename does

        expect(await live.recorder.recordSessionEnd(timer, recordFor())).toBe(true);
        await live.scanner.waitForScan(renamed);

        const after = contents.get(renamed)!.split('\n').filter(line => line.trim() !== '');
        expect(after).toHaveLength(3);
        expect(after.find(line => line.includes(`^${timer.tail}`))).toMatch(/- \[x\] /);
        live.dispose();
    });
});
