import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { NoteOps } from '../../../src/services/data/NoteOps';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import { DEFAULT_SETTINGS } from '../../../src/types';

/**
 * The send operation as the UI asks for it (`NoteOps`, 段 B2): what its
 * dialog opens on, and a send to the rows' own note.
 */

const FILE = 'note.md';

let live: VaultSession | undefined;
beforeEach(() => { Notice.messages.length = 0; });
afterEach(() => { live?.dispose(); live = undefined; });

async function open(lines: string[]) {
    const { contents, session } = await openLiveVault({ [FILE]: lines }, s => { live = s; });
    const ops = new NoteOps(new TaskWriteService(session.index), () => ({ ...DEFAULT_SETTINGS }));
    const idOf = (content: string) => session.index.getTasks().find(one => one.content === content)!.id;
    return { contents, session, ops, idOf, lines: () => contents.get(FILE)!.split('\n') };
}

describe('previewSend', () => {
    it('opens on each row once, in the order they stand, with its note\'s lines, to the settings\' section of the note', async () => {
        const note = await open(['- [ ] A', '- [ ] P', '    - [ ] c', '']);

        const preview = await note.ops.previewSend([note.idOf('c'), note.idOf('P'), note.idOf('A')]);

        expect(preview?.rows.map(row => row.task.content)).toEqual(['A', 'P']);
        expect(preview?.rows[1].task.subtreeLines).toEqual(['- [ ] P', '    - [ ] c']);
        expect(preview?.rows[0].lines).toEqual(note.lines());
        expect(preview?.defaults).toEqual({ note: { kind: 'existing', path: FILE }, section: { heading: 'Tasks', level: 2, side: 'head' } });
    });

    it('opens on nothing when a row is not the one on the disk, and the user is told', async () => {
        const note = await open(['- [ ] A', '']);
        const id = note.idOf('A');
        // Changed from outside, and the index never told.
        note.contents.set(FILE, '- [ ] A2\n');

        expect(await note.ops.previewSend([id])).toBeNull();
        expect(Notice.messages).toHaveLength(1);
    });
});

describe('send', () => {
    it('sends to a section of the rows\' own note', async () => {
        const note = await open(['- [ ] A', '    - [ ] a', '## Tasks', '']);
        const preview = (await note.ops.previewSend([note.idOf('A')]))!;

        const sent = await note.ops.send({
            rows: preview.rows.map(({ task }) => ({ taskId: task.id, base: task.subtreeLines! })),
            to: preview.defaults,
            frontmatter: [],
        });

        expect(sent.kind === 'done' && sent.note.path).toBe(FILE);
        expect(note.lines()).toEqual(['## Tasks', '- [ ] A', '    - [ ] a', '']);
    });

    it('does not send to a new note yet, nor write frontmatter, and writes nothing', async () => {
        const note = await open(['- [ ] A', '## Tasks', '']);
        const task = note.session.index.getTask(note.idOf('A'))!;
        const rows = [{ taskId: task.id, base: task.subtreeLines! }];
        const section = { heading: 'Tasks', level: 2, side: 'head' as const };

        expect(await note.ops.send({ rows, to: { note: { kind: 'new', folder: '', name: 'X' }, section }, frontmatter: [] })).toEqual({ kind: 'not-done' });
        expect(await note.ops.send({
            rows, to: { note: { kind: 'existing', path: FILE }, section },
            frontmatter: [{ key: 'k', yaml: ['k: v'], from: [], obsidian: false }],
        })).toEqual({ kind: 'not-done' });
        expect(note.lines()).toEqual(['- [ ] A', '## Tasks', '']);
    });
});
