import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { vaultSession, makeFile } from './vaultSession';

/**
 * A flow's own writes do not fire again (structure.md, 「自己書き込みの判定と
 * 発火の可否」). Before F6 the only thing that stopped them was a flag no flow
 * write set, so each scan after the completing write ran with `isLocal`
 * false. Now each completed row answers by whom the write that made it was
 * for: the user's check fires, the flow's own writes do not. These count the
 * firings through the index's own flow executor.
 */
function countFires(session: ReturnType<typeof vaultSession>): { count: number } {
    const counter = { count: 0 };
    const executor = (session.index as unknown as {
        commandExecutor: { handleTaskCompletion: (task: unknown) => Promise<void> };
    }).commandExecutor;
    const original = executor.handleTaskCompletion.bind(executor);
    executor.handleTaskCompletion = (task: unknown) => { counter.count++; return original(task); };
    return counter;
}

describe("vaultSession: a flow's own writes", () => {
    const FILE = 'flow.md';
    const flowNote = () => new Map([[FILE, ['- [ ] 週報 @2026-09-21 ==> every mon', ''].join('\n')]]);

    it('fire nothing: the completing write fires once, and the scans of the flow\'s writes fire nothing', async () => {
        const contents = flowNote();
        const session = vaultSession(contents);
        await session.scanAll();
        const weekly = session.index.getTasks().find(t => t.content === '週報')!;

        const fires = countFires(session);
        await session.index.updateTask(weekly.id, { statusChar: 'x' });
        // Length 2 lands after create-next; the strip that follows rewrites
        // the second line without changing the count, so wait for the exact
        // final text rather than just the line count.
        await vi.waitFor(() => {
            expect(contents.get(FILE)!.split('\n').filter(l => l.trim())).toEqual([
                '- [ ] 週報 @2026-09-28 ==> every mon',
                '- [x] 週報 @2026-09-21',
            ]);
        });
        await session.settle(FILE);

        expect(fires.count).toBe(1);
    });

    it('does not refire from the metadataCache "changed" scan either: it reads what the last scan read, and commits nothing', async () => {
        // `changed` follows every write. Before F6 a 1000ms window keyed by
        // path (selfWrites) swallowed it after a local write, whichever write
        // set the mark; the window is waited out here to show that the answer
        // no longer depends on it. The scan it asks for reads the content the
        // flow's last write left, which the last scan already read.
        const contents = flowNote();
        const session = vaultSession(contents);
        await session.scanAll();
        const weekly = session.index.getTasks().find(t => t.content === '週報')!;

        vi.useFakeTimers();
        try {
            await session.index.updateTask(weekly.id, { statusChar: 'x' });
            await vi.advanceTimersByTimeAsync(1500);
            const settled = contents.get(FILE);

            const scanner = session.scanner as unknown as { rescanUnlessRead: (f: TFile) => Promise<boolean> };
            const original = scanner.rescanUnlessRead.bind(scanner);
            const answers: Promise<boolean>[] = [];
            scanner.rescanUnlessRead = (f: TFile) => { const answer = original(f); answers.push(answer); return answer; };
            session.fireVault('changed', makeFile(FILE));
            await vi.advanceTimersByTimeAsync(50);

            expect(await Promise.all(answers)).toEqual([false]);
            expect(contents.get(FILE)).toBe(settled);
        } finally {
            vi.useRealTimers();
        }
    });

    it('still reads a change the last scan did not read, when "changed" is the only word of it', async () => {
        const contents = flowNote();
        const session = vaultSession(contents);
        await session.scanAll();
        contents.set(FILE, ['- [ ] 週報 @2026-09-21 ==> every mon', '- [ ] 新しい', ''].join('\n'));
        const scanner = session.scanner as unknown as { rescanUnlessRead: (f: TFile) => Promise<boolean> };
        expect(await scanner.rescanUnlessRead(makeFile(FILE))).toBe(true);
        expect(session.index.getTasks().map(t => t.content)).toContain('新しい');
    });
});
