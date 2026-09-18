import { describe, it, expect, vi, afterEach } from 'vitest';
import type { TimerInstance, TimerRecordMode } from '../../../src/timer/TimerInstance';
import { makeFile, vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * Stopping a timer after a reload writes into the session line it started.
 *
 * Runtime task IDs live for one session. A timer persists the ID of its
 * session line (`recordedChildTaskId`), so after a reload that ID names nothing
 * — and the stop path used to look it up directly, miss, announce "child task
 * not found" and write a second record, leaving the placeholder `[ ]` behind.
 * Worse, with a counter restarting at 1 the stale ID could name a *different*
 * task in the new session, and the stop overwrote that task's line. Two fixes
 * are pinned: runtime IDs are seeded from the clock so a previous session's ID
 * names nothing, and the stop resolves its line by the session line's own `^id`
 * (`tailRecordBlockId`), which survives the reload because it is in the file.
 *
 * Each "session" here is a fresh TaskIndex over the same file contents, so the
 * reload gets a new ledger and new `seq:` numbers, exactly like the plugin.
 */

const FILE = 'notes/a.md';

function session(contents: Map<string, string>): VaultSession {
    return vaultSession(contents);
}

function lines(contents: Map<string, string>): string[] {
    return contents.get(FILE)!.split('\n').filter(line => line.trim() !== '');
}

async function startTimer(
    first: VaultSession,
    recordMode: TimerRecordMode
): Promise<TimerInstance> {
    await first.scanAll();
    const target = first.index.getTasks().find(task => task.content === '対象')!;

    const timer = first.creator.createTimer({
        taskId: target.id,
        taskName: target.content,
        taskFile: target.file,
        taskOriginalText: target.originalText,
        timerType: 'countup',
        recordMode,
        autoStart: true,
    });
    const sessionId = recordMode === 'child'
        ? await first.recorder.createChildAtStart(timer)
        : await first.recorder.startContinuationSession(timer);
    await first.settle(FILE);
    expect(sessionId).toBeDefined();
    expect(timer.tailRecordBlockId).toBeDefined();
    return timer;
}

async function startInFirstSession(contents: Map<string, string>, recordMode: TimerRecordMode): Promise<TimerInstance> {
    return startTimer(session(contents), recordMode);
}

/** What survives the reload: the persisted fields, nothing live. */
function persisted(timer: TimerInstance): TimerInstance {
    return JSON.parse(JSON.stringify(timer)) as TimerInstance;
}

afterEach(() => {
    vi.useRealTimers();
});

/** A reload happens later on the clock; runtime IDs are seeded from it. */
function laterSession(contents: Map<string, string>) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 5_000);
    return session(contents);
}

describe('stopping a timer after a reload', () => {
    it.each<[TimerRecordMode, RegExp]>([
        ['child', /^\s+- \[ \] /],
        ['sibling', /^- \[ \] /],
    ])('%s mode: completes the placeholder instead of adding a second record', async (mode, placeholderShape) => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n')]]);
        const timer = await startInFirstSession(contents, mode);

        const before = lines(contents);
        const placeholder = before.find(line => line.includes(`^${timer.tailRecordBlockId}`))!;
        expect(placeholder).toMatch(placeholderShape);
        const staleId = timer.recordedChildTaskId;

        // Reload: a new index, a new ledger, new seq numbers.
        const second = laterSession(contents);
        await second.scanAll();
        const restored = persisted(timer);
        // A previous session's ID names nothing — never a different task.
        expect(second.index.getTask(staleId!)).toBeUndefined();
        expect(second.index.getTask(restored.taskId)).toBeUndefined();

        restored.startTimeMs = Date.now() - 60_000;
        await second.recorder.recordSessionEnd(restored);
        await second.settle(FILE);

        const after = lines(contents);
        expect(after).toHaveLength(before.length);
        const record = after.find(line => line.includes(`^${timer.tailRecordBlockId}`))!;
        expect(record).toMatch(/- \[x\] /);
        expect(restored.recordedChildTaskId).not.toBe(staleId);
    });

    // The tail anchor is looked up within `timer.taskFile`, which the widget's
    // rename handler rewrites. That alone finds the record after a rename — the
    // rewrite of `recordedChildTaskId` is not what carries it.
    it('finds the record after a rename even when recordedChildTaskId still names the old path', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n')]]);
        const live = session(contents);
        await live.initialize();
        await live.scanAll();
        const timer = await startTimer(live, 'child');
        const staleId = timer.recordedChildTaskId!;

        const renamed = 'notes/renamed.md';
        contents.set(renamed, contents.get(FILE)!);
        contents.delete(FILE);
        await live.fireVault('rename', makeFile(renamed), FILE);
        timer.taskFile = renamed;          // what TimerWidget.handleFileRename does
        timer.taskId = timer.taskId.replace(FILE, renamed);
        expect(timer.recordedChildTaskId).toBe(staleId);

        await live.recorder.recordSessionEnd(timer);
        await live.index.waitForScan(renamed);

        const after = contents.get(renamed)!.split('\n').filter(line => line.trim() !== '');
        expect(after).toHaveLength(3);
        expect(after.find(line => line.includes(`^${timer.tailRecordBlockId}`))).toMatch(/- \[x\] /);
    });
});
