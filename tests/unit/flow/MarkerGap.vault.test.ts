import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * A task line written over keeps its indentation, its list marker and the
 * gap after the marker (`TaskLineClassifier.extractMarker`). The gap sets the
 * item's content column, and a child reaches the item by it: under `-\t[ ] T`
 * a child two spaces past a tab is T's, under `- [ ] T` it goes on T's
 * paragraph, and its task and ID were gone after T was only checked off (the
 * fourth L2 counterexample run, G2).
 */

const FILE = 'note.md';

let live: VaultSession | undefined;

beforeEach(() => {
    Notice.messages.length = 0;
});

afterEach(() => {
    live?.dispose();
    live = undefined;
});

async function open(lines: string[]): Promise<{ contents: Map<string, string>; session: VaultSession }> {
    const contents = new Map([[FILE, lines.join('\n')]]);
    live = vaultSession(contents);
    await live.scanAll();
    return { contents, session: live };
}

function taskWorded(session: VaultSession, content: string) {
    const found = session.index.getTasks().filter(task => task.file === FILE && task.content === content);
    expect(found).toHaveLength(1);
    return found[0];
}

async function complete(session: VaultSession, content: string): Promise<void> {
    expect(await session.index.updateTask(taskWorded(session, content).id, { statusChar: 'x' })).toBe(true);
    const executor = (session.index as unknown as { commandExecutor: { isProcessing: boolean; taskQueue: unknown[] } }).commandExecutor;
    await vi.waitFor(() => {
        expect(executor.isProcessing).toBe(false);
        expect(executor.taskQueue).toHaveLength(0);
    });
    await session.settle(FILE);
}

describe('a task line written over', () => {
    for (const [name, above, row, child] of [
        ['a tab after the marker', [], '-\t[ ] T @2026-09-21', '\t  - [ ] c'],
        ['four spaces after the marker', [], '-    [ ] T @2026-09-21', '      - [ ] c'],
        ['an indented row with four spaces after its marker', ['- [ ] P'], '\t-    [ ] T @2026-09-21', '\t      - [ ] c'],
    ] as const) {
        it(`keeps ${name} when checked off, and its child with its ID`, async () => {
            const { contents, session } = await open(['# note', ...above, row, child, '- [ ] U', '']);
            const c = taskWorded(session, 'c').id;

            await complete(session, 'T');

            expect(contents.get(FILE)!.split('\n')).toEqual(['# note', ...above, row.replace('[ ]', '[x]'), child, '- [ ] U', '']);
            expect(session.index.getTask(c)?.parentId).toBe(taskWorded(session, 'T').id);
        });
    }

    it('keeps the gap when a fire strips its command', async () => {
        const { contents, session } = await open(['# note', '-\t[ ] T @2026-09-21 ==> every mon', '\t  - [ ] c', '- [ ] U', '']);
        const c = taskWorded(session, 'c').id;

        await complete(session, 'T');

        const lines = contents.get(FILE)!.split('\n');
        expect(lines).toContain('-\t[x] T @2026-09-21');
        expect(lines[lines.indexOf('-\t[x] T @2026-09-21') + 1]).toBe('\t  - [ ] c');
        expect(session.index.getTask(c)?.content).toBe('c');
        expect(Notice.messages).toEqual([]);
    });

    it('keeps the gap when a move within the note carries it with its child', async () => {
        const { contents, session } = await open(['# note', '-    [ ] T @2026-09-21 ==> move([[note]])', '      - [ ] c', '- [ ] U', '']);

        await complete(session, 'T');

        const lines = contents.get(FILE)!.split('\n');
        const at = lines.findIndex(line => line.startsWith('-    [x] T'));
        expect(at).toBeGreaterThan(-1);
        expect(lines[at + 1]).toBe('      - [ ] c');
        const c = session.index.getTasks().find(task => task.content === 'c')!;
        expect(session.index.getTask(c.parentId!)?.content).toBe('T');
    });

    it('keeps the gap when a property line is deleted', async () => {
        const { contents, session } = await open(['# note', '-    [ ] T', '     - memo:: a', '      - [ ] c', '- [ ] U', '']);
        const c = taskWorded(session, 'c').id;

        await session.index.updateTask(taskWorded(session, 'T').id, { properties: {} } as never);
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toEqual(['# note', '-    [ ] T', '      - [ ] c', '- [ ] U', '']);
        expect(session.index.getTask(c)?.parentId).toBe(taskWorded(session, 'T').id);
    });
});
