import { describe, it, expect, vi, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import type { TaskScanner } from '../../../src/services/core/TaskScanner';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { TimerInstance, TimerRecordMode } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import { DEFAULT_SETTINGS } from '../../../src/types';

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

function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() ?? path;
    file.basename = file.name.replace(/\.md$/, '');
    file.extension = 'md';
    return file;
}

/** One plugin session over a shared vault. */
function session(contents: Map<string, string>) {
    let scanner: TaskScanner | undefined;
    const noop = { on: () => ({}), offref: () => { } };
    const vaultHandlers = new Map<string, (...args: unknown[]) => unknown>();
    const app = {
        vault: {
            on: (name: string, fn: (...args: unknown[]) => unknown) => { vaultHandlers.set(name, fn); return {}; },
            offref: () => { },
            read: async (file: TFile) => contents.get(file.path) ?? '',
            process: async (file: TFile, fn: (data: string) => string) => {
                const next = fn(contents.get(file.path) ?? '');
                contents.set(file.path, next);
                // What metadataCache.changed would trigger in Obsidian.
                void scanner!.requestScan(file);
                return next;
            },
            getAbstractFileByPath: (path: string) => (contents.has(path) ? makeFile(path) : null),
            getMarkdownFiles: () => [...contents.keys()].map(makeFile),
        },
        metadataCache: { ...noop, getCache: () => null },
        workspace: { ...noop, onLayoutReady: () => { }, activeLeaf: null },
    };

    const index = new TaskIndex(app as never, { ...DEFAULT_SETTINGS });
    scanner = (index as unknown as { scanner: TaskScanner }).scanner;
    scanner.setInitializing(false);

    let n = 0;
    const storageUtils = {
        generateTimerTargetId: () => `tv-t-test${++n}`,
        isAutoManagedTimerTargetId: () => true,
    } as unknown as TimerStorageUtils;
    const plugin = {
        settings: { ...DEFAULT_SETTINGS },
        getTaskIndex: () => index,
        getTaskWriteService: () => new TaskWriteService(index),
    };
    const recorder = new TimerRecorder(app as never, plugin as never, storageUtils);
    const creator = new TimerCreator({} as TimerContext, storageUtils);

    return {
        index,
        initialize: () => index.initialize(),
        fireVault: (name: string, ...args: unknown[]) => vaultHandlers.get(name)!(...args),
        recorder,
        creator,
        scanAll: () => scanner!.scanVault(),
        settle: () => index.waitForScan(FILE),
    };
}

function lines(contents: Map<string, string>): string[] {
    return contents.get(FILE)!.split('\n').filter(line => line.trim() !== '');
}

async function startTimer(
    first: ReturnType<typeof session>,
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
    await first.settle();
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
        await second.settle();

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
