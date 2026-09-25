import { describe, it, expect, afterEach } from 'vitest';
import { openVault, makeFile, type VaultSession } from '../helpers/vaultSession';
import { editorSession } from '../helpers/editorSession';
import { keyOf } from '../../../src/editor/EditorDoc';
import { taskShownAt, type ShownTaskLookup } from '../../../src/editor/ShownTask';

/**
 * The task the editor's ⋯ menu is opened on: the index's row on the editor's
 * line, looked up only in the content the editor shows. A line number counts
 * in nothing else: with a line typed above and not saved yet, the index's
 * row on that number is the one below it.
 */

const FILE = 'note.md';
const A = '- [ ] A @2026-09-21';
const B = '- [ ] B @2026-09-21';

let live: VaultSession | undefined;

afterEach(() => {
    live?.dispose();
    live = undefined;
});

async function open(disk: string[], shown: string[]) {
    const { contents, session } = await openVault(disk);
    live = session;
    const editor = editorSession(session.index.editorFireHost(), FILE, shown.join('\n'));
    let saves = 0;
    const lookup: ShownTaskLookup = {
        taskAtEditorLine: (path, line, key) => session.index.taskAtEditorLine(path, line, key),
        // The editor saved, and the index made to read the file.
        readShown: async () => {
            saves++;
            contents.set(FILE, editor.text());
            await session.index.requestScan(makeFile(FILE));
        },
    };
    return { contents, session, editor, lookup, saves: () => saves };
}

describe('the index\'s row on the editor\'s line', () => {
    it('is looked up only in the content the index last read', async () => {
        const { session, editor } = await open([A, B, ''], ['メモ', A, B, '']);

        expect(session.index.taskAtEditorLine(FILE, 1, keyOf(editor.state.doc))).toBeNull();
        expect(session.index.taskAtEditorLine(FILE, 0, keyOf(editor.state.doc))).toBeNull();
    });

    it('is the row on that line when the index read what the editor shows', async () => {
        const { session, editor } = await open([A, B, ''], [A, B, '']);

        expect(session.index.taskAtEditorLine(FILE, 1, keyOf(editor.state.doc))?.content).toBe('B');
        expect(session.index.taskAtEditorLine(FILE, 2, keyOf(editor.state.doc))).toBeUndefined();
    });
});

describe('the menu\'s task, with a line typed above and not saved yet', () => {
    it('is the row the menu was opened on, once the editor is saved and read, not the row below it', async () => {
        const { editor, lookup, saves } = await open([A, B, ''], ['メモ', A, B, '']);

        const task = await taskShownAt(editor.handle, FILE, 1, lookup);

        expect(task?.content).toBe('A');
        expect(task?.line).toBe(1);
        expect(saves()).toBe(1);
    });

    it('is looked up without a save when the index read what the editor shows', async () => {
        const { editor, lookup, saves } = await open([A, B, ''], [A, B, '']);

        expect((await taskShownAt(editor.handle, FILE, 0, lookup))?.content).toBe('A');
        expect(saves()).toBe(0);
    });

    it('is none, and the menu is not opened, when the editor was typed into while it was read', async () => {
        const { editor, lookup } = await open([A, B, ''], ['メモ', A, B, '']);
        const read = lookup.readShown;
        lookup.readShown = async (shown) => {
            await read(shown);
            editor.change({ from: 0, insert: 'x' }, 'input.type');
        };

        expect(await taskShownAt(editor.handle, FILE, 1, lookup)).toBeNull();
    });
});
