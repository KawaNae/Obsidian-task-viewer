import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { vaultSession, makeFile } from './vaultSession';
import { freezeDate } from './fakeDate';

// Frozen so `==> every mon` on `@2026-09-21` lands on the `@2026-09-28` these
// tests hard-code, no matter which day the suite runs.
freezeDate(new Date(2026, 8, 25, 12, 0, 0));

/**
 * A flow's own writes do not fire again (structure.md, 「発火の可否」). A fire
 * is made in the write that completes its row, and nothing else has a way to
 * fire: the scans that read the flow's writes, the `changed` that follows
 * them, have none (stage X). These count the fires the index plans, through
 * its own flow executor's `planFire`.
 */
function countFires(session: ReturnType<typeof vaultSession>): { count: number } {
    const counter = { count: 0 };
    const executor = session.executor;
    const original = executor.planFire.bind(executor);
    executor.planFire = (...args) => {
        const plan = original(...args);
        if (plan.kind === 'fires') counter.count++;
        return plan;
    };
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
        expect(contents.get(FILE)!.split('\n').filter(l => l.trim())).toEqual([
            '- [ ] 週報 @2026-09-28 ==> every mon',
            '- [x] 週報 @2026-09-21',
        ]);
        await session.settle(FILE);

        expect(fires.count).toBe(1);
    });

    it('does not refire from the metadataCache "changed" scan either: it reads what the last scan read, and commits nothing', async () => {
        // `changed` follows every write. The scan it asks for reads the
        // content the completing write left, which the last scan already
        // read; and no scan fires, whatever it reads.
        const contents = flowNote();
        const session = vaultSession(contents);
        await session.scanAll();
        const weekly = session.index.getTasks().find(t => t.content === '週報')!;

        vi.useFakeTimers();
        try {
            await session.index.updateTask(weekly.id, { statusChar: 'x' });
            await vi.advanceTimersByTimeAsync(1500);
            const settled = contents.get(FILE);

            const scanner = session.scannerPrivates;
            const original = scanner.queueScan.bind(scanner);
            const answers: Promise<boolean>[] = [];
            scanner.queueScan = (f: TFile) => { const answer = original(f); answers.push(answer); return answer; };
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
        const scanner = session.scannerPrivates;
        expect(await scanner.queueScan(makeFile(FILE))).toBe(true);
        expect(session.index.getTasks().map(t => t.content)).toContain('新しい');
    });
});
