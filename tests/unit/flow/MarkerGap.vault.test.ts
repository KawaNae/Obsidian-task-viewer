import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * A task line written over keeps its indentation, its list marker and the
 * gap after the marker, as wide as it was and made of spaces
 * (`TaskLineClassifier.extractMarker`). The gap sets the
 * item's content column, and a child reaches the item by it: under `-\t[ ] T`
 * a child two spaces past a tab is T's, under `- [ ] T` it goes on T's
 * paragraph, and its task and ID were gone after T was only checked off (the
 * fourth L2 counterexample run, G2).
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
    const contents = new Map([[FILE, lines.join('\n')]]);
    live = vaultSession(contents);
    await live.scanAll();
    return { contents, session: live };
}

function taskWorded(session: VaultSession, content: string) {
    const found = session.index.getTasks().filter(task => task.file === FILE && task.content === content);
    expect(found).toHaveLength(1);
    return found[0];
}

async function complete(session: VaultSession, content: string): Promise<void> {
    expect(await session.index.updateTask(taskWorded(session, content).id, { statusChar: 'x' })).toBe(true);
    await session.settle(FILE);
}

describe('a task line written over', () => {
    for (const [name, above, row, written, child] of [
        ['a tab after the marker, as the spaces it is wide', [], '-\t[ ] T @2026-09-21', '-   [x] T @2026-09-21', '\t  - [ ] c'],
        ['four spaces after the marker', [], '-    [ ] T @2026-09-21', '-    [x] T @2026-09-21', '      - [ ] c'],
        ['an indented row with four spaces after its marker', ['- [ ] P'], '\t-    [ ] T @2026-09-21', '\t-    [x] T @2026-09-21', '\t      - [ ] c'],
    ] as const) {
        it(`keeps ${name} when checked off, and its child with its ID`, async () => {
            const { contents, session } = await open(['# note', ...above, row, child, '- [ ] U', '']);
            const c = taskWorded(session, 'c').id;

            await complete(session, 'T');

            expect(contents.get(FILE)!.split('\n')).toEqual(['# note', ...above, written, child, '- [ ] U', '']);
            expect(session.index.getTask(c)?.parentId).toBe(taskWorded(session, 'T').id);
        });
    }

    it('keeps the gap when a fire strips its command', async () => {
        const { contents, session } = await open(['# note', '-\t[ ] T @2026-09-21 ==> every mon', '\t  - [ ] c', '- [ ] U', '']);
        const c = taskWorded(session, 'c').id;

        await complete(session, 'T');

        const lines = contents.get(FILE)!.split('\n');
        expect(lines).toContain('-   [x] T @2026-09-21');
        expect(lines[lines.indexOf('-   [x] T @2026-09-21') + 1]).toBe('\t  - [ ] c');
        expect(session.index.getTask(c)?.content).toBe('c');
        expect(Notice.messages).toEqual([]);
    });

    it('keeps the gap when a move within the note carries it with its child', async () => {
        const { contents, session } = await open(['# note', '-    [ ] T @2026-09-21 ==> move([[note]])', '      - [ ] c', '- [ ] U', '']);

        await complete(session, 'T');

        const lines = contents.get(FILE)!.split('\n');
        const at = lines.findIndex(line => line.startsWith('-    [x] T'));
        expect(at).toBeGreaterThan(-1);
        expect(lines[at + 1]).toBe('      - [ ] c');
        const c = session.index.getTasks().find(task => task.content === 'c')!;
        expect(session.index.getTask(c.parentId!)?.content).toBe('T');
    });

    it('keeps the gap when a property line is deleted', async () => {
        const { contents, session } = await open(['# note', '-    [ ] T', '     - memo:: a', '      - [ ] c', '- [ ] U', '']);
        const c = taskWorded(session, 'c').id;

        await session.index.updateTask(taskWorded(session, 'T').id, { properties: {} } as never);
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toEqual(['# note', '-    [ ] T', '      - [ ] c', '- [ ] U', '']);
        expect(session.index.getTask(c)?.parentId).toBe(taskWorded(session, 'T').id);
    });
});

/**
 * A tab's width is the column it stands at. Kept as a tab on a task moved to
 * column 0, `  -\t[ ] T` put its content four past its marker, not two, while
 * its children moved two to the left: siblings at the top, T's property a
 * note bullet, and a child deep enough a paragraph line (the fifth L2
 * counterexample run, H1). Kept as the spaces it was wide, the content stands
 * as far past the marker wherever the line goes.
 */
describe('a task moved to another indentation', () => {
    async function openNotes(files: Record<string, string[]>) {
        const contents = new Map(Object.entries(files).map(([name, lines]) => [name, lines.join('\n')]));
        live = vaultSession(contents);
        await live.scanAll();
        return { contents, session: live };
    }

    async function completeIn(session: VaultSession, content: string, files: string[]): Promise<void> {
        const task = session.index.getTasks().find(each => each.content === content)!;
        expect(await session.index.updateTask(task.id, { statusChar: 'x' })).toBe(true);
        for (const file of files) await session.settle(file);
    }

    function movedIn(session: VaultSession, file: string) {
        const tasks = session.index.getTasks().filter(task => task.file === file);
        return { T: tasks.find(task => task.content === 'T')!, c: tasks.find(task => task.content === 'c') };
    }

    it('keeps its children and its properties within the note', async () => {
        const { contents, session } = await openNotes({
            [FILE]: ['# note', '- [ ] P', '  -\t[ ] T @2026-09-21 ==> move([[note]])', '    - [ ] c', '    - memo:: a', '- [ ] U', ''],
        });

        await completeIn(session, 'T', [FILE]);

        expect(contents.get(FILE)!.split('\n')).toEqual(['# note', '- [ ] P', '- [ ] U', '- [x] T @2026-09-21', '  - [ ] c', '  - memo:: a', '']);
        const { T, c } = movedIn(session, FILE);
        expect(c?.parentId).toBe(T.id);
        expect(T.properties?.memo?.value).toBe('a');
    });

    it('keeps its child in the archive', async () => {
        const { contents, session } = await openNotes({
            [FILE]: ['# note', ' -\t[ ] T @2026-09-21 ==> move([[archive]])', '    - [ ] c', '- [ ] U', ''],
            'archive.md': ['# archive', ''],
        });

        await completeIn(session, 'T', [FILE, 'archive.md']);

        expect(contents.get('archive.md')!.split('\n')).toContain('-  [x] T @2026-09-21');
        const { T, c } = movedIn(session, 'archive.md');
        expect(c?.parentId).toBe(T.id);
    });

    it('keeps a child deep in its item a task in the archive', async () => {
        const { contents, session } = await openNotes({
            [FILE]: ['# note', '- [ ] P', '  1.\t[ ] T @2026-09-21 ==> move([[archive]])', '           - [ ] c', '- [ ] U', ''],
            'archive.md': ['# archive', ''],
        });

        await completeIn(session, 'T', [FILE, 'archive.md']);

        expect(contents.get('archive.md')!.split('\n')).toContain('1.    [x] T @2026-09-21');
        const { T, c } = movedIn(session, 'archive.md');
        expect(c?.parentId).toBe(T.id);
    });
});
