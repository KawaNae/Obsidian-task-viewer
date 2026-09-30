import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clearLog, getLogEntries } from '../../../../src/log/log';
import type { DiskProbe, DiskStat } from '../../../../src/services/core/DiskProbe';
import { INTERVAL_MS, LASTING_MS, QUIET_MS } from '../../../../src/services/core/DiskReconciler';
import { vaultSession, type VaultSession } from '../../helpers/vaultSession';

/**
 * The reconciler brings the index's readings to the disk when a change
 * notice never comes (`DiskReconciler`, structure/layers.md の読みの鮮度). The disk
 * here is `contents` and a stand-in probe: setting `contents` is an edit no
 * event reports, and the probe's stat says the file moved. `TFile.stat` in
 * the harness is 0/0 for every note, as Obsidian's model of a note it never
 * heard change.
 */

const FILE = 'note.md';
const OTHER = 'other.md';

/** A probe over `contents`: `moved` gives a note a new stat, `gone` takes it off the disk. */
function probeOver(contents: Map<string, string>, options: { whole?: boolean } = {}) {
    const moved = new Map<string, DiskStat>();
    const gone = new Set<string>();
    const asked: string[][] = [];
    let hold: Promise<void> | null = null;
    const probe: DiskProbe = {
        batch: 256,
        wholeVault: options.whole !== false,
        stat: async (paths) => {
            asked.push([...paths]);
            if (hold) await hold;
            const onDisk = (path: string) => !gone.has(path) && contents.has(path);
            return new Map(paths.map(path => [path, onDisk(path) ? moved.get(path) ?? { mtime: 0, size: 0 } : null]));
        },
    };
    return {
        probe, moved, gone, asked,
        /** Keep every `stat` waiting until the returned release is called. */
        holdStats: () => { let release!: () => void; hold = new Promise(r => { release = r; }); return () => { hold = null; release(); }; },
    };
}

const lines = (entries = getLogEntries()) => entries.map(entry => entry.message);
const summaries = () => lines().filter(line => line.startsWith('[Reconcile] '));

async function swept(count: number): Promise<void> {
    await vi.waitFor(() => expect(summaries().length).toBeGreaterThanOrEqual(count));
}

let session: VaultSession | undefined;
beforeEach(() => clearLog());
afterEach(() => { session?.dispose(); session = undefined; vi.restoreAllMocks(); vi.useRealTimers(); });

/** Let the clock the reconciler reads run on by `ms`, the timers left real. */
function later(ms: number): void {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + ms });
}

async function open(files: Record<string, string>, options: { whole?: boolean } = {}) {
    const contents = new Map(Object.entries(files));
    const disk = probeOver(contents, options);
    session = vaultSession(contents, { probe: disk.probe });
    await session.scanAll();
    let notified = 0;
    session.index.onChange(() => { notified++; });
    return { contents, disk, s: session, notified: () => notified };
}

const contentsOf = (s: VaultSession, path = FILE) => s.index.getTasks().filter(t => t.file === path).map(t => t.content).sort();

describe('a sweep', () => {
    it('reads again a note the disk says moved, commits it, tells the views once, and counts Obsidian\'s stale stat', async () => {
        const { contents, disk, s, notified } = await open({ [FILE]: '- [ ] A\n', [OTHER]: '- [ ] O\n' });
        contents.set(FILE, '- [ ] A\n- [ ] B\n');
        disk.moved.set(FILE, { mtime: 5, size: 16 });

        s.reconciler!.start();
        await swept(1);
        await vi.waitFor(() => expect(notified()).toBe(1));

        expect(contentsOf(s)).toEqual(['A', 'B']);
        expect(summaries()[0]).toMatch(/^\[Reconcile\] trigger=start scope=2 stat=\d+ms reread=1 committed=1 dropped=0 obsidian:modified=1 deleted=0$/);
        // Found for a moment, it may be a notice still on its way; lasting, it is told.
        expect(lines().some(line => line.startsWith('[Reconcile:diverge]'))).toBe(false);
        later(LASTING_MS);
        s.reconciler!.request('refusal');
        await swept(2);
        expect(lines()).toContain(`[Reconcile:diverge] kind=modified path=${FILE} disk=5/16 obsidian=0/0`);
    });

    it('tells a divergence that lasts once, and sums up at debug while it only lasts', async () => {
        const { contents, disk, s } = await open({ [FILE]: '- [ ] A\n', [OTHER]: '- [ ] O\n' });
        contents.set(FILE, '- [ ] A\n- [ ] B\n');
        disk.moved.set(FILE, { mtime: 5, size: 16 });
        s.reconciler!.start();
        await swept(1);

        later(LASTING_MS);
        s.reconciler!.request('refusal');
        await swept(2);
        s.reconciler!.request('refusal');
        await swept(3);

        const sums = getLogEntries().filter(entry => entry.message.startsWith('[Reconcile] '));
        expect(sums.map(entry => entry.level)).toEqual(['info', 'info', 'debug']);
        expect(sums[2].message).toContain('obsidian:modified=1');
        expect(lines().filter(line => line.startsWith('[Reconcile:diverge]'))).toHaveLength(1);
    });

    it('does not tell a divergence gone by the next sweep: a notice that was on its way', async () => {
        const { contents, disk, s } = await open({ [FILE]: '- [ ] A\n', [OTHER]: '- [ ] O\n' });
        contents.set(FILE, '- [ ] A\n- [ ] B\n');
        disk.moved.set(FILE, { mtime: 5, size: 16 });
        s.reconciler!.start();
        await swept(1);

        // Obsidian's model catches up: the disk agrees with TFile.stat again.
        disk.moved.delete(FILE);
        s.reconciler!.request('refusal');
        await swept(2);

        expect(lines().some(line => line.startsWith('[Reconcile:diverge]'))).toBe(false);
        expect(getLogEntries().filter(entry => entry.message.startsWith('[Reconcile] ')).map(entry => entry.level)).toEqual(['info', 'debug']);
    });

    it('does not tell a divergence two sweeps find a moment apart: it is told by how long it lasted, not by how many sweeps found it', async () => {
        const { contents, disk, s } = await open({ [FILE]: '- [ ] A\n', [OTHER]: '- [ ] O\n' });
        contents.set(FILE, '- [ ] A\n- [ ] B\n');
        disk.moved.set(FILE, { mtime: 5, size: 16 });
        s.reconciler!.start();
        await swept(1);

        // A refusal's sweep does not wait for the quiet time.
        s.reconciler!.request('refusal');
        await swept(2);
        later(LASTING_MS - 1000);
        s.reconciler!.request('refusal');
        await swept(3);
        expect(lines().some(line => line.startsWith('[Reconcile:diverge]'))).toBe(false);

        later(LASTING_MS);
        s.reconciler!.request('refusal');
        await swept(4);
        expect(lines().filter(line => line.startsWith('[Reconcile:diverge]'))).toHaveLength(1);
    });

    it('tells a lasting divergence at the next interval sweep, though its timer fires a little early', async () => {
        const { contents, disk, s } = await open({ [FILE]: '- [ ] A\n', [OTHER]: '- [ ] O\n' });
        contents.set(FILE, '- [ ] A\n- [ ] B\n');
        disk.moved.set(FILE, { mtime: 5, size: 16 });
        s.reconciler!.start();
        await swept(1);

        later(INTERVAL_MS - 5);
        s.reconciler!.request('refusal');
        await swept(2);
        expect(lines().filter(line => line.startsWith('[Reconcile:diverge]'))).toHaveLength(1);
    });

    it('starts the time over for a divergence a sweep did not find', async () => {
        const { contents, disk, s } = await open({ [FILE]: '- [ ] A\n', [OTHER]: '- [ ] O\n' });
        contents.set(FILE, '- [ ] A\n- [ ] B\n');
        disk.moved.set(FILE, { mtime: 5, size: 16 });
        s.reconciler!.start();
        await swept(1);

        disk.moved.delete(FILE);
        later(LASTING_MS / 2);
        s.reconciler!.request('refusal');
        await swept(2);
        disk.moved.set(FILE, { mtime: 5, size: 16 });
        later(LASTING_MS);
        s.reconciler!.request('refusal');
        await swept(3);

        expect(lines().some(line => line.startsWith('[Reconcile:diverge]'))).toBe(false);
    });

    it('takes a note gone from the disk out of the index, and counts it deleted', async () => {
        const { disk, s } = await open({ [FILE]: '- [ ] A\n', [OTHER]: '- [ ] O\n' });
        disk.gone.add(FILE);

        s.reconciler!.start();
        await swept(1);

        expect(contentsOf(s)).toEqual([]);
        expect(contentsOf(s, OTHER)).toEqual(['O']);
        expect(summaries()[0]).toContain('dropped=1 obsidian:modified=0 deleted=1');
        later(LASTING_MS);
        s.reconciler!.request('refusal');
        await swept(2);
        expect(summaries()[1]).toContain('dropped=0 obsidian:modified=0 deleted=1');
        expect(lines()).toContain(`[Reconcile:diverge] kind=deleted path=${FILE} obsidian=0/0`);
    });

    it('reads nothing the second time when nothing moved', async () => {
        const { s } = await open({ [FILE]: '- [ ] A\n', [OTHER]: '- [ ] O\n' });
        s.reconciler!.start();
        await swept(1);
        const queueScan = vi.spyOn(s.scanner, 'queueScan');

        s.reconciler!.request('refusal');
        await swept(2);

        expect(queueScan).not.toHaveBeenCalled();
    });

    it('reads a note once after a write of ours moved its reading on, and commits nothing', async () => {
        const { disk, s } = await open({ [FILE]: '- [ ] A\n' });
        s.reconciler!.start();
        await swept(1);
        const id = s.index.getTasks()[0].id;
        expect(await s.index.updateTask(id, { statusChar: 'x' })).toBe(true);
        disk.moved.set(FILE, { mtime: 7, size: 8 });
        const queueScan = vi.spyOn(s.scanner, 'queueScan');

        s.reconciler!.request('refusal');
        await swept(2);
        expect(queueScan).toHaveBeenCalledTimes(1);
        expect(summaries()[1]).toContain('reread=1 committed=0');

        s.reconciler!.request('refusal');
        await swept(3);
        expect(queueScan).toHaveBeenCalledTimes(1);
    });

    it('holds back the reading of the note being dragged, which goes in when the drag ends', async () => {
        const { contents, disk, s } = await open({ [FILE]: '- [ ] A\n' });
        s.index.setDraggingFile(FILE);
        contents.set(FILE, '- [ ] A\n- [ ] B\n');
        disk.moved.set(FILE, { mtime: 5, size: 16 });

        s.reconciler!.start();
        await swept(1);
        expect(summaries()[0]).toContain('reread=1 committed=0');
        expect(contentsOf(s)).toEqual(['A']);

        s.index.setDraggingFile(null);
        await vi.waitFor(() => expect(contentsOf(s)).toEqual(['A', 'B']));
    });

    it('reads a note again that comes back after it was taken out, even with the stat it had', async () => {
        const { disk, s } = await open({ [FILE]: '- [ ] A\n', [OTHER]: '- [ ] O\n' });
        disk.gone.add(FILE);
        s.reconciler!.start();
        await swept(1);
        expect(contentsOf(s)).toEqual([]);

        disk.gone.delete(FILE);
        s.reconciler!.request('refusal');
        await swept(2);

        expect(summaries()[1]).toContain('reread=1 committed=1');
        expect(contentsOf(s)).toEqual(['A']);
    });

    it('disposed in the middle of a sweep, mends nothing and sums nothing up', async () => {
        const { contents, disk, s } = await open({ [FILE]: '- [ ] A\n', [OTHER]: '- [ ] O\n' });
        contents.set(FILE, '- [ ] A\n- [ ] B\n');
        disk.moved.set(FILE, { mtime: 5, size: 16 });
        disk.gone.add(OTHER);
        const release = disk.holdStats();
        const queueScan = vi.spyOn(s.scanner, 'queueScan');
        s.reconciler!.start();
        await vi.waitFor(() => expect(disk.asked).toHaveLength(1));

        s.reconciler!.dispose();
        release();
        await new Promise(r => setTimeout(r, 20));

        expect(queueScan).not.toHaveBeenCalled();
        expect(contentsOf(s)).toEqual(['A']);
        expect(contentsOf(s, OTHER)).toEqual(['O']);
        expect(summaries()).toEqual([]);
    });

    it('off the desktop app, asks only of the notes the index read', async () => {
        // `bare.md` holds no list item: the vault's scan passes it by, so the index never read it.
        const { disk, s } = await open({ [FILE]: '- [ ] A\n', 'bare.md': 'text\n' }, { whole: false });

        s.reconciler!.start();
        await swept(1);

        expect(disk.asked).toEqual([[FILE]]);
        expect(summaries()[0]).toMatch(/scope=1 stat=\d+ms reread=0/);
    });
});

describe('what asks for a sweep besides the triggers it hears', () => {
    it('a write refused as `changed` has its note read again, whatever the stat says', async () => {
        const { contents, s } = await open({ [FILE]: '- [ ] A\n' });
        s.reconciler!.start();
        await swept(1);
        // An edit the stat does not show (the same mtime and size).
        contents.set(FILE, '- [ ] B\n');

        s.reportRefusal({ file: FILE, reason: { kind: 'changed' }, subject: 'A' });
        await swept(2);

        expect(summaries()[1]).toContain('trigger=refusal');
        expect(summaries()[1]).toContain('reread=1 committed=1');
        expect(contentsOf(s)).toEqual(['B']);
    });

    it('a check that finds a reading stale asks for a sweep of the vault', async () => {
        const { contents, disk, s } = await open({ [FILE]: '- [ ] A\n', [OTHER]: '- [ ] O\n' });
        s.reconciler!.start();
        await swept(1);
        contents.set(FILE, '- [ ] A 変更\n');
        contents.set(OTHER, '- [ ] O 変更\n');
        disk.moved.set(OTHER, { mtime: 9, size: 14 });

        const queueScan = vi.spyOn(s.scanner, 'queueScan');

        expect(await s.index.confirmTask(s.index.getTasks().find(t => t.file === FILE)!.id)).toBe(false);
        await swept(2);

        expect(summaries()[1]).toContain('trigger=stale');
        expect(contentsOf(s, OTHER)).toEqual(['O 変更']);
        // The stale note was read by the check; the sweep does not name it to read it again.
        expect(queueScan.mock.calls.filter(([file]) => file.path === FILE)).toHaveLength(1);
    });
});

describe('when sweeps run', () => {
    it('runs one sweep at a time, and the triggers during one ask for one more', async () => {
        const { disk, s } = await open({ [FILE]: '- [ ] A\n' });
        const release = disk.holdStats();
        s.reconciler!.start();
        await vi.waitFor(() => expect(disk.asked).toHaveLength(1));

        s.reconciler!.request('refusal');
        s.reconciler!.request('stale', FILE);
        s.reconciler!.request('refusal');
        release();
        await swept(2);
        await new Promise(r => setTimeout(r, 20));

        expect(disk.asked).toHaveLength(2);
        expect(summaries()[1]).toContain('trigger=refusal');
    });

    it('a focus within the quiet time after a sweep waits it out; a refusal does not wait', async () => {
        const { disk, s } = await open({ [FILE]: '- [ ] A\n' });
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        try {
            s.reconciler!.start();
            await vi.waitFor(() => expect(summaries()).toHaveLength(1));

            s.reconciler!.request('focus');
            await Promise.resolve();
            expect(disk.asked).toHaveLength(1);

            await vi.advanceTimersByTimeAsync(QUIET_MS);
            await vi.waitFor(() => expect(summaries()).toHaveLength(2));
            expect(summaries()[1]).toContain('trigger=focus');

            // Right after that sweep started, a refusal sweeps at once.
            s.reconciler!.request('refusal');
            await vi.waitFor(() => expect(summaries()).toHaveLength(3));
            expect(summaries()[2]).toContain('trigger=refusal');
        } finally {
            vi.useRealTimers();
        }
    });

    it('hears the window come back, and sweeps each minute while the window shows; after dispose, nothing', async () => {
        const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
        const win = Object.assign(new EventTarget(), { document: doc });
        vi.stubGlobal('window', win);
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
        try {
            const { disk, s } = await open({ [FILE]: '- [ ] A\n' });
            s.reconciler!.start();
            await vi.waitFor(() => expect(summaries()).toHaveLength(1));

            await vi.advanceTimersByTimeAsync(QUIET_MS);
            win.dispatchEvent(new Event('focus'));
            await vi.waitFor(() => expect(summaries()).toHaveLength(2));
            expect(summaries()[1]).toContain('trigger=focus');

            await vi.advanceTimersByTimeAsync(INTERVAL_MS);
            await vi.waitFor(() => expect(summaries()).toHaveLength(3));
            expect(summaries()[2]).toContain('trigger=interval');

            // Hidden: the minute passes without a sweep.
            doc.visibilityState = 'hidden';
            await vi.advanceTimersByTimeAsync(INTERVAL_MS);
            expect(disk.asked).toHaveLength(3);

            s.dispose();
            doc.visibilityState = 'visible';
            win.dispatchEvent(new Event('focus'));
            s.reconciler!.request('refusal');
            await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
            expect(disk.asked).toHaveLength(3);
        } finally {
            vi.useRealTimers();
            vi.unstubAllGlobals();
        }
    });
});
