import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { vaultSession, makeFile } from './vaultSession';
import type { TaskScanner } from '../../../src/services/core/TaskScanner';

/**
 * `structure.md` names the scaffold's other limit: `vaultSession` forced
 * every post-write scan `isLocal=true`, so a flow's own writes (FlowExecutor
 * calls the repository directly and never marks local — `FlowExecutor.ts:220`
 * ほか) could never be told apart from a user's. These scenarios watch
 * `scanner.queueScan` directly, the way the write layer itself is watched
 * elsewhere in this suite (`ChildInsertClaims.test.ts`'s `watchClaims`).
 */
function traceScans(session: ReturnType<typeof vaultSession>, path: string): boolean[] {
    const trace: boolean[] = [];
    const scanner = session.scanner as unknown as {
        queueScan: (f: TFile, isLocal?: boolean) => Promise<void>;
    };
    const original = scanner.queueScan.bind(scanner);
    scanner.queueScan = (f: TFile, isLocal?: boolean) => {
        if (f.path === path) trace.push(!!isLocal);
        return original(f, isLocal);
    };
    return trace;
}

describe("vaultSession: isLocal for a flow's own writes", () => {
    const FILE = 'flow.md';
    const flowNote = () => new Map([[FILE, ['- [ ] 週報 @2026-09-21 ==> every mon', ''].join('\n')]]);

    it('is true only for the completing write; every scan the flow makes afterward is isLocal=false, and it fires exactly once', async () => {
        const contents = flowNote();
        const session = vaultSession(contents);
        await session.scanAll();
        const weekly = session.index.getTasks().find(t => t.content === '週報')!;

        const trace = traceScans(session, FILE);
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

        // The completing write (a UI-equivalent CRUD call) is local; every
        // scan the flow's own writes cause afterward is not.
        expect(trace[0]).toBe(true);
        expect(trace.length).toBeGreaterThan(1);
        expect(trace.slice(1)).toEqual(trace.slice(1).map(() => false));
    });

    it('does not refire from the metadataCache "changed" scan either, once that scan is not swallowed by a stale selfWrites mark', async () => {
        // At ordinary speed `changed` never gets this far: the completing
        // write's own selfWrites mark (TaskIndex.ts:179-181, a 1000ms window
        // keyed by path, not by which write set it) still covers the flow's
        // own writes, which land within a few ms of it — see report.md. This
        // waits the window out so the path this scaffold now supports
        // (fireVault('changed', ...) actually reaching TaskIndex) gets
        // exercised on its own.
        const contents = flowNote();
        const session = vaultSession(contents);
        await session.scanAll();
        const weekly = session.index.getTasks().find(t => t.content === '週報')!;

        vi.useFakeTimers();
        try {
            await session.index.updateTask(weekly.id, { statusChar: 'x' });
            await vi.advanceTimersByTimeAsync(1500);
            const settled = contents.get(FILE);

            const trace = traceScans(session, FILE);
            session.fireVault('changed', makeFile(FILE));
            await vi.advanceTimersByTimeAsync(50);

            expect(trace).toEqual([false]);
            expect(contents.get(FILE)).toBe(settled);
        } finally {
            vi.useRealTimers();
        }
    });
});
