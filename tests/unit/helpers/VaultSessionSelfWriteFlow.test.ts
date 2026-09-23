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
