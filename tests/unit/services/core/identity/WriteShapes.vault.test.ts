import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { vaultSession, type VaultSession } from '../../../helpers/vaultSession';
import { t } from '../../../../../src/i18n';
import type { TaskRepository } from '../../../../../src/services/persistence/TaskRepository';

/**
 * The twelve writes that used to find their line with `findTaskLineNumber`,
 * each driven from its public entry over the real index and the real scan,
 * now that they name their target and ask `TaskScanner.locate` where it
 * stands.
 *
 * Every shape is run twice:
 * - A: an ordinary note (no two rows read alike). The write lands as expected,
 *   no notice is raised, and the scan that follows keeps every row's ID —
 *   including the rows the write moved.
 * - B: a line is written above the target by something else just before the
 *   write, with no scan in between. The write still lands on its own row.
 *
 * Flow effects run inside the executor, after the completion scan; their B
 * puts the outside edit between that scan and the effect's own write, by
 * wrapping the repository method the effect calls.
 *
 * The last block is the note whose rows read alike: after an outside edit,
 * the row named cannot be told from its twin, and the write is refused with
 * one notice rather than landing on either.
 */

const FILE = 'note.md';
const ARCHIVE = 'archive.md';
const OUTSIDE = '- [ ] 外部 @2026-09-21';

let live: VaultSession | undefined;

beforeEach(() => {
    Notice.messages.length = 0;
});

afterEach(() => {
    live?.dispose();
    live = undefined;
});

async function open(files: Record<string, string[]>): Promise<{ contents: Map<string, string>; session: VaultSession }> {
    const contents = new Map(Object.entries(files).map(([path, lines]) => [path, lines.join('\n')]));
    live = vaultSession(contents);
    await live.scanAll();
    return { contents, session: live };
}

/** The rows of a file in line order, as `content@startDate` → ID. */
function rows(session: VaultSession, path = FILE): Array<{ key: string; id: string }> {
    return session.index.getTasks()
        .filter(task => task.file === path)
        .sort((a, b) => a.line - b.line)
        .map(task => ({ key: `${task.statusChar}|${task.content}|${task.startDate ?? ''}`, id: task.id }));
}

function idOf(session: VaultSession, content: string, path = FILE): string {
    const found = session.index.getTasks().filter(task => task.file === path && task.content === content);
    expect(found).toHaveLength(1);
    return found[0].id;
}

/** Something other than the plugin writes a line into the file. No scan runs. */
function writeOutside(contents: Map<string, string>, at: number, line = OUTSIDE, path = FILE): void {
    const lines = contents.get(path)!.split('\n');
    lines.splice(at, 0, line);
    contents.set(path, lines.join('\n'));
}

/** Run `edit` once, just before the next call to the repository's `method`. */
function editBefore(session: VaultSession, method: keyof TaskRepository, edit: () => void): void {
    const repository = session.index.getRepository() as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const original = repository[method].bind(repository);
    repository[method] = async (...args: unknown[]) => {
        repository[method] = original;
        edit();
        return original(...args);
    };
}

/** The flow queue has drained and the scans it asked for have run. */
async function flowSettled(session: VaultSession, ...paths: string[]): Promise<void> {
    const executor = (session.index as unknown as { commandExecutor: { isProcessing: boolean; taskQueue: unknown[] } }).commandExecutor;
    await vi.waitFor(() => {
        expect(executor.isProcessing).toBe(false);
        expect(executor.taskQueue).toHaveLength(0);
    });
    for (const path of [FILE, ...paths]) await session.settle(path);
}

async function check(session: VaultSession, id: string): Promise<void> {
    expect(await session.index.updateTask(id, { statusChar: 'x' })).toBe(true);
}

const NOTE = (...target: string[]) => ['# note', '- [ ] 上 @2026-09-21', ...target, '- [ ] 下 @2026-09-21', ''];

// ─── 1. updateTaskInFile ─────────────────────────────────────────────

describe('1. updateTaskInFile', () => {
    it('A: a check rewrites the row and every row keeps its ID', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21') });
        const before = rows(session);

        await check(session, idOf(session, '対象'));
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(NOTE('- [x] 対象 @2026-09-21').join('\n'));
        expect(rows(session).map(row => row.id)).toEqual(before.map(row => row.id));
        expect(Notice.messages).toEqual([]);
    });

    it('A: an update with a child property line writes both, and the row below keeps its ID', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21') });
        const before = rows(session);

        expect(await session.index.updateTask(idOf(session, '対象'), { color: 'ff0000' })).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(NOTE('- [ ] 対象 @2026-09-21', '\t- tv-color:: ff0000').join('\n'));
        expect(rows(session).map(row => row.id)).toEqual(before.map(row => row.id));
        expect(Notice.messages).toEqual([]);
    });

    it('A: a drag commit rewrites the times, and the scan the drag held back keeps every ID', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21T10:00>11:00') });
        const before = rows(session);
        const target = idOf(session, '対象');

        session.index.setDraggingFile(FILE);
        expect(await session.index.updateTask(target, { startTime: '12:00', endTime: '13:00' })).toBe(true);
        session.index.setDraggingFile(null);
        await vi.waitFor(() => expect(session.index.getTask(target)!.originalText).toBe('- [ ] 対象 @2026-09-21T12:00>13:00'));
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(NOTE('- [ ] 対象 @2026-09-21T12:00>13:00').join('\n'));
        expect(rows(session).map(row => row.id)).toEqual(before.map(row => row.id));
        expect(Notice.messages).toEqual([]);
    });

    it('B: a check after a line was written above lands on the target', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21') });
        const before = rows(session);

        writeOutside(contents, 1);
        await check(session, idOf(session, '対象'));
        await session.settle(FILE);

        const expected = NOTE('- [x] 対象 @2026-09-21');
        expected.splice(1, 0, OUTSIDE);
        expect(contents.get(FILE)).toBe(expected.join('\n'));
        const after = rows(session);
        expect(after.map(row => row.key)).toEqual([
            ' |外部|2026-09-21', ' |上|2026-09-21', 'x|対象|2026-09-21', ' |下|2026-09-21',
        ]);
        expect(after.slice(1).map(row => row.id)).toEqual(before.map(row => row.id));
        expect(before.map(row => row.id)).not.toContain(after[0].id);
        expect(Notice.messages).toEqual([]);
    });

    it('B: a child property update after a line was written above lands under the target', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21') });
        const before = rows(session);

        writeOutside(contents, 1);
        expect(await session.index.updateTask(idOf(session, '対象'), { color: 'ff0000' })).toBe(true);
        await session.settle(FILE);

        const expected = NOTE('- [ ] 対象 @2026-09-21', '\t- tv-color:: ff0000');
        expected.splice(1, 0, OUTSIDE);
        expect(contents.get(FILE)).toBe(expected.join('\n'));
        expect(rows(session).slice(1).map(row => row.id)).toEqual(before.map(row => row.id));
        expect(Notice.messages).toEqual([]);
    });
});

// ─── 2. stripFlow ────────────────────────────────────────────────────

describe('2. stripFlow (a completion consuming its command)', () => {
    it('A: the fired row loses its command and keeps its ID', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21 ==> every mon') });
        const held = { above: idOf(session, '上'), target: idOf(session, '対象'), below: idOf(session, '下') };

        await check(session, held.target);
        await flowSettled(session);

        expect(contents.get(FILE)).toBe([
            '# note',
            '- [ ] 対象 @2026-09-28 ==> every mon',
            '- [ ] 上 @2026-09-21',
            '- [x] 対象 @2026-09-21',
            '- [ ] 下 @2026-09-21',
            '',
        ].join('\n'));
        const after = rows(session);
        expect(after.map(row => row.id).slice(1)).toEqual([held.above, held.target, held.below]);
        expect(Object.values(held)).not.toContain(after[0].id);
        expect(Notice.messages).toEqual([]);
    });

    it('B: a line written above between the next instance and the strip does not move the strip', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21 ==> every mon') });
        const held = { above: idOf(session, '上'), target: idOf(session, '対象'), below: idOf(session, '下') };

        editBefore(session, 'stripFlow', () => writeOutside(contents, 1));
        await check(session, held.target);
        await flowSettled(session);

        expect(contents.get(FILE)).toBe([
            '# note',
            OUTSIDE,
            '- [ ] 対象 @2026-09-28 ==> every mon',
            '- [ ] 上 @2026-09-21',
            '- [x] 対象 @2026-09-21',
            '- [ ] 下 @2026-09-21',
            '',
        ].join('\n'));
        const after = rows(session);
        expect(after.map(row => row.id).slice(2)).toEqual([held.above, held.target, held.below]);
        expect(Notice.messages).toEqual([]);
    });
});

// ─── 3. deleteTaskFromFile ───────────────────────────────────────────

describe('3. deleteTaskFromFile', () => {
    it('A: a delete takes the row and its children, and the rows around keep their IDs', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21') });
        const held = { above: idOf(session, '上'), below: idOf(session, '下') };

        expect(await session.index.deleteTask(idOf(session, '対象'))).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(NOTE().join('\n'));
        expect(rows(session).map(row => row.id)).toEqual([held.above, held.below]);
        expect(Notice.messages).toEqual([]);
    });

    it('B: a delete after a line was written above takes the target, not the line above it', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21') });
        const held = { above: idOf(session, '上'), below: idOf(session, '下') };

        writeOutside(contents, 1);
        expect(await session.index.deleteTask(idOf(session, '対象'))).toBe(true);
        await session.settle(FILE);

        const expected = NOTE();
        expected.splice(1, 0, OUTSIDE);
        expect(contents.get(FILE)).toBe(expected.join('\n'));
        expect(rows(session).map(row => row.id).slice(1)).toEqual([held.above, held.below]);
        expect(Notice.messages).toEqual([]);
    });

    it('A: a move to another file takes the original away (delete-original)', async () => {
        const { contents, session } = await open({
            [FILE]: NOTE('- [ ] 対象 @2026-09-21 ==> move([[archive]])', '\t- [ ] 子 @2026-09-21'),
            [ARCHIVE]: ['# archive', ''],
        });
        const held = { above: idOf(session, '上'), below: idOf(session, '下') };

        await check(session, idOf(session, '対象'));
        await flowSettled(session, ARCHIVE);

        expect(contents.get(FILE)).toBe(NOTE().join('\n'));
        expect(rows(session).map(row => row.id)).toEqual([held.above, held.below]);
        expect(Notice.messages).toEqual([]);
    });

    it('B: a line written above between the archive and the delete-original does not move the delete', async () => {
        const { contents, session } = await open({
            [FILE]: NOTE('- [ ] 対象 @2026-09-21 ==> move([[archive]])', '\t- [ ] 子 @2026-09-21'),
            [ARCHIVE]: ['# archive', ''],
        });
        const held = { above: idOf(session, '上'), below: idOf(session, '下') };

        editBefore(session, 'deleteTaskFromFile', () => writeOutside(contents, 1));
        await check(session, idOf(session, '対象'));
        await flowSettled(session, ARCHIVE);

        const expected = NOTE();
        expected.splice(1, 0, OUTSIDE);
        expect(contents.get(FILE)).toBe(expected.join('\n'));
        expect(contents.get(ARCHIVE)).toBe(['# archive', '- [x] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21'].join('\n'));
        expect(rows(session).map(row => row.id).slice(1)).toEqual([held.above, held.below]);
        expect(Notice.messages).toEqual([]);
    });
});

// ─── 4. replaceTaskWithInstances ─────────────────────────────────────

describe('4. replaceTaskWithInstances (a deletion fire)', () => {
    it('A: the next instance goes in, the fired row goes, the rows around keep their IDs', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21 ==> every mon') });
        const held = { above: idOf(session, '上'), target: idOf(session, '対象'), below: idOf(session, '下') };

        expect(await session.index.deleteTask(held.target, { fireFlow: true })).toBe(true);
        await flowSettled(session);

        expect(contents.get(FILE)).toBe([
            '# note', '- [ ] 対象 @2026-09-28 ==> every mon', '- [ ] 上 @2026-09-21', '- [ ] 下 @2026-09-21', '',
        ].join('\n'));
        const after = rows(session).map(row => row.id);
        expect(after.slice(1)).toEqual([held.above, held.below]);
        expect(after[0]).not.toBe(held.target);
        expect(session.index.getTask(held.target)).toBeUndefined();
        expect(Notice.messages).toEqual([]);
    });

    it('B: a line written above before the fire does not move it', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21 ==> every mon') });
        const held = { above: idOf(session, '上'), target: idOf(session, '対象'), below: idOf(session, '下') };

        writeOutside(contents, 1);
        expect(await session.index.deleteTask(held.target, { fireFlow: true })).toBe(true);
        await flowSettled(session);

        expect(contents.get(FILE)).toBe([
            '# note', '- [ ] 対象 @2026-09-28 ==> every mon', OUTSIDE, '- [ ] 上 @2026-09-21', '- [ ] 下 @2026-09-21', '',
        ].join('\n'));
        const after = rows(session).map(row => row.id);
        expect(after.slice(2)).toEqual([held.above, held.below]);
        expect(session.index.getTask(held.target)).toBeUndefined();
        expect(Notice.messages).toEqual([]);
    });
});

// ─── 5. insertLineAfterTask ──────────────────────────────────────────

describe('5. insertLineAfterTask (appendChildTask)', () => {
    it('A: the line goes in as the last child, and the rows keep their IDs', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21') });
        const before = rows(session).map(row => row.id);

        await session.index.appendChildTask(idOf(session, '対象'), '- [ ] 追加 @2026-09-21');
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(NOTE('- [ ] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21', '\t- [ ] 追加 @2026-09-21').join('\n'));
        const after = rows(session).map(row => row.id);
        expect([after[0], after[1], after[2], after[4]]).toEqual(before);
        expect(before).not.toContain(after[3]);
        expect(Notice.messages).toEqual([]);
    });

    it('B: after a line was written above, the child still goes under the target', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21') });
        const before = rows(session).map(row => row.id);

        writeOutside(contents, 1);
        await session.index.appendChildTask(idOf(session, '対象'), '- [ ] 追加 @2026-09-21');
        await session.settle(FILE);

        const expected = NOTE('- [ ] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21', '\t- [ ] 追加 @2026-09-21');
        expected.splice(1, 0, OUTSIDE);
        expect(contents.get(FILE)).toBe(expected.join('\n'));
        const after = rows(session).map(row => row.id);
        expect([after[1], after[2], after[3], after[5]]).toEqual(before);
        expect(Notice.messages).toEqual([]);
    });
});

// ─── 6. insertSiblingAfterTask ───────────────────────────────────────

describe('6. insertSiblingAfterTask (timer records)', () => {
    it('A: the line goes in past the subtree, and the rows keep their IDs', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21') });
        const before = rows(session).map(row => row.id);

        const at = await session.index.insertSiblingAfterTask(idOf(session, '対象'), '- [ ] 記録 @2026-09-21');
        await session.settle(FILE);

        expect(at).toBe(4);
        expect(contents.get(FILE)).toBe(NOTE('- [ ] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21', '- [ ] 記録 @2026-09-21').join('\n'));
        const after = rows(session).map(row => row.id);
        expect([after[0], after[1], after[2], after[4]]).toEqual(before);
        expect(Notice.messages).toEqual([]);
    });

    it('A: afterCompletedRun goes past the completed siblings that follow', async () => {
        const target = ['- [ ] 対象 @2026-09-21T10:00>11:00', '- [x] 済1 @2026-09-21T11:00>12:00', '- [x] 済2 @2026-09-21T12:00>13:00'];
        const { contents, session } = await open({ [FILE]: NOTE(...target) });
        const before = rows(session).map(row => row.id);

        const at = await session.index.insertSiblingAfterTask(idOf(session, '対象'), '- [ ] 記録 @2026-09-21T13:00', { afterCompletedRun: true });
        await session.settle(FILE);

        expect(at).toBe(5);
        expect(contents.get(FILE)).toBe(NOTE(...target, '- [ ] 記録 @2026-09-21T13:00').join('\n'));
        const after = rows(session).map(row => row.id);
        expect([...after.slice(0, 4), after[5]]).toEqual(before);
        expect(Notice.messages).toEqual([]);
    });

    it('B: after a line was written above, the sibling still follows the target', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21') });
        const before = rows(session).map(row => row.id);

        writeOutside(contents, 1);
        const at = await session.index.insertSiblingAfterTask(idOf(session, '対象'), '- [ ] 記録 @2026-09-21');
        await session.settle(FILE);

        expect(at).toBe(5);
        const expected = NOTE('- [ ] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21', '- [ ] 記録 @2026-09-21');
        expected.splice(1, 0, OUTSIDE);
        expect(contents.get(FILE)).toBe(expected.join('\n'));
        const after = rows(session).map(row => row.id);
        expect([after[1], after[2], after[3], after[5]]).toEqual(before);
        expect(Notice.messages).toEqual([]);
    });

    it('B: afterCompletedRun after a line was written above still ends the run', async () => {
        const target = ['- [ ] 対象 @2026-09-21T10:00>11:00', '- [x] 済1 @2026-09-21T11:00>12:00', '- [x] 済2 @2026-09-21T12:00>13:00'];
        const { contents, session } = await open({ [FILE]: NOTE(...target) });
        const before = rows(session).map(row => row.id);

        writeOutside(contents, 1);
        const at = await session.index.insertSiblingAfterTask(idOf(session, '対象'), '- [ ] 記録 @2026-09-21T13:00', { afterCompletedRun: true });
        await session.settle(FILE);

        expect(at).toBe(6);
        const expected = NOTE(...target, '- [ ] 記録 @2026-09-21T13:00');
        expected.splice(1, 0, OUTSIDE);
        expect(contents.get(FILE)).toBe(expected.join('\n'));
        const after = rows(session).map(row => row.id);
        expect([...after.slice(1, 5), after[6]]).toEqual(before);
        expect(Notice.messages).toEqual([]);
    });
});

// ─── 7. insertLineAsFirstChild ───────────────────────────────────────

describe('7. insertLineAsFirstChild (insertChildTask)', () => {
    it('A: the line goes in as the first child, and the rows keep their IDs', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21') });
        const before = rows(session).map(row => row.id);

        expect(await session.index.insertChildTask(idOf(session, '対象'), '- [ ] 先頭 @2026-09-21')).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(NOTE('- [ ] 対象 @2026-09-21', '\t- [ ] 先頭 @2026-09-21', '\t- [ ] 子 @2026-09-21').join('\n'));
        const after = rows(session).map(row => row.id);
        expect([after[0], after[1], after[3], after[4]]).toEqual(before);
        expect(Notice.messages).toEqual([]);
    });

    it('B: after a line was written above, the child still goes under the target', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21') });
        const before = rows(session).map(row => row.id);

        writeOutside(contents, 1);
        expect(await session.index.insertChildTask(idOf(session, '対象'), '- [ ] 先頭 @2026-09-21')).toBe(true);
        await session.settle(FILE);

        const expected = NOTE('- [ ] 対象 @2026-09-21', '\t- [ ] 先頭 @2026-09-21', '\t- [ ] 子 @2026-09-21');
        expected.splice(1, 0, OUTSIDE);
        expect(contents.get(FILE)).toBe(expected.join('\n'));
        const after = rows(session).map(row => row.id);
        expect([after[1], after[2], after[4], after[5]]).toEqual(before);
        expect(Notice.messages).toEqual([]);
    });
});

// ─── 8. appendTaskWithChildren ───────────────────────────────────────

describe('8. appendTaskWithChildren (a move archiving its subtree)', () => {
    it('A: to another file, the row and its children arrive and the original goes', async () => {
        const { contents, session } = await open({
            [FILE]: NOTE('- [ ] 対象 @2026-09-21 ==> move([[archive]])', '\t- [ ] 子 @2026-09-21'),
            [ARCHIVE]: ['# archive', ''],
        });

        await check(session, idOf(session, '対象'));
        await flowSettled(session, ARCHIVE);

        expect(contents.get(ARCHIVE)).toBe(['# archive', '- [x] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21'].join('\n'));
        expect(contents.get(FILE)).toBe(NOTE().join('\n'));
        expect(rows(session, ARCHIVE).map(row => row.key)).toEqual(['x|対象|2026-09-21', ' |子|2026-09-21']);
        expect(Notice.messages).toEqual([]);
    });

    it('A: within the same file, the subtree goes to the end and the rows above keep their IDs', async () => {
        const { contents, session } = await open({
            [FILE]: NOTE('- [ ] 対象 @2026-09-21 ==> move([[note]])', '\t- [ ] 子 @2026-09-21'),
        });
        const held = { above: idOf(session, '上'), below: idOf(session, '下') };

        await check(session, idOf(session, '対象'));
        await flowSettled(session);

        // The append takes the place of the file's final empty line, so the
        // note ends without a terminator (appendLines).
        expect(contents.get(FILE)).toBe([
            '# note', '- [ ] 上 @2026-09-21', '- [ ] 下 @2026-09-21', '- [x] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21',
        ].join('\n'));
        expect(rows(session).map(row => row.id).slice(0, 2)).toEqual([held.above, held.below]);
        expect(Notice.messages).toEqual([]);
    });

    it('B: to another file, a line written above the source before the archive does not change which children go', async () => {
        const { contents, session } = await open({
            [FILE]: NOTE('- [ ] 対象 @2026-09-21 ==> move([[archive]])', '\t- [ ] 子 @2026-09-21'),
            [ARCHIVE]: ['# archive', ''],
        });
        const held = { above: idOf(session, '上'), below: idOf(session, '下') };

        editBefore(session, 'appendTaskWithChildren', () => writeOutside(contents, 1));
        await check(session, idOf(session, '対象'));
        await flowSettled(session, ARCHIVE);

        expect(contents.get(ARCHIVE)).toBe(['# archive', '- [x] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21'].join('\n'));
        const expected = NOTE();
        expected.splice(1, 0, OUTSIDE);
        expect(contents.get(FILE)).toBe(expected.join('\n'));
        expect(rows(session).map(row => row.id).slice(1)).toEqual([held.above, held.below]);
        expect(Notice.messages).toEqual([]);
    });

    it('B: within the same file, a line written above before the archive does not change which children go', async () => {
        const { contents, session } = await open({
            [FILE]: NOTE('- [ ] 対象 @2026-09-21 ==> move([[note]])', '\t- [ ] 子 @2026-09-21'),
        });
        const held = { above: idOf(session, '上'), below: idOf(session, '下') };

        editBefore(session, 'appendTaskWithChildren', () => writeOutside(contents, 1));
        await check(session, idOf(session, '対象'));
        await flowSettled(session);

        expect(contents.get(FILE)).toBe([
            '# note', OUTSIDE, '- [ ] 上 @2026-09-21', '- [ ] 下 @2026-09-21', '- [x] 対象 @2026-09-21', '\t- [ ] 子 @2026-09-21',
        ].join('\n'));
        expect(rows(session).map(row => row.id).slice(1, 3)).toEqual([held.above, held.below]);
        expect(Notice.messages).toEqual([]);
    });
});

// ─── 9. duplicateInlineTask ──────────────────────────────────────────

describe('9. duplicateInlineTask (a copy on another day)', () => {
    const TARGET = ['- [ ] 対象 @2026-09-21T10:00>11:00 ^blk', '\t- [ ] 子 @2026-09-21'];

    it('A: the copy goes above, and the original and its child keep their IDs', async () => {
        const { contents, session } = await open({ [FILE]: NOTE(...TARGET) });
        const before = rows(session).map(row => row.id);

        expect(await session.index.duplicateTask(before[1], { dayOffset: 1 })).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(NOTE('- [ ] 対象 @2026-09-22T10:00>11:00', '\t- [ ] 子 @2026-09-21', ...TARGET).join('\n'));
        const after = rows(session).map(row => row.id);
        expect([after[0], after[3], after[4], after[5]]).toEqual(before);
        expect(before).not.toContain(after[1]);
        expect(before).not.toContain(after[2]);
        expect(Notice.messages).toEqual([]);
    });

    it('B: after a line was written above, the copy still goes above the target', async () => {
        const { contents, session } = await open({ [FILE]: NOTE(...TARGET.map(line => line.replace(' ^blk', ''))) });
        const before = rows(session).map(row => row.id);

        writeOutside(contents, 1);
        expect(await session.index.duplicateTask(before[1], { dayOffset: 1 })).toBe(true);
        await session.settle(FILE);

        const expected = NOTE('- [ ] 対象 @2026-09-22T10:00>11:00', '\t- [ ] 子 @2026-09-21',
            '- [ ] 対象 @2026-09-21T10:00>11:00', '\t- [ ] 子 @2026-09-21');
        expected.splice(1, 0, OUTSIDE);
        expect(contents.get(FILE)).toBe(expected.join('\n'));
        const after = rows(session).map(row => row.id);
        expect([after[1], after[4], after[5], after[6]]).toEqual(before);
        expect(Notice.messages).toEqual([]);
    });
});

// ─── 10. duplicateInlineTaskInPlace ──────────────────────────────────

describe('10. duplicateInlineTaskInPlace (a copy that continues)', () => {
    const TARGET = ['- [ ] 対象 @2026-09-21T10:00>11:00', '\t- [ ] 子 @2026-09-21'];

    it('A: the copy goes after the subtree, and the original keeps its ID', async () => {
        const { contents, session } = await open({ [FILE]: NOTE(...TARGET) });
        const before = rows(session).map(row => row.id);

        expect(await session.index.duplicateTask(before[1])).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(NOTE(...TARGET, '- [ ] 対象 @2026-09-21T11:00>12:00', '\t- [ ] 子 @2026-09-21').join('\n'));
        const after = rows(session).map(row => row.id);
        expect([after[0], after[1], after[2], after[5]]).toEqual(before);
        expect(Notice.messages).toEqual([]);
    });

    it('B: after a line was written above, the copy still follows the target', async () => {
        const { contents, session } = await open({ [FILE]: NOTE(...TARGET) });
        const before = rows(session).map(row => row.id);

        writeOutside(contents, 1);
        expect(await session.index.duplicateTask(before[1])).toBe(true);
        await session.settle(FILE);

        const expected = NOTE(...TARGET, '- [ ] 対象 @2026-09-21T11:00>12:00', '\t- [ ] 子 @2026-09-21');
        expected.splice(1, 0, OUTSIDE);
        expect(contents.get(FILE)).toBe(expected.join('\n'));
        const after = rows(session).map(row => row.id);
        expect([after[1], after[2], after[3], after[6]]).toEqual(before);
        expect(Notice.messages).toEqual([]);
    });
});

// ─── 11. insertRecurrenceForTask ─────────────────────────────────────

describe('11. insertRecurrenceForTask (create-next)', () => {
    it('A: the next instance goes to the head of the group', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21', '\t- ==> every mon') });
        const held = { above: idOf(session, '上'), target: idOf(session, '対象'), below: idOf(session, '下') };

        await check(session, held.target);
        await flowSettled(session);

        expect(contents.get(FILE)).toBe([
            '# note',
            '- [ ] 対象 @2026-09-28',
            '\t- ==> every mon',
            '- [ ] 上 @2026-09-21',
            '- [x] 対象 @2026-09-21',
            '- [ ] 下 @2026-09-21',
            '',
        ].join('\n'));
        const after = rows(session).map(row => row.id);
        expect(after.slice(1)).toEqual([held.above, held.target, held.below]);
        expect(Notice.messages).toEqual([]);
    });

    it('B: a line written above just before the insert does not move it off the group', async () => {
        const { contents, session } = await open({ [FILE]: NOTE('- [ ] 対象 @2026-09-21', '\t- ==> every mon') });
        const held = { above: idOf(session, '上'), target: idOf(session, '対象'), below: idOf(session, '下') };

        editBefore(session, 'insertRecurrenceForTask', () => writeOutside(contents, 1));
        await check(session, held.target);
        await flowSettled(session);

        expect(contents.get(FILE)).toBe([
            '# note',
            '- [ ] 対象 @2026-09-28',
            '\t- ==> every mon',
            OUTSIDE,
            '- [ ] 上 @2026-09-21',
            '- [x] 対象 @2026-09-21',
            '- [ ] 下 @2026-09-21',
            '',
        ].join('\n'));
        const after = rows(session).map(row => row.id);
        expect(after.slice(2)).toEqual([held.above, held.target, held.below]);
        expect(Notice.messages).toEqual([]);
    });
});

// ─── 12. insertGeneratedInstance ─────────────────────────────────────

describe('12. insertGeneratedInstance (create-generated)', () => {
    const GEN = ['```tv-gen 週報', '- [ ] 対象', '\t- [ ] 生成子', '```', ''];
    const SOURCE = () => [...NOTE('- [ ] 対象 @2026-09-21', '\t- ==> every mon use("週報")', '\t- [ ] 元の子'), ...GEN];

    it('A: the block\'s instance goes to the head of the group', async () => {
        const { contents, session } = await open({ [FILE]: SOURCE() });
        const held = { above: idOf(session, '上'), target: idOf(session, '対象'), below: idOf(session, '下') };
        const child = idOf(session, '元の子');

        await check(session, held.target);
        await flowSettled(session);

        expect(contents.get(FILE)).toBe([
            '# note',
            '- [ ] 対象',
            '\t- ==> every mon use("週報")',
            '\t- [ ] 生成子',
            '- [ ] 上 @2026-09-21',
            '- [x] 対象 @2026-09-21',
            '\t- [ ] 元の子',
            '- [ ] 下 @2026-09-21',
            '',
            ...GEN,
        ].join('\n'));
        const after = rows(session).map(row => row.id);
        expect(after.slice(2)).toEqual([held.above, held.target, child, held.below]);
        expect(Notice.messages).toEqual([]);
    });

    it('B: a line written above just before the insert does not move it off the group', async () => {
        const { contents, session } = await open({ [FILE]: SOURCE() });
        const held = { above: idOf(session, '上'), target: idOf(session, '対象'), below: idOf(session, '下') };
        const child = idOf(session, '元の子');

        editBefore(session, 'insertGeneratedInstance', () => writeOutside(contents, 1));
        await check(session, held.target);
        await flowSettled(session);

        expect(contents.get(FILE)).toBe([
            '# note',
            '- [ ] 対象',
            '\t- ==> every mon use("週報")',
            '\t- [ ] 生成子',
            OUTSIDE,
            '- [ ] 上 @2026-09-21',
            '- [x] 対象 @2026-09-21',
            '\t- [ ] 元の子',
            '- [ ] 下 @2026-09-21',
            '',
            ...GEN,
        ].join('\n'));
        const after = rows(session).map(row => row.id);
        expect(after.slice(3)).toEqual([held.above, held.target, child, held.below]);
        expect(Notice.messages).toEqual([]);
    });
});

// ─── Rows that read alike ────────────────────────────────────────────

describe('twins after an outside edit: refused, with one notice', () => {
    const TWINS = (twin: string) => ['# note', '- [ ] 親 @2026-09-21', `\t${twin}`, `\t${twin}`, '- [ ] 下 @2026-09-21', ''];
    const ambiguous = (subject: string) => t('notice.writeTargetAmbiguous', { count: '2', subject });

    it('updateTaskInFile writes nothing', async () => {
        const { contents, session } = await open({ [FILE]: TWINS('- [ ] 子 @2026-09-21') });
        const second = rows(session)[2].id;

        writeOutside(contents, 1);
        const edited = contents.get(FILE);
        expect(await session.index.updateTask(second, { statusChar: 'x' })).toBe(false);
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(edited);
        expect(Notice.messages).toEqual([ambiguous('子')]);
    });

    it('deleteTaskFromFile writes nothing', async () => {
        const { contents, session } = await open({ [FILE]: TWINS('- [ ] 子 @2026-09-21') });
        const second = rows(session)[2].id;

        writeOutside(contents, 1);
        const edited = contents.get(FILE);
        expect(await session.index.deleteTask(second)).toBe(false);
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(edited);
        expect(Notice.messages).toEqual([ambiguous('子')]);
    });

    it('a flow fire (create-next, then strip-flow) writes nothing', async () => {
        // The check itself lands: the twins differ once one of them is `[x]`.
        // The outside edit then checks the other twin too and writes a line
        // above, so by the time the fire writes, the two read alike again.
        const { contents, session } = await open({ [FILE]: TWINS('- [ ] 子 @2026-09-21 ==> every mon') });
        const second = rows(session)[2].id;

        editBefore(session, 'insertRecurrenceForTask', () => {
            contents.set(FILE, contents.get(FILE)!.replace('\t- [ ] 子', '\t- [x] 子'));
            writeOutside(contents, 1);
        });
        await check(session, second);
        await flowSettled(session);

        expect(contents.get(FILE)).toBe([
            '# note', OUTSIDE, '- [ ] 親 @2026-09-21',
            '\t- [x] 子 @2026-09-21 ==> every mon', '\t- [x] 子 @2026-09-21 ==> every mon',
            '- [ ] 下 @2026-09-21', '',
        ].join('\n'));
        // Measured: each effect is refused on its own — create-next, then
        // strip-flow — and each says so once.
        expect(Notice.messages).toEqual([ambiguous('子'), ambiguous('子')]);
    });
});
