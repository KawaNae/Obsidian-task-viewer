import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { contentKeyOf } from '../../../src/services/core/ContentKey';
import { keyOf } from '../../../src/editor/EditorDoc';
import { writeEditorLine } from '../../../src/editor/EditorWrite';
import type { EditorLine } from '../../../src/utils/FileLines';
import type { TaskOp } from '../../../src/services/persistence/TaskOps';
import { Notice } from 'obsidian';
import { openVault, makeFile, type VaultSession } from '../helpers/vaultSession';
import { editorSession, type EditorSession } from '../helpers/editorSession';
import { freezeDate } from '../helpers/fakeDate';

/**
 * A completion fires from the operation that completed it, once, and from
 * nothing else (structure.md, 「発火の可否」; contract 2). Stage X closes
 * with this every shape in which firing was answered from two readings of a
 * file — the rows of the table of defects and limits for "a completion
 * undone and redone" and "a completion that arrived by sync" — and each is
 * pinned here, on the paths that remain: the editor's transaction, a card's
 * write, and the readings (a scan, an outside `modify`) that have no way to
 * fire at all.
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

interface Opened {
    contents: Map<string, string>;
    session: VaultSession;
    editor: EditorSession;
    /** The contents of each row a fire was planned for, in order. */
    fired: string[];
    /** How many writes to the vault were made. */
    writes: () => number;
    /** Something outside the editor (a sync, the reading view's click) wrote `lines`. */
    fromOutside: (lines: string[]) => Promise<void>;
    idOf: (content: string) => string;
}

async function open(lines: string[]): Promise<Opened> {
    const { contents, session } = await openVault({ [FILE]: lines });
    live = session;
    const fired: string[] = [];
    const executor = session.executor;
    const plan = executor.planFire.bind(executor);
    executor.planFire = (...args) => {
        const planned = plan(...args);
        if (planned.kind === 'fires') fired.push(planned.task.content);
        return planned;
    };
    let writes = 0;
    const vault = session.app.vault as unknown as { process: (...args: unknown[]) => Promise<string> };
    const process = vault.process.bind(vault);
    vault.process = (...args: unknown[]) => { writes++; return process(...args); };
    return {
        contents,
        session,
        editor: editorSession(session.index.editorFireHost(), FILE, contents.get(FILE)!),
        fired,
        writes: () => writes,
        fromOutside: async (next: string[]) => {
            contents.set(FILE, next.join('\n'));
            await session.fireVault('modify', makeFile(FILE));
            await session.settle(FILE);
        },
        idOf: (content: string) => session.index.getTasks().find(task => task.content === content)!.id,
    };
}

const WEEKLY = '- [ ] 週報 @2026-09-21 ==> every mon';

describe('the editor: which transactions fire, and how many rows', () => {
    // A change of the row's status alone: one line before and after.
    const one = (editor: EditorSession, line: number) => [{ from: editor.at(line, 3), to: editor.at(line, 4), insert: 'x' }];
    // The row replaced with its line break: two lines before and after.
    const whole = (editor: EditorSession, line: number) => [{
        from: editor.at(line), to: editor.at(line + 1), insert: `${editor.lines()[line].replace('[ ]', '[x]')}\n`,
    }];

    const OPERATIONS: Array<string | undefined> = [undefined, 'input.type', 'input.paste', 'searchReplace'];
    const NOT_OPERATIONS = ['set', 'undo', 'redo'];

    for (const mark of [...OPERATIONS, ...NOT_OPERATIONS]) {
        const operation = OPERATIONS.includes(mark);
        const name = mark ?? 'no mark';

        it(`${name}: a one-line change fires ${operation ? 'once' : 'nothing'}`, async () => {
            const note = await open(['# note', WEEKLY, '- [ ] U', '']);
            note.editor.change(one(note.editor, 1), mark);
            expect(note.fired).toEqual(operation ? ['週報'] : []);
        });

        it(`${name}: two one-line changes fire ${operation ? 'twice' : 'nothing'}`, async () => {
            const note = await open(['# note', WEEKLY, '- [ ] 日報 @2026-09-21 ==> every 1d', '']);
            note.editor.change([...one(note.editor, 1), ...one(note.editor, 2)], mark);
            expect(note.fired).toEqual(operation ? ['週報', '日報'] : []);
        });

        it(`${name}: a change over several lines fires nothing`, async () => {
            const note = await open(['# note', WEEKLY, '- [ ] U', '']);
            note.editor.change(whole(note.editor, 1), mark);
            expect(note.editor.lines()[1]).toBe(WEEKLY.replace('[ ]', '[x]'));
            expect(note.fired).toEqual([]);
        });
    }
});

describe('a completion undone and redone (N1)', () => {
    it('fires once: the undo and the redo are no operation', async () => {
        const note = await open(['# note', WEEKLY, '- [ ] U', '']);
        const before = note.editor.text();

        note.editor.check(1);
        const fired = note.editor.text();
        expect(note.fired).toEqual(['週報']);

        // What the history gives back: the note as it was, then as it was left.
        note.editor.change({ from: 0, to: note.editor.state.doc.length, insert: before }, 'undo');
        note.editor.change({ from: 0, to: note.editor.state.doc.length, insert: fired }, 'redo');
        // An undo of the fire alone leaves the completed row with its command.
        note.editor.change({ from: 0, to: note.editor.state.doc.length, insert: before.replace('[ ] 週報', '[x] 週報') }, 'undo');

        expect(note.fired).toEqual(['週報']);
    });
});

describe('rows that read alike (N2, Q2)', () => {
    it('fires each of two rows alike completed in one transaction, with a next instance for each', async () => {
        const note = await open(['# note', WEEKLY, WEEKLY, '']);

        note.editor.change([
            { from: note.editor.at(1, 3), to: note.editor.at(1, 4), insert: 'x' },
            { from: note.editor.at(2, 3), to: note.editor.at(2, 4), insert: 'x' },
        ], 'input.type');

        expect(note.fired).toEqual(['週報', '週報']);
        expect(note.editor.lines()).toEqual([
            '# note', '- [ ] 週報 @2026-09-28 ==> every mon', '- [ ] 週報 @2026-09-28 ==> every mon',
            '- [x] 週報 @2026-09-21', '- [x] 週報 @2026-09-21', '',
        ]);
    });

    it('fires the row checked, not its twin unchecked in the same transaction', async () => {
        const checked = WEEKLY.replace('[ ]', '[x]');
        const note = await open(['# note', checked, WEEKLY, '']);

        note.editor.change([
            { from: note.editor.at(1, 3), to: note.editor.at(1, 4), insert: ' ' },
            { from: note.editor.at(2, 3), to: note.editor.at(2, 4), insert: 'x' },
        ], 'input.type');

        expect(note.fired).toEqual(['週報']);
        expect(note.editor.lines()).toEqual([
            '# note', '- [ ] 週報 @2026-09-28 ==> every mon', WEEKLY, '- [x] 週報 @2026-09-21', '',
        ]);
    });

    it('fires the row a card checked, beside its twin', async () => {
        const note = await open(['# note', WEEKLY, WEEKLY, '']);
        const [, second] = note.session.index.getTasks().sort((a, b) => a.line - b.line);

        expect(await note.session.index.updateTask(second.id, { statusChar: 'x' })).toBe(true);
        await note.session.flowSettled(FILE);

        expect(note.fired).toEqual(['週報']);
        expect(note.contents.get(FILE)!.split('\n')).toEqual([
            '# note', '- [ ] 週報 @2026-09-28 ==> every mon', WEEKLY, '- [x] 週報 @2026-09-21', '',
        ]);
    });
});

describe('a card\'s completion', () => {
    it('writes the check and the fire in one write, and fires once', async () => {
        const note = await open(['# note', WEEKLY, '- [ ] U', '']);

        expect(await note.session.index.updateTask(note.idOf('週報'), { statusChar: 'x' })).toBe(true);
        await note.session.flowSettled(FILE);

        expect(note.writes()).toBe(1);
        expect(note.fired).toEqual(['週報']);
        expect(note.contents.get(FILE)!.split('\n')).toEqual([
            '# note', '- [ ] 週報 @2026-09-28 ==> every mon', '- [x] 週報 @2026-09-21', '- [ ] U', '',
        ]);
    });

    it('fires nothing for a write that does not complete the row: a completed row edited, or given another complete status', async () => {
        const note = await open(['# note', WEEKLY.replace('[ ]', '[x]'), '']);

        expect(await note.session.index.updateTask(note.idOf('週報'), { color: 'ff0000' })).toBe(true);
        await note.session.flowSettled(FILE);
        expect(await note.session.index.updateTask(note.idOf('週報'), { statusChar: '-' })).toBe(true);
        await note.session.flowSettled(FILE);

        expect(note.fired).toEqual([]);
        expect(note.contents.get(FILE)).toContain('- [-] 週報 @2026-09-21 ==> every mon');
    });

    it('fires nothing for a status that is not complete', async () => {
        const note = await open(['# note', WEEKLY, '']);

        await note.session.index.updateTask(note.idOf('週報'), { statusChar: '/' });
        await note.session.flowSettled(FILE);

        expect(note.fired).toEqual([]);
    });

    it('keeps the command of a move to another file that has not landed, for a write before the scan', async () => {
        // The completing write of a move to another file consumes nothing:
        // its command stays on the row until the source's write takes the row
        // away. The destination refused here, the row stays with it, and the
        // copy has to say so, or the next card's write drops the command.
        const note = await open(['# note', '- [ ] T @2026-09-21 ==> move([[other]])', '- [ ] U', '']);
        const repository = (note.session.index as unknown as { repository: { appendArchive: () => Promise<boolean> } }).repository;
        repository.appendArchive = async () => false;
        const id = note.idOf('T');
        note.session.holdScans();

        expect(await note.session.index.updateTask(id, { statusChar: 'x' })).toBe(true);
        expect(await note.session.index.updateTask(id, { content: 'T2' })).toBe(true);

        expect(note.fired).toEqual(['T']);
        expect(note.contents.get(FILE)!.split('\n')).toEqual([
            '# note', '- [x] T2 @2026-09-21 ==> move([[other]])', '- [ ] U', '',
        ]);
    });
});

describe('a move within the note, completed in the editor', () => {
    it('carries the row to the end in the same transaction, with the cursor on it', async () => {
        const note = await open(['# note', '- [ ] T @2026-09-21 ==> move([[note]])', '	- [ ] c', '- [ ] U', '']);

        note.editor.check(1);

        expect(note.editor.lines()).toEqual(['# note', '- [ ] U', '- [x] T @2026-09-21', '	- [ ] c', '']);
        expect(note.editor.transactions).toHaveLength(1);
        // The changes keep the most lines that keep their order
        // (`lineChanges`): the row and its child stay, and the line that was
        // below them goes above. The cursor stays on the row, past its `x`.
        expect(note.editor.state.selection.main.head).toBe(note.editor.at(2, 4));
    });
});

describe('the editor menu\'s rewrite of a line, written to the file when the editor no longer shows it', () => {
    it('fires once when it completes the line, in the same write', async () => {
        const note = await open(['# note', WEEKLY, '']);

        expect(await note.session.index.writeLine(FILE, { line: 1, text: WEEKLY, key: contentKeyOf(['# note', WEEKLY, '']) }, [{ kind: 'update', text: WEEKLY.replace('[ ]', '[x]') }])).toBe(true);

        expect(note.writes()).toBe(1);
        expect(note.fired).toEqual(['週報']);
        expect(note.contents.get(FILE)!.split('\n')).toEqual(['# note', '- [ ] 週報 @2026-09-28 ==> every mon', '- [x] 週報 @2026-09-21', '']);
    });

    it('fires nothing when the line it rewrites was complete already', async () => {
        const checked = WEEKLY.replace('[ ]', '[x]');
        const note = await open(['# note', checked, '']);

        expect(await note.session.index.writeLine(FILE, { line: 1, text: checked, key: contentKeyOf(['# note', checked, '']) }, [{ kind: 'update', text: checked.replace('[x]', '[-]') }])).toBe(true);

        expect(note.fired).toEqual([]);
    });

    it('moves the line to another file, and takes the original away in the file, when the editor closed before the menu wrote', async () => {
        // The source's write is made at the line the completing write left
        // the row on, in the content it left (`fireOp`'s `source.key`): right
        // only while the fire is the last op of that write.
        const lines = ['# note', '- [ ] T @2026-09-21 ==> move([[other]])', '\t- [ ] c', '- [ ] U', ''];
        const { contents, session } = await openVault({ [FILE]: lines, 'other.md': ['# other', ''] });
        live = session;
        const editor = editorSession(session.index.editorFireHost(), FILE, lines.join('\n'));
        const at = { line: 1, text: lines[1], key: keyOf(editor.state.doc) };
        editor.close();

        expect(await writeEditorLine(editor.handle, FILE, at, [{ kind: 'update', text: lines[1].replace('[ ]', '[x]') }], {
            ...session.index.editorFireHost(),
            writeLine: (path: string, line: EditorLine, ops: readonly TaskOp[]) => session.index.writeLine(path, line, ops),
        })).toBe(true);

        expect(contents.get('other.md')).toBe(['# other', '- [x] T @2026-09-21', '\t- [ ] c', ''].join('\n'));
        expect(contents.get(FILE)).toBe(['# note', '- [ ] U', ''].join('\n'));
        expect(editor.lines()).toEqual(lines);
        expect(Notice.messages).toEqual([]);
    });
});

describe('the editor menu\'s rewrite of a line, in the editor', () => {
    const host = (session: VaultSession) => ({
        ...session.index.editorFireHost(),
        writeLine: (path: string, at: EditorLine, ops: readonly TaskOp[]) => session.index.writeLine(path, at, ops),
    });

    it('fires once, in the transaction the menu made, a step of its own to undo, and writes nothing to the file', async () => {
        const note = await open(['# note', WEEKLY, '']);
        const at = { line: 1, text: WEEKLY, key: keyOf(note.editor.state.doc) };

        expect(await writeEditorLine(note.editor.handle, FILE, at, [{ kind: 'update', text: WEEKLY.replace('[ ]', '[x]') }], host(note.session))).toBe(true);

        expect(note.fired).toEqual(['週報']);
        expect(note.writes()).toBe(0);
        expect(note.editor.transactions).toHaveLength(1);
        expect(note.editor.lines()).toEqual(['# note', '- [ ] 週報 @2026-09-28 ==> every mon', '- [x] 週報 @2026-09-21', '']);
        note.editor.undo();
        expect(note.editor.lines()).toEqual(['# note', WEEKLY, '']);
    });

    it('fires nothing when the line it rewrites was complete already', async () => {
        const checked = WEEKLY.replace('[ ]', '[x]');
        const note = await open(['# note', checked, '']);
        const at = { line: 1, text: checked, key: keyOf(note.editor.state.doc) };

        expect(await writeEditorLine(note.editor.handle, FILE, at, [{ kind: 'update', text: checked.replace('[x]', '[-]') }], host(note.session))).toBe(true);

        expect(note.fired).toEqual([]);
        expect(note.editor.lines()).toEqual(['# note', checked.replace('[x]', '[-]'), '']);
    });
});

describe('readings of a flow\'s own writes (R3, F-b, L, F-a)', () => {
    it('fire nothing: the save of the editor and a sync of the note after them', async () => {
        const note = await open(['# note', WEEKLY, '- [ ] U', '']);

        note.editor.check(1);
        // The editor's save, then a sync that also touched another row.
        await note.fromOutside(note.editor.lines());
        await note.fromOutside(note.editor.lines().map(line => (line === '- [ ] U' ? '- [ ] U synced' : line)));

        expect(note.fired).toEqual(['週報']);
    });

    it('fire nothing after a card\'s completion either', async () => {
        const note = await open(['# note', WEEKLY, '- [ ] U', '']);
        await note.session.index.updateTask(note.idOf('週報'), { statusChar: 'x' });
        await note.session.flowSettled(FILE);
        const written = note.contents.get(FILE)!.split('\n');

        await note.fromOutside(written);
        await note.fromOutside([...written.slice(0, -1), '- [ ] V', '']);

        expect(note.fired).toEqual(['週報']);
    });
});

describe('a completion that arrived from outside (L1, a sync, H1)', () => {
    it('fires nothing', async () => {
        const note = await open(['# note', WEEKLY, '- [ ] 日報 @2026-09-21 ==> every 1d', '']);

        await note.fromOutside(['# note', WEEKLY.replace('[ ]', '[x]'), '- [x] 日報 @2026-09-21 ==> every 1d', '']);

        expect(note.fired).toEqual([]);
        expect(note.contents.get(FILE)!.split('\n')[1]).toBe(WEEKLY.replace('[ ]', '[x]'));
    });

    it('fires nothing though the editor was just typed in', async () => {
        const note = await open(['# note', WEEKLY, '- [ ] U', '']);

        note.editor.change({ from: note.editor.at(2, 7), insert: ' memo' }, 'input.type');
        await note.fromOutside(['# note', WEEKLY.replace('[ ]', '[x]'), '- [ ] U memo', '']);

        expect(note.fired).toEqual([]);
    });

    it('fires nothing when it reaches the open editor as `set` (the reading view\'s click, another pane)', async () => {
        const note = await open(['# note', WEEKLY, '']);

        note.editor.check(1, 'set');
        await note.fromOutside(note.editor.lines());

        expect(note.fired).toEqual([]);
    });
});

describe('a note whose tv-ignore is lifted (counterexample 1)', () => {
    const IGNORED = ['---', 'tv-ignore: true', '---', WEEKLY.replace('[ ]', '[x]'), ''];

    it('fires none of its completed rows when the editor lifts it', async () => {
        const note = await open(IGNORED);

        note.editor.change({ from: note.editor.at(1), to: note.editor.at(2), insert: '' }, 'delete.backward');

        expect(note.editor.lines()[2]).toBe(WEEKLY.replace('[ ]', '[x]'));
        expect(note.fired).toEqual([]);
    });

    it('fires none of them when a write from outside lifts it', async () => {
        const note = await open(IGNORED);

        await note.fromOutside(['---', '---', WEEKLY.replace('[ ]', '[x]'), '']);

        expect(note.fired).toEqual([]);
    });
});

describe('a copy of a parent that holds a completed row (counterexample 3)', () => {
    it('fires nothing', async () => {
        const note = await open(['# note', '- [ ] 親 @2026-09-21', '\t' + WEEKLY.replace('[ ]', '[x]'), '']);

        expect(await note.session.index.duplicateTask(note.idOf('親'), { dayOffset: 1 })).toBe(true);
        await note.session.flowSettled(FILE);

        expect(note.contents.get(FILE)!.split('\n').filter(line => line.includes('[x] 週報'))).toHaveLength(2);
        expect(note.fired).toEqual([]);
    });
});

describe('a flow\'s own completed child', () => {
    // G1's decision (2026-09-21): a generated child that reads completed and
    // carries a command of its own is let through. Written by the flow, it
    // does not fire; checked again by the user, it fires once.
    const GEN_NOTE = [
        '# note', '- [ ] 親 @2026-09-21', '\t- ==> every mon use("w")', '',
        '```tv-gen w', '- [ ] 親', '\t- [x] 生成子 ==> every 1d', '```', '',
    ];

    it('does not fire when the flow writes it, and fires once when the user checks it again', async () => {
        const note = await open(GEN_NOTE);
        note.editor.check(1);
        expect(note.fired).toEqual(['親']);

        const at = note.editor.lines().findIndex(line => line === '\t- [x] 生成子 ==> every 1d');
        expect(at).toBeGreaterThan(0);
        note.editor.change({ from: note.editor.at(at, 4), to: note.editor.at(at, 5), insert: ' ' }, 'input.type');
        note.editor.change({ from: note.editor.at(at, 4), to: note.editor.at(at, 5), insert: 'x' }, 'input.type');

        expect(note.fired).toEqual(['親', '生成子']);
    });
});
