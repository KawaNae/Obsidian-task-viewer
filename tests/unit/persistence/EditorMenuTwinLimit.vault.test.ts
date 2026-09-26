import { describe, it, expect, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { contentKeyOf } from '../../../src/services/core/ContentKey';
import { t } from '../../../src/i18n';
import { editorSession } from '../helpers/editorSession';
import { keyOf } from '../../../src/editor/EditorDoc';
import { writeEditorLine } from '../../../src/editor/EditorWrite';
import type { EditorLine } from '../../../src/services/persistence/FileLines';
import type { TaskOp } from '../../../src/services/persistence/TaskOps';

/**
 * The editor's ⋯ menu, on one of two twin lines, when the editor and the file
 * part ways: N1's known limit, closed in E1.
 *
 * The menu points at a line by the editor's line number and text
 * (`EditorLine`). Checked by its text alone, the line passed on a twin that
 * an unsaved line above, or an edit from outside, had brought onto that
 * number, and the write went to the other twin. The coordinate now holds only
 * in the content it was taken in (`EditorLine.key`, checked by
 * `WriteSession.row`): written to the file, it is refused unless the file
 * reads as the editor showed it.
 */

const FILE = 'note.md';
const CHANGED = t('notice.notWritten', { reason: t('notice.refusedChanged'), subject: '- [ ] 読書' });

let live: VaultSession[] = [];

afterEach(() => {
    for (const session of live) session.dispose();
    live = [];
    Notice.messages.length = 0;
});

describe('the editor menu, written to the file, on one of two twin lines', () => {
    it('is refused when the editor holds an unsaved line above it', async () => {
        const { contents, session } = await openVault(['- [ ] 読書', '- [ ] 読書', '']);
        live.push(session);

        // The editor shows ['メモ', '- [ ] 読書', '- [ ] 読書', ''], 'メモ' not
        // saved yet, and its menu is opened on its line 1: the disk's line 0.
        const shown = ['メモ', '- [ ] 読書', '- [ ] 読書', ''];
        const at = { line: 1, text: '- [ ] 読書', key: contentKeyOf(shown) };

        expect(await session.index.writeLine(FILE, at, [{ kind: 'update', text: '- [x] 読書' }])).toBe(false);
        expect(contents.get(FILE)).toBe(['- [ ] 読書', '- [ ] 読書', ''].join('\n'));
        expect(Notice.messages).toEqual([CHANGED]);
    });

    it('is refused when an edit from outside took a line away above it since the menu was opened', async () => {
        const shown = ['- [ ] 読書', '- [ ] 読書', '- [ ] 読書', ''];
        const { contents, session } = await openVault(shown);
        live.push(session);

        // The menu is opened on the second twin; then the first is taken away
        // from outside, and the third comes onto its line.
        const at = { line: 1, text: '- [ ] 読書', key: contentKeyOf(shown) };
        contents.set(FILE, ['- [ ] 読書', '- [ ] 読書', ''].join('\n'));

        expect(await session.index.writeLine(FILE, at, [{ kind: 'remove' }])).toBe(false);
        expect(contents.get(FILE)).toBe(['- [ ] 読書', '- [ ] 読書', ''].join('\n'));
        expect(Notice.messages).toEqual([CHANGED]);
    });

    it('is written when the file reads as the editor showed it', async () => {
        const shown = ['- [ ] 読書', '- [ ] 読書', ''];
        const { contents, session } = await openVault(shown);
        live.push(session);

        const at = { line: 1, text: '- [ ] 読書', key: contentKeyOf(shown) };

        expect(await session.index.writeLine(FILE, at, [{ kind: 'update', text: '- [x] 読書' }])).toBe(true);
        expect(contents.get(FILE)).toBe(['- [ ] 読書', '- [x] 読書', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
    });
});

describe('the editor menu, written in the editor, on one of two twin lines', () => {
    const host = (session: VaultSession) => ({
        ...session.index.editorFireHost(),
        writeLine: (path: string, at: EditorLine, ops: readonly TaskOp[]) => session.index.writeLine(path, at, ops),
    });

    it('writes the twin it was opened on, in the editor holding an unsaved line above it', async () => {
        const { contents, session } = await openVault(['- [ ] 読書', '- [ ] 読書', '']);
        live.push(session);
        const editor = editorSession(session.index.editorFireHost(), FILE, ['メモ', '- [ ] 読書', '- [ ] 読書', ''].join('\n'));
        const at = { line: 1, text: '- [ ] 読書', key: keyOf(editor.state.doc) };

        expect(await writeEditorLine(editor.handle, FILE, at, [{ kind: 'update', text: '- [x] 読書' }], host(session))).toBe(true);

        expect(editor.lines()).toEqual(['メモ', '- [x] 読書', '- [ ] 読書', '']);
        // The editor saves it, as it saves what the user typed.
        expect(contents.get(FILE)).toBe(['- [ ] 読書', '- [ ] 読書', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
    });

    it('is refused once a change from outside was shown in the editor since the menu was opened', async () => {
        const shown = ['- [ ] 読書', '- [ ] 読書', '- [ ] 読書', ''];
        const { session } = await openVault(shown);
        live.push(session);
        const editor = editorSession(session.index.editorFireHost(), FILE, shown.join('\n'));
        const at = { line: 1, text: '- [ ] 読書', key: keyOf(editor.state.doc) };
        // The first twin taken away from outside: the third comes onto line 1.
        editor.change({ from: 0, to: editor.at(1) }, 'set');

        expect(await writeEditorLine(editor.handle, FILE, at, [{ kind: 'remove' }], host(session))).toBe(false);

        expect(editor.lines()).toEqual(['- [ ] 読書', '- [ ] 読書', '']);
        expect(Notice.messages).toEqual([CHANGED]);
    });

    it('is written to the file when the editor shows another note', async () => {
        const shown = ['- [ ] 読書', '- [ ] 読書', ''];
        const { contents, session } = await openVault(shown);
        live.push(session);
        const editor = editorSession(session.index.editorFireHost(), 'another.md', shown.join('\n'));
        const at = { line: 1, text: '- [ ] 読書', key: keyOf(editor.state.doc) };

        expect(await writeEditorLine(editor.handle, FILE, at, [{ kind: 'update', text: '- [x] 読書' }], host(session))).toBe(true);

        expect(editor.lines()).toEqual(shown);
        expect(contents.get(FILE)).toBe(['- [ ] 読書', '- [x] 読書', ''].join('\n'));
    });

    it('makes each of its writes a step of its own to undo, apart from the typing just before it', async () => {
        const { session } = await openVault(['- [ ] A', '']);
        live.push(session);
        const editor = editorSession(session.index.editorFireHost(), FILE, ['- [ ] A', ''].join('\n'));
        editor.change({ from: editor.at(0, 7), insert: 'b' }, 'input.type');
        const at = { line: 0, text: '- [ ] Ab', key: keyOf(editor.state.doc) };

        // Taking away the line just typed on: a change next to the typing,
        // which the history would otherwise join to it.
        expect(await writeEditorLine(editor.handle, FILE, { ...at, subtree: ['- [ ] Ab'] }, [{ kind: 'remove' }], host(session))).toBe(true);
        expect(editor.lines()).toEqual(['']);

        editor.undo();
        expect(editor.lines()).toEqual(['- [ ] Ab', '']);
        editor.undo();
        expect(editor.lines()).toEqual(['- [ ] A', '']);
    });
});
