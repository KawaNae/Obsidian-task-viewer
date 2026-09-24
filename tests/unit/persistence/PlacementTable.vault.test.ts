import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { t } from '../../../src/i18n';

/**
 * Every write that adds lines, one row of the P1 table each
 * (`stages\p1-placement\design.md`): where the line goes (`Placement`), and
 * the check the write is held to (`checkWrite`) — the line put in is a
 * task under the item meant, outside code, and every task already there
 * keeps its parent. Or nothing is written, and the user hears why.
 *
 * Each note is read back by the index. `parents` answers every task's
 * parent by content, so a write that gave an existing task another parent,
 * or made one no task, shows as a difference from the parents before plus
 * the one line added.
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

function only(session: VaultSession, content: string) {
    const found = session.index.getTasks().filter(task => task.file === FILE && task.content === content);
    expect(found, content).toHaveLength(1);
    return found[0];
}

/** Each task's content, and its parent's (null at the top), in file order. */
function parents(session: VaultSession): Array<[string, string | null]> {
    const tasks = session.index.getTasks().filter(task => task.file === FILE).sort((a, b) => a.line - b.line);
    const byId = new Map(tasks.map(task => [task.id, task]));
    return tasks.map(task => [task.content, task.parentId ? byId.get(task.parentId)?.content ?? '?' : null]);
}

function lines(contents: Map<string, string>): string[] {
    return contents.get(FILE)!.split('\n');
}

describe('the editor\'s duplicate (insertLineAfterLine, copyOf)', () => {
    it('is spelled as the row it copies, not as the sibling below it', async () => {
        const { contents, session } = await open(['# n', '- [ ] P', '\t- [ ] T', '    - [ ] V', '']);

        expect(await session.index.insertLineAfterLine(FILE, { line: 2, text: '\t- [ ] T' }, '\t- [ ] T')).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] P', '\t- [ ] T', '\t- [ ] T', '    - [ ] V', '']);
        expect(parents(session)).toEqual([['P', null], ['T', 'P'], ['T', 'P'], ['V', 'P']]);
    });

    it('goes past the row\'s subtree, so the row keeps its children (counterexample 5)', async () => {
        const { contents, session } = await open(['# n', '- [ ] P', '\t- [ ] T', '      - [ ] c', '- [ ] U', '']);
        expect(parents(session)).toEqual([['P', null], ['T', 'P'], ['c', 'T'], ['U', null]]);

        expect(await session.index.insertLineAfterLine(FILE, { line: 2, text: '\t- [ ] T' }, '\t- [ ] T')).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] P', '\t- [ ] T', '      - [ ] c', '\t- [ ] T', '- [ ] U', '']);
        expect(parents(session)).toEqual([['P', null], ['T', 'P'], ['c', 'T'], ['T', 'P'], ['U', null]]);
        const [original] = session.index.getTasks().filter(task => task.content === 'T').sort((a, b) => a.line - b.line);
        expect(only(session, 'c').parentId).toBe(original.id);
    });
});

describe('the day-shifted duplicate (duplicateInlineTask, copyOf)', () => {
    it('goes above the row, a copy of its subtree, and the row keeps its children', async () => {
        const { contents, session } = await open(['# n', '- [ ] P', '    - [ ] T @2026-09-21', '\t    - [ ] c', '- [ ] U', '']);
        expect(parents(session)).toEqual([['P', null], ['T', 'P'], ['c', 'T'], ['U', null]]);

        expect(await session.index.duplicateTask(only(session, 'T').id, { dayOffset: 1 })).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual([
            '# n', '- [ ] P', '    - [ ] T @2026-09-22', '\t    - [ ] c', '    - [ ] T @2026-09-21', '\t    - [ ] c', '- [ ] U', '',
        ]);
        expect(parents(session)).toEqual([['P', null], ['T', 'P'], ['c', 'T'], ['T', 'P'], ['c', 'T'], ['U', null]]);
    });
});

describe('the in-place duplicate (duplicateInlineTaskInPlace, copyOf)', () => {
    // The third run's a: spelled as U, the copy would lose its copied child.
    it('is spelled as the row it copies, so the copied child stays the copy\'s', async () => {
        const { contents, session } = await open(['# n', '-\t[ ] T', '\t- [ ] c', '   - [ ] U', '']);
        expect(parents(session)).toEqual([['T', null], ['c', 'T'], ['U', null]]);

        expect(await session.index.duplicateTask(only(session, 'T').id)).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '-\t[ ] T', '\t- [ ] c', '-\t[ ] T', '\t- [ ] c', '   - [ ] U', '']);
        expect(parents(session)).toEqual([['T', null], ['c', 'T'], ['T', null], ['c', 'T'], ['U', null]]);
    });

    it('goes past the subtree, before the sibling that ends the row\'s fence', async () => {
        const { contents, session } = await open(['# n', '- [ ] T', '  ```', '  code', '- [ ] U', '']);

        expect(await session.index.duplicateTask(only(session, 'T').id)).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] T', '  ```', '  code', '- [ ] T', '  ```', '  code', '- [ ] U', '']);
        expect(parents(session)).toEqual([['T', null], ['T', null], ['U', null]]);
    });
});

describe('a task created under a heading (insertUnderHeading)', () => {
    it('goes past the paragraph under the heading, which would otherwise go on the new task', async () => {
        const { contents, session } = await open(['## H', 'some words', '- [ ] A', '']);

        expect(await session.index.createTask(FILE, '- [ ] N', 'H')).not.toBeNull();
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['## H', 'some words', '- [ ] N', '- [ ] A', '']);
        expect(parents(session)).toEqual([['N', null], ['A', null]]);
    });

    it('makes the heading at the end of a note that is only frontmatter, and of an empty note', async () => {
        for (const note of [['---', 'a: 1', '---', ''], ['']]) {
            live?.dispose();
            const { contents, session } = await open(note);

            expect(await session.index.createTask(FILE, '- [ ] N', 'H')).not.toBeNull();
            await session.settle(FILE);

            expect(lines(contents).slice(-3)).toEqual(['## H', '- [ ] N', '']);
            expect(parents(session)).toEqual([['N', null]]);
        }
    });
});

describe('a property line (ChildPropertyLineEditor.applyOps)', () => {
    it('goes past the task\'s text that goes on, as its first child', async () => {
        const { contents, session } = await open(['# n', '- [ ] T', 'lazy words', '- [ ] U', '']);

        expect(await session.index.updateTask(only(session, 'T').id, { properties: { memo: { value: 'x', type: 'string' } } } as never)).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] T', 'lazy words', '\t- memo:: x', '- [ ] U', '']);
        expect(only(session, 'T').properties?.memo?.value).toBe('x');
    });

    it('goes past the last property\'s subtree, as its sibling, tab and spaces mixed', async () => {
        const { contents, session } = await open(['# n', '- [ ] P', '    - [ ] T', '\t    - a:: 1', '\t      - note', '- [ ] U', '']);

        expect(await session.index.updateTask(only(session, 'T').id, { properties: { a: { value: '1', type: 'number' }, b: { value: '2', type: 'number' } } } as never)).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] P', '    - [ ] T', '\t    - a:: 1', '\t      - note', '\t    - b:: 2', '- [ ] U', '']);
        expect(only(session, 'T').properties?.b?.value).toBe('2');
    });
});

describe('the next instance (insert-instance, groupHead)', () => {
    it('writes the command a child of the line written, so the series goes on (the `==>` half of H2)', async () => {
        const { contents, session } = await open(['# n', '1.    [ ] 対象 @2026-09-21', '      - ==> every mon', '']);

        expect(await session.index.updateTask(only(session, '対象').id, { statusChar: 'x' })).toBe(true);
        await session.flowSettled(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] 対象 @2026-09-28', '    - ==> every mon', '1.    [x] 対象 @2026-09-21', '']);
        const next = session.index.getTasks().find(task => task.line === 1)!;
        expect(next.flow?.program).toBeTruthy();
        expect(Notice.messages).toEqual([]);
    });

    it('goes under the parent past its text that goes on', async () => {
        const { contents, session } = await open(['# n', '- [ ] P', '  words', '  - [ ] 対象 @2026-09-21 ==> every mon', '']);

        expect(await session.index.updateTask(only(session, '対象').id, { statusChar: 'x' })).toBe(true);
        await session.flowSettled(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] P', '  words', '  - [ ] 対象 @2026-09-28 ==> every mon', '  - [x] 対象 @2026-09-21', '']);
        expect(parents(session)).toEqual([['P', null], ['対象', 'P'], ['対象', 'P']]);
    });
});

describe('a move within the note (move-to-end, end)', () => {
    it('writes nothing when taking the task away would put a task below under another', async () => {
        const { contents, session } = await open(['# n', '- [x] a', ' - [ ] X @2026-09-21 ==> move([[note]])', '  1. [ ] u', '']);
        // ` - [ ] X` stands at the top; `  1. [ ] u` is no child of it (its
        // content is at 3). Taken away, X leaves u under a.
        expect(parents(session)).toEqual([['a', null], ['X', null], ['u', null]]);
        const before = contents.get(FILE);

        await session.index.updateTask(only(session, 'X').id, { statusChar: 'x' });
        await session.flowSettled(FILE);

        // The completion is written; the fire's write is not.
        expect(contents.get(FILE)).toBe(before!.replace(' - [ ] X', ' - [x] X'));
        expect(Notice.messages).toEqual([t('notice.writeDisturbs', { subject: 'X' })]);
    });
});

describe('a last child (insertLineAfterTask, lastChild)', () => {
    it('goes past the subtree at the children\'s indentation', async () => {
        const { contents, session } = await open(['# n', '- [ ] T', '  - [ ] a', '  lazy', '- [ ] U', '']);

        expect(await session.index.appendChildTask(only(session, 'T').id, '- [ ] c')).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] T', '  - [ ] a', '  lazy', '  - [ ] c', '- [ ] U', '']);
        expect(parents(session)).toEqual([['T', null], ['a', 'T'], ['c', 'T'], ['U', null]]);
    });
});

describe('a sibling (insertSiblingAfterTask, afterSubtree and afterCompletedRun)', () => {
    // The first run's B1: a new line, spelled as the item next to it. At
    // T's spelling, `- ` at the top, it would take U in.
    it('is spelled as the sibling below it, not as the row', async () => {
        const { contents, session } = await open(['# n', '1. [ ] T', '  - [ ] U', '']);
        expect(parents(session)).toEqual([['T', null], ['U', null]]);

        expect(await session.index.insertSiblingAfterTask(only(session, 'T').id, '- [x] rec')).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '1. [ ] T', '  - [x] rec', '  - [ ] U', '']);
        expect(parents(session)).toEqual([['T', null], ['rec', null], ['U', null]]);
    });

    it('goes past the completed run, at the indentation of the last of it', async () => {
        const { contents, session } = await open(['# n', '- [ ] P', '\t- [ ] T', '    - [x] r1', '\t\t- note', '- [ ] U', '']);

        expect(await session.index.insertSiblingAfterTask(only(session, 'T').id, '- [x] r2', { afterCompletedRun: true })).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] P', '\t- [ ] T', '    - [x] r1', '\t\t- note', '    - [x] r2', '- [ ] U', '']);
        expect(parents(session)).toEqual([['P', null], ['T', 'P'], ['r1', 'P'], ['r2', 'P'], ['U', null]]);
    });

    it('goes above a fence at the top that never closes, which ends the row', async () => {
        const { contents, session } = await open(['# n', '- [ ] T', '```', 'x', '']);

        expect(await session.index.insertSiblingAfterTask(only(session, 'T').id, '- [x] rec')).toBe(true);
        await session.settle(FILE);

        // T's subtree is its own line (the fence at column 0 ends T): the
        // sibling goes above the fence, a task.
        expect(lines(contents)).toEqual(['# n', '- [ ] T', '- [x] rec', '```', 'x', '']);
        expect(parents(session)).toEqual([['T', null], ['rec', null]]);
    });
});

describe('siblings spelled at different columns (the P1 counterexample run\'s C)', () => {
    it('put a record past the run at the last one\'s indentation, not under it', async () => {
        // T and U are both P's children, four and two columns in; c is U's.
        const { contents, session } = await open(['# n', '- [ ] P', '    - [x] T', '  - [x] U', '    - [ ] c', '']);
        expect(parents(session)).toEqual([['P', null], ['T', 'P'], ['U', 'P'], ['c', 'U']]);

        expect(await session.index.insertSiblingAfterTask(only(session, 'T').id, '- [x] N', { afterCompletedRun: true })).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] P', '    - [x] T', '  - [x] U', '    - [ ] c', '  - [x] N', '']);
        expect(parents(session)).toEqual([['P', null], ['T', 'P'], ['U', 'P'], ['c', 'U'], ['N', 'P']]);
    });

    it('put the next instance at the head of the group at the head\'s indentation', async () => {
        const { contents, session } = await open(['# n', '- note', '1. [ ] A', '  - [ ] 対象 @2026-09-21 ==> every mon', '']);
        expect(parents(session)).toEqual([['A', null], ['対象', null]]);

        expect(await session.index.updateTask(only(session, '対象').id, { statusChar: 'x' })).toBe(true);
        await session.flowSettled(FILE);

        expect(lines(contents)).toEqual(['# n', '- note', '- [ ] 対象 @2026-09-28 ==> every mon', '1. [ ] A', '  - [x] 対象 @2026-09-21', '']);
        expect(Notice.messages).toEqual([]);
    });
});

describe('text past a blank line that a line put above would take in (the P1 counterexample run\'s A)', () => {
    it('puts a first child past the task\'s code below a blank line', async () => {
        const { contents, session } = await open(['# n', '- [ ] T', '', '\t\tcode', '- [ ] U', '']);

        expect(await session.index.insertChildTask(only(session, 'T').id, '- [ ] c')).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] T', '', '\t\tcode', '\t- [ ] c', '- [ ] U', '']);
        expect(parents(session)).toEqual([['T', null], ['c', 'T'], ['U', null]]);
    });

    it('puts a line under a heading past the code below a blank line', async () => {
        const { contents, session } = await open(['## H', '', '    code', '- [ ] A', '']);

        expect(await session.index.createTask(FILE, '- [ ] N', 'H')).not.toBeNull();
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['## H', '', '    code', '- [ ] N', '- [ ] A', '']);
    });

    it('puts the next instance under its parent past the parent\'s second paragraph, so the series goes on', async () => {
        const { contents, session } = await open(['# n', '- [ ] P', '', '    desc', '  - [ ] 対象 @2026-09-21 ==> every mon', '']);

        expect(await session.index.updateTask(only(session, '対象').id, { statusChar: 'x' })).toBe(true);
        await session.flowSettled(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] P', '', '    desc', '  - [ ] 対象 @2026-09-28 ==> every mon', '  - [x] 対象 @2026-09-21', '']);
        expect(Notice.messages).toEqual([]);
    });

    it('stops before a blank line past which the text is shallower than the line put', async () => {
        const { contents, session } = await open(['# n', '- [ ] T', '', '  para', '']);

        expect(await session.index.insertChildTask(only(session, 'T').id, '- [ ] c')).toBe(true);
        await session.settle(FILE);

        // The file's unit is four spaces (its first indented line).
        expect(lines(contents)).toEqual(['# n', '- [ ] T', '    - [ ] c', '', '  para', '']);
    });
});

describe('a first child (insertLineAsFirstChild, firstChild)', () => {
    it('goes below the task, before its children, in an indented fence\'s item', async () => {
        const { contents, session } = await open(['# n', '- [ ] P', '  - [ ] T', '    ```', '    x', '    ```', '- [ ] U', '']);

        expect(await session.index.insertChildTask(only(session, 'T').id, '- [ ] c')).toBe(true);
        await session.settle(FILE);

        // No child item to copy: T's indentation and the file's unit (four
        // spaces, its first indented line's).
        expect(lines(contents)).toEqual(['# n', '- [ ] P', '  - [ ] T', '      - [ ] c', '    ```', '    x', '    ```', '- [ ] U', '']);
        expect(parents(session)).toEqual([['P', null], ['T', 'P'], ['c', 'T'], ['U', null]]);
    });
});

describe('an append (appendTaskToFile, end)', () => {
    it('goes past the frontmatter of a note that is only frontmatter, and into an empty note', async () => {
        for (const note of [['---', 'a: 1', '---', ''], ['']]) {
            live?.dispose();
            const { contents, session } = await open(note);

            expect(await session.index.createTask(FILE, '- [ ] N')).not.toBeNull();
            await session.settle(FILE);

            expect(lines(contents).slice(-2)).toEqual(['- [ ] N', '']);
            expect(parents(session)).toEqual([['N', null]]);
        }
    });

    it('writes nothing into a fence at the top that never closes, and says why', async () => {
        const { contents, session } = await open(['- [ ] A', '```', 'code', '']);
        const before = contents.get(FILE);

        expect(await session.index.createTask(FILE, '- [ ] N')).toBeNull();
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(before);
        expect(Notice.messages).toEqual([t('notice.writeTargetUnplaceable', { subject: '- [ ] N' })]);
    });
});

describe('a delete (deleteTask), held to the same check', () => {
    it('writes nothing when a task below would stand under another', async () => {
        // The P1 probe's shape B: without ` - [ ] t`, `  1. [ ] u` is a's child.
        const { contents, session } = await open(['# n', '- [x] a', ' - [ ] t', '  1. [ ] u', '']);
        expect(parents(session)).toEqual([['a', null], ['t', null], ['u', null]]);
        const before = contents.get(FILE);

        await session.index.deleteTask(only(session, 't').id);
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(before);
        expect(Notice.messages).toEqual([t('notice.writeDisturbs', { subject: 't' })]);
    });
});

describe('the two readings L3 made CommonMark\'s: a quote after an item, an ordered line in a paragraph', () => {
    // `> quote` ends T (G): T's subtree is its own line, and c is at the top.
    const QUOTE = ['# n', '- [ ] T', '> quote', '  - [ ] c', ''];

    it('deletes a task a quote ends as its own line, and leaves the quote and the line below', async () => {
        const { contents, session } = await open(QUOTE);
        expect(parents(session)).toEqual([['T', null], ['c', null]]);

        await session.index.deleteTask(only(session, 'T').id);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '> quote', '  - [ ] c', '']);
        expect(parents(session)).toEqual([['c', null]]);
    });

    it('copies a task a quote ends without the quote, and puts the copy above it', async () => {
        const { contents, session } = await open(QUOTE);

        expect(await session.index.duplicateTask(only(session, 'T').id)).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] T', '- [ ] T', '> quote', '  - [ ] c', '']);
        expect(parents(session)).toEqual([['T', null], ['T', null], ['c', null]]);
    });

    it('puts a child of a task a quote ends above the quote', async () => {
        const { contents, session } = await open(QUOTE);

        expect(await session.index.appendChildTask(only(session, 'T').id, '- [ ] n')).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] T', '    - [ ] n', '> quote', '  - [ ] c', '']);
        expect(parents(session)).toEqual([['T', null], ['n', 'T'], ['c', null]]);
    });

    it('copies s3#18255 in place, the empty item underlining t2 going with it', async () => {
        const { contents, session } = await open(['# n', '- [ ] t2', '  -', '> text', '  -  [ ] t8', '']);
        expect(parents(session)).toEqual([['t2', null], ['t8', null]]);

        expect(await session.index.duplicateTask(only(session, 't2').id)).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] t2', '  -', '- [ ] t2', '  -', '> text', '  -  [ ] t8', '']);
        expect(parents(session)).toEqual([['t2', null], ['t2', null], ['t8', null]]);
    });

    it('puts a child of s3#18255\'s t2 past the empty item underlining it, above the quote', async () => {
        const { contents, session } = await open(['# n', '- [ ] t2', '  -', '> text', '  -  [ ] t8', '']);

        expect(await session.index.appendChildTask(only(session, 't2').id, '- [ ] n')).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] t2', '  -', '    - [ ] n', '> text', '  -  [ ] t8', '']);
        expect(parents(session)).toEqual([['t2', null], ['n', 't2'], ['t8', null]]);
    });

    // `  2. [ ] T` goes on P's text: no task, and c is P's child.
    const ORDERED = ['# n', '- [ ] P', '  2. [ ] T', '  - [ ] c', ''];

    it('reads an ordered line not starting at 1 in a task\'s text as the text, not a task', async () => {
        const { session } = await open(ORDERED);
        expect(parents(session)).toEqual([['P', null], ['c', 'P']]);
    });

    it('puts a last child past the subtree of a task whose text goes on as an ordered line', async () => {
        const { contents, session } = await open(ORDERED);

        expect(await session.index.appendChildTask(only(session, 'P').id, '- [ ] l')).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] P', '  2. [ ] T', '  - [ ] c', '  - [ ] l', '']);
        expect(parents(session)).toEqual([['P', null], ['c', 'P'], ['l', 'P']]);
    });

    it('puts a first child past the ordered line, which goes on in the task\'s text', async () => {
        // A line put between P and `  2. [ ] T` would end P's paragraph, and
        // the ordered line after it would open an item: the child goes below
        // it, where P's text has ended.
        const { contents, session } = await open(ORDERED);

        expect(await session.index.insertChildTask(only(session, 'P').id, '- [ ] f')).toBe(true);
        await session.settle(FILE);

        expect(lines(contents)).toEqual(['# n', '- [ ] P', '  2. [ ] T', '  - [ ] f', '  - [ ] c', '']);
        expect(parents(session)).toEqual([['P', null], ['f', 'P'], ['c', 'P']]);
        expect(Notice.messages).toEqual([]);
    });

    // Each goes on in T's text, and would open an item below a line put
    // between: a first child, a last child of a task with none, and a
    // property all go below it.
    describe.each(['  1.', '  2. [ ] U', '  -', '  *'])('past `%s`, T\'s text', tail => {
        const NOTE = ['# n', '- [ ] T', tail, '- [ ] V', ''];

        it('puts a first child', async () => {
            const { contents, session } = await open(NOTE);

            expect(await session.index.insertChildTask(only(session, 'T').id, '- [ ] f')).toBe(true);
            await session.settle(FILE);

            expect(lines(contents)).toEqual(['# n', '- [ ] T', tail, '    - [ ] f', '- [ ] V', '']);
            expect(parents(session)).toEqual([['T', null], ['f', 'T'], ['V', null]]);
        });

        it('puts a last child', async () => {
            const { contents, session } = await open(NOTE);

            expect(await session.index.appendChildTask(only(session, 'T').id, '- [ ] l')).toBe(true);
            await session.settle(FILE);

            expect(lines(contents)).toEqual(['# n', '- [ ] T', tail, '    - [ ] l', '- [ ] V', '']);
            expect(parents(session)).toEqual([['T', null], ['l', 'T'], ['V', null]]);
        });

        it('puts a property', async () => {
            const { contents, session } = await open(NOTE);

            expect(await session.index.updateTask(only(session, 'T').id, { properties: { memo: { value: 'x', type: 'string' } } } as never)).toBe(true);
            await session.settle(FILE);

            expect(lines(contents)).toEqual(['# n', '- [ ] T', tail, '    - memo:: x', '- [ ] V', '']);
            expect(only(session, 'T').properties?.memo?.value).toBe('x');
        });
    });

    it('deletes and copies the ordered line with the task whose text it is', async () => {
        const { contents, session } = await open(ORDERED);

        expect(await session.index.duplicateTask(only(session, 'P').id)).toBe(true);
        await session.settle(FILE);
        expect(lines(contents)).toEqual(['# n', '- [ ] P', '  2. [ ] T', '  - [ ] c', '- [ ] P', '  2. [ ] T', '  - [ ] c', '']);

        const [first] = session.index.getTasks().filter(task => task.content === 'P').sort((a, b) => a.line - b.line);
        await session.index.deleteTask(first.id);
        await session.settle(FILE);
        expect(lines(contents)).toEqual(['# n', '- [ ] P', '  2. [ ] T', '  - [ ] c', '']);
        expect(parents(session)).toEqual([['P', null], ['c', 'P']]);
    });
});
