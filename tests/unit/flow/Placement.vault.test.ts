import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { t } from '../../../src/i18n';
import { freezeDate } from '../helpers/fakeDate';

// Frozen so `==> every mon` on `@2026-09-21` lands on the `@2026-09-28` these
// tests hard-code, no matter which day the suite runs.
freezeDate(new Date(2026, 8, 25, 12, 0, 0));

/**
 * A fire writes its next instance in the body of the note, or not at all
 * (CY1, older than F3).
 *
 * The next instance of a row that is not indented goes to the head of the
 * run of siblings above it. The walk that found the head took any unindented
 * line for a sibling, and knew nothing of fences or the frontmatter: a row
 * just under a fence put its next instance inside the fence, a row just under
 * the frontmatter put it above the frontmatter. Either way the line written
 * is no task to the index, the command was consumed, and the series stopped
 * without a word.
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
    return openLiveVault(lines, session => { live = session; });
}

function tasksWorded(session: VaultSession, content: string) {
    return session.index.getTasks().filter(task => task.file === FILE && task.content === content);
}

async function fire(session: VaultSession): Promise<void> {
    const [row] = tasksWorded(session, '対象');
    expect(await session.index.updateTask(row.id, { statusChar: 'x' })).toBe(true);
    await session.flowSettled(FILE);
}

const ROW = '- [ ] 対象 @2026-09-21 ==> every mon';
const NEXT = '- [ ] 対象 @2026-09-28 ==> every mon';
const DONE = '- [x] 対象 @2026-09-21';

describe('CY1: the next instance of a row with no sibling above it', () => {
    const SHAPES: Array<[string, string[]]> = [
        ['a fence just above', ['# note', '```', '- [ ] sample', '```']],
        ['a tilde fence just above', ['# note', '~~~markdown', 'text', '~~~']],
        ['the frontmatter just above', ['---', 'tv-color: ff0000', '---']],
        ['a --- rule just above', ['# note', 'text', '---']],
        ['a paragraph just above', ['# note', 'Some text']],
        ['a table just above', ['# note', '| a | b |', '| - | - |', '| 1 | 2 |']],
    ];

    for (const [name, above] of SHAPES) {
        it(`goes in the body with ${name}, and the series goes on`, async () => {
            const { contents, session } = await open([...above, ROW, '']);

            await fire(session);

            expect(contents.get(FILE)!.split('\n')).toEqual([...above, NEXT, DONE, '']);
            expect(Notice.messages).toEqual([]);
            // The next instance is a task the index reads, carrying the command.
            const next = tasksWorded(session, '対象').filter(task => task.statusChar === ' ');
            expect(next).toHaveLength(1);
            expect(next[0].flow?.raw).toContain('every mon');
        });
    }
});

describe('a note that opens with a byte order mark', () => {
    // Obsidian's `read` takes the mark off and `process` hands it over, so the
    // scan and the write read line 0 differently; and the next instance took
    // its indentation from line 0 — the mark with it — and went in above it.
    it('keeps one mark, at the start, when its first line fires', async () => {
        const { contents, session } = await open(['\uFEFF' + ROW, '\t- [ ] 子', '']);

        await fire(session);

        const text = contents.get(FILE)!;
        expect(text.split('\uFEFF')).toHaveLength(2);
        expect(text).toBe(['\uFEFF' + NEXT, DONE, '\t- [ ] 子', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
        // The tab child is read under the row that fired, which the mark on
        // its line once made as deep as the child.
        const [child] = tasksWorded(session, '子');
        expect(child.parentId).toBe(tasksWorded(session, '対象').find(task => task.statusChar === 'x')!.id);
    });
});

describe('a next instance with nowhere in the body to go', () => {
    it('is refused whole: nothing written, the command kept, one notice', async () => {
        // The row's group is under the item it stands in, and the line just
        // below that item's own is inside the fence the item opens on it.
        const note = ['# note', '- ```', '  x', '  ```', `  ${ROW}`, ''];
        const { contents, session } = await open(note);
        const before = contents.get(FILE);
        const [row] = tasksWorded(session, '対象');

        expect(await session.index.updateTask(row.id, { statusChar: 'x' })).toBe(true);
        await session.flowSettled(FILE);

        const checked = before!.replace('  - [ ] 対象', '  - [x] 対象');
        expect(contents.get(FILE)).toBe(checked);
        expect(Notice.messages).toEqual([t('notice.flowNotRun', { reason: t('notice.refusedUnplaceable'), subject: '対象' })]);
    });

    it('goes at the top of its run when a fence it stands after is closed above it', async () => {
        // Two columns in under nothing is an item at the top (Obsidian,
        // measurement.md q3), and a closed fence above ends its run. The old
        // depth reading took the group to be under `x`, in the fence, and
        // refused.
        const note = ['# note', '```', 'x', '   ```', `  ${ROW}`, ''];
        const { contents, session } = await open(note);

        await fire(session);

        expect(contents.get(FILE)).toBe(
            ['# note', '```', 'x', '   ```', '  - [ ] 対象 @2026-09-28 ==> every mon', '  - [x] 対象 @2026-09-21', ''].join('\n'),
        );
        expect(Notice.messages).toEqual([]);
    });

    it('goes under the item it stands in when a fence in that item takes a shallower line (Obsidian, measurement.md q1)', async () => {
        // `\tx` goes on Q's fence, so the row is Q's child and its group is
        // under Q, above the fence. The old depth reading took the group to be
        // under `\tx`, in the fence, and refused.
        const note = ['# note', '- [ ] P', '\t- [ ] Q', '\t\t```', '\tx', '\t\t```', `\t\t${ROW}`, ''];
        const { contents, session } = await open(note);

        await fire(session);

        expect(contents.get(FILE)).toBe([
            '# note', '- [ ] P', '\t- [ ] Q', '\t\t- [ ] 対象 @2026-09-28 ==> every mon',
            '\t\t```', '\tx', '\t\t```', '\t\t- [x] 対象 @2026-09-21', '',
        ].join('\n'));
        expect(Notice.messages).toEqual([]);
    });

    describe('a copy of a subtree whose fence never closes (BK3)', () => {
        // A fence in an item ends with the item (`Outline.read`), and what
        // ends the item is a line that starts a block of its own. A copy is
        // an item, and what follows it is the original's own line (a copy
        // put above) or what followed the original (a copy put after): each
        // ends the copy's fence as it ended the original's. The copy used to
        // be refused, when a fence that never closed ran on to the end.
        async function duplicated(note: string[], options?: { dayOffset: number; count?: number }) {
            const { contents, session } = await open(note);
            const [row] = tasksWorded(session, note[1].slice(6).split(' @')[0]);
            expect(await session.index.duplicateTask(row.id, options)).toBe(true);
            await session.settle(FILE);
            expect(Notice.messages).toEqual([]);
            const tasks = session.index.getTasks().filter(task => task.file === FILE);
            return {
                lines: contents.get(FILE)!.split('\n'),
                tasks: tasks.map(task => [task.line, task.content, task.startDate || null]),
                original: session.index.getTask(row.id),
            };
        }

        it('writes copies above the original, which stays a task with its ID, and the rows below too', async () => {
            const { lines, tasks, original } = await duplicated(
                ['# note', '- [ ] T @2026-09-21', '  ```', '- [ ] U', '- [ ] V', ''], { dayOffset: 1, count: 2 });

            expect(lines).toEqual([
                '# note',
                '- [ ] T @2026-09-23', '  ```',
                '- [ ] T @2026-09-22', '  ```',
                '- [ ] T @2026-09-21', '  ```',
                '- [ ] U', '- [ ] V', '',
            ]);
            expect(tasks).toEqual([
                [1, 'T', '2026-09-23'], [3, 'T', '2026-09-22'], [5, 'T', '2026-09-21'], [7, 'U', null], [8, 'V', null],
            ]);
            expect(original?.line).toBe(5);
        });

        it('writes a copy above the original when the fence is a child\'s and a shallow line goes on it', async () => {
            const { lines, tasks, original } = await duplicated(
                ['# note', '- [ ] T @2026-09-21', '    - [ ] c', '      ```', 'x', '- [ ] U', ''], { dayOffset: 1 });

            expect(lines).toEqual([
                '# note',
                '- [ ] T @2026-09-22', '    - [ ] c', '      ```', 'x',
                '- [ ] T @2026-09-21', '    - [ ] c', '      ```', 'x',
                '- [ ] U', '',
            ]);
            expect(tasks.map(([line, content]) => [line, content])).toEqual([
                [1, 'T'], [2, 'c'], [5, 'T'], [6, 'c'], [9, 'U'],
            ]);
            expect(original?.line).toBe(5);
        });

        it('writes a copy after the subtree, before the sibling that ends the fence (R5)', async () => {
            const { lines, tasks, original } = await duplicated(
                ['# note', '- [ ] root', '    ```', '    body', '- [ ] sibling', '']);

            expect(lines).toEqual([
                '# note',
                '- [ ] root', '    ```', '    body',
                '- [ ] root', '    ```', '    body',
                '- [ ] sibling', '',
            ]);
            expect(tasks.map(([line, content]) => [line, content])).toEqual([[1, 'root'], [4, 'root'], [7, 'sibling']]);
            expect(original?.line).toBe(1);
        });
    });

    it('refuses a move to the end of a note that ends inside a fence that never closes', async () => {
        // Appended past the opening line, the row and its child would be code.
        const note = ['# note', '- [ ] 対象 @2026-09-21 ==> move()', '\t- [ ] 子', '```', 'code', ''];
        const { contents, session } = await open(note);
        const before = contents.get(FILE)!;

        await fire(session);

        expect(contents.get(FILE)).toBe(before.replace('- [ ] 対象', '- [x] 対象'));
        // The notice names the fence: the line that opens it, as the note stands.
        expect(Notice.messages).toEqual([t('notice.flowNotRun', { reason: t('notice.refusedUnplaceableInFence', { line: 4 }), subject: '対象' })]);
    });
});

describe('the end of a note', () => {
    it('keeps its final terminator when a move carries a row there', async () => {
        const note = ['# note', '- [ ] 対象 @2026-09-21 ==> move()', '\t- [ ] 子', '- [ ] 下', ''];
        const { contents, session } = await open(note);

        await fire(session);

        expect(contents.get(FILE)).toBe(['# note', '- [ ] 下', '- [x] 対象 @2026-09-21', '\t- [ ] 子', ''].join('\n'));
    });
});

describe('a line put past a fence in a list item that never closes', () => {
    // Q's fence never closes and `x` goes on it (Obsidian, measurement.md
    // q14). Every write that puts a line there puts one that starts a block of
    // its own, which ends Q's item and its fence (Placement's precondition).
    const NOTE = ['# note', '- [ ] P', '  - [ ] Q', '    ```', 'x', ''];

    async function written(write: (session: VaultSession) => Promise<unknown>) {
        const { contents, session } = await open(NOTE);
        await write(session);
        await session.settle(FILE);
        expect(Notice.messages).toEqual([]);
        return {
            lines: contents.get(FILE)!.split('\n'),
            tasks: session.index.getTasks().map(task => [task.line, task.content]),
        };
    }
    const idOf = (session: VaultSession, content: string) => tasksWorded(session, content)[0].id;

    it('reads a sibling put past Q as a task', async () => {
        const { lines, tasks } = await written(session => session.index.insertLine(idOf(session, 'Q'), '- [x] rec', 'afterSubtree'));
        expect(lines).toEqual(['# note', '- [ ] P', '  - [ ] Q', '    ```', 'x', '  - [x] rec', '']);
        expect(tasks).toEqual([[1, 'P'], [2, 'Q'], [5, 'rec']]);
    });

    it('reads a task appended to the note as a task', async () => {
        const { lines, tasks } = await written(session => session.index.createTask(FILE, '- [ ] new'));
        expect(lines).toEqual(['# note', '- [ ] P', '  - [ ] Q', '    ```', 'x', '- [ ] new', '']);
        expect(tasks).toEqual([[1, 'P'], [2, 'Q'], [5, 'new']]);
    });

    // Older than L2 (F4's R5, the part left): a child of the item whose own
    // fence never closes went past the fence, on it. P1 puts it above the
    // item's own fence, where it reads as a task.
    it('reads a child put under the item whose own fence never closes as a task, or writes nothing (P1)', async () => {
        const { contents, session } = await open(['# note', '- [ ] T', '    ```', '    code', '- [ ] U', '']);
        const before = contents.get(FILE)!;

        await session.index.insertLine(tasksWorded(session, 'T')[0].id, '- [ ] c', 'firstChild');
        await session.settle(FILE);

        // Either the child is a task, or nothing is written and the user hears why.
        const written = contents.get(FILE) !== before;
        if (written) expect(tasksWorded(session, 'c')).toHaveLength(1);
        else expect(Notice.messages).toEqual([t('notice.writeTargetUnplaceable', { subject: 'T' })]);
        // As it stands, it is written above the fence.
        expect(written).toBe(true);
        expect(contents.get(FILE)!.split('\n').slice(1, 4)).toEqual(['- [ ] T', '    - [ ] c', '    ```']);
    });

    it('reads a task written under a heading made at the end as a task', async () => {
        const { lines, tasks } = await written(session => session.index.createTask(FILE, '- [ ] new', 'H'));
        expect(lines).toEqual(['# note', '- [ ] P', '  - [ ] Q', '    ```', 'x', '', '## H', '- [ ] new', '']);
        expect(tasks).toEqual([[1, 'P'], [2, 'Q'], [7, 'new']]);
    });
});
