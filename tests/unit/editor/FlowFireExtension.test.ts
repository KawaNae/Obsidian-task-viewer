import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { editorSession } from '../helpers/editorSession';
import { t } from '../../../src/i18n';
import { freezeDate } from '../helpers/fakeDate';

/**
 * A completion made in the editor fires in the transaction that made it
 * (`flowFireExtension`): planned from the document the transaction leaves,
 * written into the same transaction, and nothing else in the editor fires.
 */

// `every` lands on the first grid point after the later of today and the
// row's date: today is held on the Friday the dates below are read from.
freezeDate(new Date(2026, 8, 25, 12, 0, 0));

const FILE = 'note.md';
const OTHER = 'other.md';

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
    const host = opened.session.index.editorFireHost();
    const applyOps = vi.fn(host.applyOps);
    const editor = editorSession({ ...host, applyOps }, FILE, opened.contents.get(FILE)!);
    return { ...opened, editor, applyOps };
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
        expect(Notice.messages).toEqual([t('notice.writeDisturbs', { subject: '- [x] 対象 @2026-09-21' })]);
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
        expect(Notice.messages).toEqual([t('notice.writeDisturbs', { subject: '- [x] 対象 @2026-09-21' })]);
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
        expect(Notice.messages).toEqual([t('notice.writeDisturbs', { subject: '- [x] 対象 @2026-09-21' })]);
    });
});

describe('a completion with nothing to fire', () => {
    it('is let through as it is, nothing written for it', async () => {
        // A row with no flow, above and below one with a flow.
        const { editor, applyOps } = await open({ [FILE]: ['- [ ] A', '- [ ] T @2026-09-21 ==> every mon', '- [ ] U', ''] });

        const tr = editor.check(0);
        editor.check(2);

        expect(editor.lines()).toEqual(['- [x] A', '- [ ] T @2026-09-21 ==> every mon', '- [x] U', '']);
        expect(editor.transactions[0].changes.toJSON()).toEqual(tr.changes.toJSON());
        expect(editor.transactions[0].changes.toJSON()).toEqual([3, [1, 'x'], editor.state.doc.length - 4]);
        expect(applyOps).not.toHaveBeenCalled();
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

describe('a move to another file, completed in the editor', () => {
    it('lands the completion first, then the archive, then takes the original away in the editor', async () => {
        const { contents, editor } = await open({
            [FILE]: ['# note', '- [ ] T @2026-09-21 ==> move([[other]])', '\t- [ ] c', '- [ ] U', ''],
            [OTHER]: ['# other', ''],
        });

        editor.check(1);
        expect(editor.lines()).toEqual(['# note', '- [x] T @2026-09-21 ==> move([[other]])', '\t- [ ] c', '- [ ] U', '']);

        await editor.settled();

        expect(contents.get(OTHER)).toBe(['# other', '- [x] T @2026-09-21', '\t- [ ] c', ''].join('\n'));
        expect(editor.lines()).toEqual(['# note', '- [ ] U', '']);
        expect(editor.transactions).toHaveLength(2);
        expect(Notice.messages).toEqual([]);
    });

    it('takes the original away when a row above it fired in the same transaction', async () => {
        // The row above puts its next instance at the head of the group, above
        // the moving row: the moving row is found where the whole write left it.
        const { contents, editor } = await open({
            [FILE]: ['# note', '- [ ] A @2026-09-21 ==> every mon', '- [ ] B @2026-09-21 ==> move([[other]])', '- [ ] U', ''],
            [OTHER]: ['# other', ''],
        });

        editor.change([
            { from: editor.at(1, 3), to: editor.at(1, 4), insert: 'x' },
            { from: editor.at(2, 3), to: editor.at(2, 4), insert: 'x' },
        ], 'input.type');
        await editor.settled();

        expect(contents.get(OTHER)).toBe(['# other', '- [x] B @2026-09-21', ''].join('\n'));
        expect(editor.lines()).toEqual(['# note', '- [ ] A @2026-09-28 ==> every mon', '- [x] A @2026-09-21', '- [ ] U', '']);
        expect(Notice.messages).toEqual([]);
    });

    it('takes the original where the editor has carried it, past a line typed above', async () => {
        const { contents, editor } = await open({
            [FILE]: ['# note', '- [ ] T @2026-09-21 ==> move([[other]])', '- [ ] U', ''],
            [OTHER]: ['# other', ''],
        });

        editor.check(1);
        editor.change({ from: editor.at(1), insert: 'typed\n' }, 'input.type');
        await editor.settled();

        expect(contents.get(OTHER)).toBe(['# other', '- [x] T @2026-09-21', ''].join('\n'));
        expect(editor.lines()).toEqual(['# note', 'typed', '- [ ] U', '']);
        expect(Notice.messages).toEqual([]);
    });

    it('leaves the original, and says the task is in both, when the completion was undone first', async () => {
        const { contents, editor } = await open({
            [FILE]: ['# note', '- [ ] T @2026-09-21 ==> move([[other]])', '- [ ] U', ''],
            [OTHER]: ['# other', ''],
        });

        editor.check(1);
        editor.change({ from: editor.at(1, 3), to: editor.at(1, 4), insert: ' ' }, 'undo');
        await editor.settled();

        expect(contents.get(OTHER)).toBe(['# other', '- [x] T @2026-09-21', ''].join('\n'));
        expect(editor.lines()).toEqual(['# note', '- [ ] T @2026-09-21 ==> move([[other]])', '- [ ] U', '']);
        expect(Notice.messages).toEqual([t('notice.moveOriginKept', {
            dest: 'other', reason: t('notice.moveOriginChanged'), subject: '- [x] T @2026-09-21 ==> move([[other]])',
        })]);
    });

    it('undoes the original taken away as a step of its own, with nothing typed since', async () => {
        const { editor } = await open({
            [FILE]: ['# note', '- [ ] T @2026-09-21 ==> move([[other]])', '\t- [ ] c', '- [ ] U', ''],
            [OTHER]: ['# other', ''],
        });

        editor.check(1);
        const completed = editor.lines();
        await editor.settled();
        expect(editor.lines()).toEqual(['# note', '- [ ] U', '']);

        editor.undo();
        expect(editor.lines()).toEqual(completed);
        editor.undo();
        expect(editor.lines()).toEqual(['# note', '- [ ] T @2026-09-21 ==> move([[other]])', '\t- [ ] c', '- [ ] U', '']);
    });

    it('undoes the original taken away as a step of its own, with a line typed since', async () => {
        const { editor } = await open({
            [FILE]: ['# note', '- [ ] T @2026-09-21 ==> move([[other]])', '- [ ] U', ''],
            [OTHER]: ['# other', ''],
        });

        editor.check(1);
        editor.change({ from: editor.at(1), insert: 'typed\n' }, 'input.type');
        await editor.settled();
        expect(editor.lines()).toEqual(['# note', 'typed', '- [ ] U', '']);

        editor.undo();
        expect(editor.lines()).toEqual(['# note', 'typed', '- [x] T @2026-09-21 ==> move([[other]])', '- [ ] U', '']);
        editor.undo();
        expect(editor.lines()).toEqual(['# note', '- [x] T @2026-09-21 ==> move([[other]])', '- [ ] U', '']);
        editor.undo();
        expect(editor.lines()).toEqual(['# note', '- [ ] T @2026-09-21 ==> move([[other]])', '- [ ] U', '']);
    });
});

describe('a move to another file, when the editor and its row part ways before the original is taken', () => {
    // The row's position counts only in the content the editor's own
    // transactions carried it through. A change shown from outside (`set`:
    // a write of ours to the file, another app's) is Obsidian's diff of two
    // contents, which cannot tell twins apart: the original is not taken.
    const kept = (subject: string) => t('notice.moveOriginKept', {
        dest: 'other', reason: t('notice.moveOriginChanged'), subject,
    });

    it('leaves the twin when the row was taken away from outside, and the diff says its twin went', async () => {
        const ROW = '- [x] T @2026-09-21 ==> move([[other]])';
        const { contents, editor } = await open({
            [FILE]: ['# note', '- [ ] T @2026-09-21 ==> move([[other]])', ROW, '- [ ] R', ''],
            [OTHER]: ['# other', ''],
        });

        editor.check(1);
        // Line 1 taken away from outside, shown as its twin below going: the
        // two read the same, so a diff keeps the first and takes the second.
        editor.change({ from: editor.at(2), to: editor.at(3) }, 'set');
        expect(editor.lines()).toEqual(['# note', ROW, '- [ ] R', '']);
        await editor.settled();

        expect(contents.get(OTHER)).toBe(['# other', '- [x] T @2026-09-21', ''].join('\n'));
        expect(editor.lines()).toEqual(['# note', ROW, '- [ ] R', '']);
        expect(Notice.messages).toEqual([kept(ROW)]);
    });

    it('leaves the original when a write of ours was shown in the editor first (the review\'s hole 3)', async () => {
        const ROW = '    - [x] A @2026-09-21 ==> move([[other]])';
        const { editor } = await open({
            [FILE]: ['- [ ] Q', '    - [ ] A @2026-09-21 ==> move([[other]])', '- [ ] P', ROW, ''],
            [OTHER]: ['# other', ''],
        });

        editor.check(1);
        // A card completes Q, and the file's new content is shown here.
        editor.change({ from: editor.at(0, 3), to: editor.at(0, 4), insert: 'x' }, 'set');
        await editor.settled();

        expect(editor.lines()).toEqual(['- [x] Q', ROW, '- [ ] P', ROW, '']);
        expect(Notice.messages).toEqual([kept(ROW.trim())]);
    });

    it('leaves the twin when the editor closed and the file was edited from outside before the original was taken', async () => {
        const ROW = '- [x] T @2026-09-21 ==> move([[other]])';
        const opened = await openVault({
            [FILE]: ['# note', '- [ ] T @2026-09-21 ==> move([[other]])', ROW, ''],
            [OTHER]: ['# other', ''],
        });
        live = opened.session;
        const host = opened.session.index.editorFireHost();
        const { contents } = opened;
        const edited = ['# note', ROW, ''].join('\n');
        const editor = editorSession({
            ...host,
            // The completion saved, and line 1 taken away from outside, just
            // before the original's write.
            finishAway: (away, writeSource) => host.finishAway(away, (at, ops) => {
                contents.set(FILE, edited);
                return writeSource(at, ops);
            }),
        }, FILE, contents.get(FILE)!);

        editor.check(1);
        contents.set(FILE, editor.text());
        editor.close();
        await editor.settled();

        expect(contents.get(FILE)).toBe(edited);
        expect(Notice.messages).toEqual([kept(ROW)]);
    });
});
