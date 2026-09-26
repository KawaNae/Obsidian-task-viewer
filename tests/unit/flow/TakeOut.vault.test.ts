import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { t } from '../../../src/i18n';
import { freezeDate } from '../helpers/fakeDate';

// Frozen so `==> every mon` on `@2026-09-21` lands on the `@2026-09-28` these
// tests hard-code, no matter which day the suite runs.
freezeDate(new Date(2026, 8, 25, 12, 0, 0));

/**
 * A write that takes one line out — a property line deleted, a `==>` line
 * stripped by a fire — does not take out a line with lines of its own below
 * it that would read as something else without it
 * (`OutlineReading.canTakeOut`), and refuses instead. A paragraph going on
 * the line goes on the item above, and does not stop it.
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
        expect(Notice.messages).toEqual([t('notice.writeDisturbs', { subject: 'T' })]);
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
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(before.replace('- [ ] 対象', '- [x] 対象'));
        expect(session.index.getTask(sub)?.content).toBe('sub');
        expect(Notice.messages).toEqual([t('notice.flowNotRun', { reason: t('notice.refusedDisturbs'), subject: '対象' })]);
    });
});

describe('a move that leaves its command line behind', () => {
    it('is refused, the whole fire with it, when a child stands below the command', async () => {
        const { contents, session } = await open(['# note', '- [ ] X @2026-09-21', '\t- ==> move()', '\t\t- [ ] sub ^s', '- [ ] U', '']);
        const before = contents.get(FILE)!;
        const sub = idOf(session, 'sub');

        expect(await session.index.updateTask(idOf(session, 'X'), { statusChar: 'x' })).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(before.replace('- [ ] X', '- [x] X'));
        expect(session.index.getTask(sub)?.content).toBe('sub');
    });
});

describe('a property line added after one with a child', () => {
    it('goes past that child, which stays under its own line; deleting that line is then refused', async () => {
        const { contents, session } = await open(['# note', '- [ ] T', '\t- memo:: a', '\t\t- [ ] sub', '- [ ] U', '']);

        await session.index.updateTask(idOf(session, 'T'),
            { properties: { memo: { value: 'a', type: 'string' }, k2: { value: 'z', type: 'string' } } } as never);
        await session.settle(FILE);
        expect(contents.get(FILE)!.split('\n')).toEqual(['# note', '- [ ] T', '\t- memo:: a', '\t\t- [ ] sub', '\t- k2:: z', '- [ ] U', '']);

        const before = contents.get(FILE)!;
        await session.index.updateTask(idOf(session, 'T'), { properties: { k2: { value: 'z', type: 'string' } } } as never);
        await session.settle(FILE);
        expect(contents.get(FILE)).toBe(before);
    });
});

describe('a child written under a task with no children', () => {
    it('reaches the task\'s content column, however wide its marker', async () => {
        const { contents, session } = await open(['# note', '100. [ ] T', '']);

        await session.index.appendChildTask(idOf(session, 'T'), '- [ ] c');
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toEqual(['# note', '100. [ ] T', '\t\t- [ ] c', '']);
        expect(session.index.getTasks().find(task => task.content === 'c')?.parentId).toBe(idOf(session, 'T'));
    });
});

describe('a line with a note bullet below it', () => {
    // The note goes under the task: no task, command or property changes
    // (the fourth L2 counterexample run, U1 and U2). Refused, the series
    // stopped when a `==>` line had a word of explanation under it.
    it('is stripped by a fire, and the series goes on', async () => {
        const { contents, session } = await open(['# note', '- [ ] T @2026-09-21', '  - ==> every mon', '    - why weekly', '- [ ] U', '']);

        expect(await session.index.updateTask(idOf(session, 'T'), { statusChar: 'x' })).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toEqual([
            '# note', '- [ ] T @2026-09-28', '  - ==> every mon', '- [x] T @2026-09-21', '    - why weekly', '- [ ] U', '',
        ]);
        expect(Notice.messages).toEqual([]);
    });

    it('is deleted as a property line, the note going under the task', async () => {
        const { contents, session } = await open(['# note', '- [ ] T', '  - memo:: a', '    - detail', '- [ ] U', '']);

        await deleteMemo(session);

        expect(contents.get(FILE)!.split('\n')).toEqual(['# note', '- [ ] T', '    - detail', '- [ ] U', '']);
        expect(Notice.messages).toEqual([]);
    });
});

describe('a command line with a paragraph going on it', () => {
    it('is stripped by a fire, the paragraph going on the task instead', async () => {
        const { contents, session } = await open(['# note', '- [ ] 対象 @2026-09-21', '\t- ==> every mon', 'lazy', '- [ ] U', '']);

        expect(await session.index.updateTask(idOf(session, '対象'), { statusChar: 'x' })).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toEqual([
            '# note', '- [ ] 対象 @2026-09-28', '\t- ==> every mon', '- [x] 対象 @2026-09-21', 'lazy', '- [ ] U', '',
        ]);
        expect(Notice.messages).toEqual([]);
    });
});
