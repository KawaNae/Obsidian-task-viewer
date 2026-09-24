import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { t } from '../../../src/i18n';

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
    const opened = await openVault(lines);
    live = opened.session;
    return opened;
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
        expect(Notice.messages).toEqual([t('notice.writeTargetUnplaceable', { subject: '対象' })]);
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

    it('refuses a copy that would carry a fence it never closes above the original', async () => {
        // The subtree's fence never closes, so the subtree is read by depth
        // alone; a copy of it put above T would fence T and everything after.
        const note = ['# note', '- [ ] T @2026-09-21', '  ```', '- [ ] U', '- [ ] V', ''];
        const { contents, session } = await open(note);
        const before = contents.get(FILE)!;
        const [row] = session.index.getTasks().filter(task => task.content === 'T');

        await session.index.duplicateTask(row.id, { dayOffset: 1 });
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(before);
        expect(session.index.getTask(row.id)?.content).toBe('T');
        expect(Notice.messages).toEqual([t('notice.writeTargetUnplaceable', { subject: 'T' })]);
    });

    it('refuses a move to the end of a note that ends inside a fence that never closes', async () => {
        // Appended past the opening line, the row and its child would be code.
        const note = ['# note', '- [ ] 対象 @2026-09-21 ==> move([[note]])', '\t- [ ] 子', '```', 'code', ''];
        const { contents, session } = await open(note);
        const before = contents.get(FILE)!;

        await fire(session);

        expect(contents.get(FILE)).toBe(before.replace('- [ ] 対象', '- [x] 対象'));
        expect(Notice.messages).toEqual([t('notice.writeTargetUnplaceable', { subject: '対象' })]);
    });
});

describe('the end of a note', () => {
    it('keeps its final terminator when a move carries a row there', async () => {
        const note = ['# note', '- [ ] 対象 @2026-09-21 ==> move([[note]])', '\t- [ ] 子', '- [ ] 下', ''];
        const { contents, session } = await open(note);

        await fire(session);

        expect(contents.get(FILE)).toBe(['# note', '- [ ] 下', '- [x] 対象 @2026-09-21', '\t- [ ] 子', ''].join('\n'));
    });
});
