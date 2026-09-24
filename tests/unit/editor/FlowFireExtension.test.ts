import { describe, it, expect, afterEach, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { editorSession } from '../helpers/editorSession';
import { t } from '../../../src/i18n';

/**
 * A completion made in the editor fires in the transaction that made it
 * (`flowFireExtension`): planned from the document the transaction leaves,
 * written into the same transaction, and nothing else in the editor fires.
 */

// `every` lands on the first grid point after the later of today and the
// row's date: today is held on the Friday the dates below are read from.
beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0));
});
afterAll(() => {
    vi.useRealTimers();
});

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
    const editor = editorSession(opened.session.index.editorFireHost(), FILE, opened.contents.get(FILE)!);
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
        expect(Notice.messages).toEqual([t('notice.writeDisturbs', { subject: '- [x] 対象 @2026-09-21' })]);
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
});
