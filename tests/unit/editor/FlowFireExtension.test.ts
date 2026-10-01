import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { editorSession } from '../helpers/editorSession';
import { t } from '../../../src/i18n';
import { freezeDate } from '../helpers/fakeDate';

/**
 * A completion made in the editor fires in the transaction that made it
 * (`fireFilter`): planned from the document the transaction leaves,
 * written into the same transaction, and nothing else in the editor fires.
 */

// `every` lands on the first grid point after the later of today and the
// row's date: today is held on the Friday the dates below are read from.
freezeDate(new Date(2026, 8, 25, 12, 0, 0));

const FILE = 'note.md';

let live: VaultSession | undefined;

beforeEach(() => {
    Notice.messages.length = 0;
});

afterEach(() => {
    live?.dispose();
    live = undefined;
});

async function open(files: Record<string, string[]>) {
    const opened = await openVault(files);
    live = opened.session;
    const editor = editorSession(opened.session.ops.editorFireHost(), FILE, opened.contents.get(FILE)!);
    return { ...opened, editor };
}

describe('a completion made in the editor', () => {
    it('fires in its own transaction: the next instance, and the command consumed', async () => {
        const { editor } = await open({ [FILE]: ['# note', '- [ ] T @2026-09-21 ==> every mon', '- [ ] U', ''] });

        const tr = editor.check(1);

        expect(editor.lines()).toEqual(['# note', '- [ ] T @2026-09-28 ==> every mon', '- [x] T @2026-09-21', '- [ ] U', '']);
        expect(editor.transactions).toEqual([tr]);
        // The cursor stays on the row it completed, past the `x`.
        expect(editor.state.selection.main.head).toBe(editor.at(2, 4));
    });

    it('fires every row the transaction completed', async () => {
        const { editor } = await open({ [FILE]: ['- [ ] A @2026-09-21 ==> every mon', '- [ ] B @2026-09-21 ==> every tue', ''] });

        editor.change([
            { from: editor.at(0, 3), to: editor.at(0, 4), insert: 'x' },
            { from: editor.at(1, 3), to: editor.at(1, 4), insert: 'x' },
        ], 'input.type');

        // Each next instance goes in at the head of the group.
        expect(editor.lines()).toEqual([
            '- [ ] B @2026-09-29 ==> every tue', '- [ ] A @2026-09-28 ==> every mon',
            '- [x] A @2026-09-21', '- [x] B @2026-09-21', '',
        ]);
    });

    it('fires nothing for a transaction that is no operation', async () => {
        for (const mark of ['set', 'undo', 'redo']) {
            const { editor } = await open({ [FILE]: ['- [ ] T @2026-09-21 ==> every mon', ''] });
            editor.check(0, mark);
            expect(editor.lines()).toEqual(['- [x] T @2026-09-21 ==> every mon', '']);
            live?.dispose();
        }
    });

    it('fires nothing for a change over several lines', async () => {
        const { editor } = await open({ [FILE]: ['- [ ] T @2026-09-21 ==> every mon', ''] });

        editor.change({ from: 0, to: editor.state.doc.length, insert: '- [x] T @2026-09-21 ==> every mon\n' }, 'input.paste');

        expect(editor.lines()).toEqual(['- [x] T @2026-09-21 ==> every mon', '']);
    });

    it('stands without its fire when the plan fails, and says why', async () => {
        const { editor } = await open({ [FILE]: ['- [ ] T @2026-09-21 ==> at(end + 1d)', ''] });

        editor.check(0);
        await Promise.resolve();

        expect(editor.lines()).toEqual(['- [x] T @2026-09-21 ==> at(end + 1d)', '']);
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toContain("Property 'end' is not set on this task");
    });

    it('stands without its fire when the fire\'s lines cannot be written, and says why', async () => {
        const { editor } = await open({ [FILE]: ['# note', '- [ ] 対象 @2026-09-21', '\t- ==> every mon', '\t\t- [ ] sub', '- [ ] U', ''] });

        editor.check(1);

        expect(editor.lines()[1]).toBe('- [x] 対象 @2026-09-21');
        expect(editor.lines()).toHaveLength(6);
        // Told once the transaction is through, as a plan that failed is, and once.
        expect(Notice.messages).toEqual([]);
        await Promise.resolve();
        expect(Notice.messages).toEqual([t('notice.flowNotRun', { reason: t('notice.refusedDisturbs'), subject: '- [x] 対象 @2026-09-21' })]);
    });
});

describe('a transaction that completes rows, some of whose fires cannot be written (R1)', () => {
    // 対象's `==>` line is a child of its own child's line: the next instance
    // cannot be written without changing what `sub` is, and is refused.
    const refused = ['- [ ] 対象 @2026-09-21', '\t- ==> every mon', '\t\t- [ ] sub'];

    it('writes the fires that can be, below a row refused', async () => {
        const { editor } = await open({ [FILE]: ['# note', ...refused, '- [ ] B @2026-09-21 ==> every tue', ''] });

        editor.change([
            { from: editor.at(1, 3), to: editor.at(1, 4), insert: 'x' },
            { from: editor.at(4, 3), to: editor.at(4, 4), insert: 'x' },
        ], 'input.type');

        expect(editor.lines()).toEqual([
            '# note', '- [ ] B @2026-09-29 ==> every tue',
            '- [x] 対象 @2026-09-21', '\t- ==> every mon', '\t\t- [ ] sub', '- [x] B @2026-09-21', '',
        ]);
        // Told of the row that was refused, not of the last row written.
        await Promise.resolve();
        expect(Notice.messages).toEqual([t('notice.flowNotRun', { reason: t('notice.refusedDisturbs'), subject: '- [x] 対象 @2026-09-21' })]);
    });

    it('writes the fires that can be, above a row refused', async () => {
        const { editor } = await open({ [FILE]: ['# note', '- [ ] A @2026-09-21 ==> every mon', ...refused, ''] });

        editor.change([
            { from: editor.at(1, 3), to: editor.at(1, 4), insert: 'x' },
            { from: editor.at(2, 3), to: editor.at(2, 4), insert: 'x' },
        ], 'input.type');

        expect(editor.lines()).toEqual([
            '# note', '- [ ] A @2026-09-28 ==> every mon', '- [x] A @2026-09-21',
            '- [x] 対象 @2026-09-21', '\t- ==> every mon', '\t\t- [ ] sub', '',
        ]);
        await Promise.resolve();
        expect(Notice.messages).toEqual([t('notice.flowNotRun', { reason: t('notice.refusedDisturbs'), subject: '- [x] 対象 @2026-09-21' })]);
    });

    it('tells each row not fired once, in the order the rows stand, by the rule a card\'s write tells it by', async () => {
        // A plan that failed above a fire refused: the one rule (`notRunsOf`)
        // owes each its word, once, the row above first.
        const { editor } = await open({ [FILE]: ['# note', '- [ ] A @2026-09-21 ==> at(end + 1d)', ...refused, ''] });

        editor.change([
            { from: editor.at(1, 3), to: editor.at(1, 4), insert: 'x' },
            { from: editor.at(2, 3), to: editor.at(2, 4), insert: 'x' },
        ], 'input.type');
        await Promise.resolve();

        expect(editor.lines()).toEqual([
            '# note', '- [x] A @2026-09-21 ==> at(end + 1d)',
            '- [x] 対象 @2026-09-21', '\t- ==> every mon', '\t\t- [ ] sub', '',
        ]);
        expect(Notice.messages).toHaveLength(2);
        expect(Notice.messages[0]).toContain("Property 'end' is not set on this task");
        expect(Notice.messages[1]).toBe(t('notice.flowNotRun', { reason: t('notice.refusedDisturbs'), subject: '- [x] 対象 @2026-09-21' }));
    });
});

describe('a completion with nothing to fire', () => {
    it('is let through as it is, nothing written for it', async () => {
        // A row with no flow, above and below one with a flow.
        const { editor } = await open({ [FILE]: ['- [ ] A', '- [ ] T @2026-09-21 ==> every mon', '- [ ] U', ''] });

        const tr = editor.check(0);
        editor.check(2);

        expect(editor.lines()).toEqual(['- [x] A', '- [ ] T @2026-09-21 ==> every mon', '- [x] U', '']);
        expect(editor.transactions[0].changes.toJSON()).toEqual(tr.changes.toJSON());
        expect(editor.transactions[0].changes.toJSON()).toEqual([3, [1, 'x'], editor.state.doc.length - 4]);
        expect(editor.transactions).toHaveLength(2);
        expect(Notice.messages).toEqual([]);
    });
});

describe('undoing completions made in the editor', () => {
    // CM6's history joins a change to the one before it when the two touch
    // and come within half a second: today is held, so every change here
    // comes at once, and the cases are ones whose changes touch.
    it('undoes one completion, with its fire, at a time, however quickly they were made', async () => {
        // Each completion checks the instance the one before it wrote.
        const { editor } = await open({ [FILE]: ['- [ ] T @2026-09-21 ==> every mon', '- [ ] U', ''] });
        const states = [editor.lines()];
        for (let i = 0; i < 3; i++) {
            editor.check(0);
            states.push(editor.lines());
        }
        expect(states[3].slice(0, 4)).toEqual([
            '- [ ] T @2026-10-12 ==> every mon', '- [x] T @2026-10-05', '- [x] T @2026-09-28', '- [x] T @2026-09-21',
        ]);

        for (let i = 2; i >= 0; i--) {
            expect(editor.undo()).toBe(true);
            expect(editor.lines()).toEqual(states[i]);
        }
        // And back, a completion at a time, firing nothing more.
        editor.redo();
        expect(editor.lines()).toEqual(states[1]);
    });

    it('undoes a row with no flow a completion at a time, apart from the typing that wrote it', async () => {
        const { editor } = await open({ [FILE]: ['', ''] });

        editor.change({ from: 0, insert: '- [ ] T' }, 'input.type');
        editor.check(0);
        editor.change({ from: editor.at(0, 7), insert: 'b' }, 'input.type');

        editor.undo();
        expect(editor.lines()).toEqual(['- [x] T', '']);
        editor.undo();
        expect(editor.lines()).toEqual(['- [ ] T', '']);
        editor.undo();
        expect(editor.lines()).toEqual(['', '']);
    });

    it('keeps a completion and its fire apart from the typing just before and after it', async () => {
        const { editor } = await open({ [FILE]: ['', ''] });

        editor.change({ from: 0, insert: '- [ ] T @2026-09-21 ==> every mon' }, 'input.type');
        editor.check(0);
        const completed = editor.lines();
        expect(completed).toEqual(['- [ ] T @2026-09-28 ==> every mon', '- [x] T @2026-09-21', '']);
        // At the end of the instance the fire wrote.
        editor.change({ from: editor.at(0, completed[0].length), insert: 'b' }, 'input.type');

        editor.undo();
        expect(editor.lines()).toEqual(completed);
        editor.undo();
        expect(editor.lines()).toEqual(['- [ ] T @2026-09-21 ==> every mon', '']);
    });
});
