import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { vaultSession, type VaultSession } from '../../../helpers/vaultSession';

/**
 * A task moved within its own file keeps its ID, however many task rows stand
 * between where it was and where it lands.
 *
 * The move used to be three writes — the status, the append, the delete — and
 * only the delete claimed nothing. Its scan fell to the ladder, which pairs by
 * how near the rows are: the moved line kept its ID with at most one task row
 * between the original and the copy, and took the copy's otherwise (observed
 * in O2 and O3). The move is one write now, and its claim says the moved line
 * is the row that fired, so the distance no longer enters into it.
 */

const FILE = 'note.md';

let live: VaultSession | undefined;

afterEach(() => {
    live?.dispose();
    live = undefined;
    Notice.messages.length = 0;
});

async function flowSettled(session: VaultSession): Promise<void> {
    const executor = (session.index as unknown as { commandExecutor: { isProcessing: boolean; taskQueue: unknown[] } }).commandExecutor;
    await vi.waitFor(() => {
        expect(executor.isProcessing).toBe(false);
        expect(executor.taskQueue).toHaveLength(0);
    });
    await session.settle(FILE);
}

function rowsOf(session: VaultSession): Array<{ id: string; content: string }> {
    return session.index.getTasks()
        .filter(task => task.file === FILE)
        .sort((a, b) => a.line - b.line)
        .map(task => ({ id: task.id, content: task.content }));
}

const COMMANDS: Array<[string, string]> = [
    ['a move alone', 'move([[note]])'],
    ['a next instance and a move', 'every mon move([[note]])'],
];

describe.each(COMMANDS)('%s within the same file', (_name, command) => {
    it.each([0, 1, 2, 1000])('keeps the moved row\'s ID with %i task rows between', async (between) => {
        const fillers = Array.from({ length: between }, (_, i) => `- [ ] 行${i} @2026-09-21`);
        const contents = new Map([[FILE, [
            '# note', '- [ ] 移す @2026-09-21', `\t- ==> ${command}`, '\t- [ ] 子 @2026-09-21', ...fillers, '',
        ].join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const before = rowsOf(live);
        const moving = before.find(row => row.content === '移す')!.id;
        const child = before.find(row => row.content === '子')!.id;
        const kept = before.filter(row => row.content.startsWith('行')).map(row => row.id);

        expect(await live.index.updateTask(moving, { statusChar: 'x' })).toBe(true);
        await flowSettled(live);

        const lines = contents.get(FILE)!.split('\n');
        expect(lines.slice(-2)).toEqual(['- [x] 移す @2026-09-21', '\t- [ ] 子 @2026-09-21']);
        expect(lines).not.toContain('- [ ] 移す @2026-09-21');

        const after = rowsOf(live);
        const moved = after.filter(row => row.content === '移す');
        // With a next instance there is a new row worded like it, above.
        expect(moved.map(row => row.id).at(-1)).toBe(moving);
        expect(after.at(-1)).toEqual({ id: child, content: '子' });
        expect(after.filter(row => row.content.startsWith('行')).map(row => row.id)).toEqual(kept);
        if (moved.length > 1) expect(moved[0].id).not.toBe(moving);
        expect(Notice.messages).toEqual([]);
    });
});
