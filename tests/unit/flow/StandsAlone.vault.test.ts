import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { t } from '../../../src/i18n';

/**
 * A write that takes one line out — a property line deleted, a `==>` line
 * stripped by a fire — does not take out a line with lines of its own below
 * it (`OutlineReading.standsAlone`), and refuses instead.
 *
 * Taken out alone, the line left its child standing under the task, too deep
 * for the task's item: Obsidian reads it as a paragraph going on, and so does
 * the outline, and the child's task and ID were gone (the L2 counterexample
 * run, PR3 and SF1).
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

function idOf(session: VaultSession, content: string): string {
    const found = session.index.getTasks().filter(task => task.file === FILE && task.content === content);
    expect(found).toHaveLength(1);
    return found[0].id;
}

async function deleteMemo(session: VaultSession): Promise<void> {
    await session.index.updateTask(idOf(session, 'T'), { properties: {} } as never);
    await session.settle(FILE);
}

describe('a property line deleted', () => {
    it('is refused when a child stands below it, which keeps its ID', async () => {
        const { contents, session } = await open(['# note', '- [ ] T', '\t- memo:: a', '\t\t- [ ] sub', '- [ ] U', '']);
        const before = contents.get(FILE)!;
        const sub = idOf(session, 'sub');

        await deleteMemo(session);

        expect(contents.get(FILE)).toBe(before);
        expect(session.index.getTask(sub)?.content).toBe('sub');
        expect(Notice.messages).toEqual([t('notice.writeTargetUnplaceable', { subject: 'T' })]);
    });

    it('is taken out when it stands alone', async () => {
        const { contents, session } = await open(['# note', '- [ ] T', '\t- memo:: a', '\t- [ ] sub', '- [ ] U', '']);

        await deleteMemo(session);

        expect(contents.get(FILE)).toBe(['# note', '- [ ] T', '\t- [ ] sub', '- [ ] U', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
    });
});

describe('a command line stripped by a fire', () => {
    it('is refused, the whole fire with it, when a child stands below it', async () => {
        const { contents, session } = await open(['# note', '- [ ] 対象 @2026-09-21', '\t- ==> every mon', '\t\t- [ ] sub', '- [ ] U', '']);
        const before = contents.get(FILE)!;
        const sub = idOf(session, 'sub');

        expect(await session.index.updateTask(idOf(session, '対象'), { statusChar: 'x' })).toBe(true);
        const executor = (session.index as unknown as { commandExecutor: { isProcessing: boolean; taskQueue: unknown[] } }).commandExecutor;
        await vi.waitFor(() => {
            expect(executor.isProcessing).toBe(false);
            expect(executor.taskQueue).toHaveLength(0);
        });
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(before.replace('- [ ] 対象', '- [x] 対象'));
        expect(session.index.getTask(sub)?.content).toBe('sub');
        expect(Notice.messages).toEqual([t('notice.writeTargetUnplaceable', { subject: '対象' })]);
    });
});
