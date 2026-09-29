import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { NoteOps } from '../../../src/services/data/NoteOps';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { t } from '../../../src/i18n';
import { refusalClause } from '../../../src/services/core/RefusalClause';
import type { SendDestination } from '../../../src/services/data/NoteOps';

/**
 * The send operation as the UI asks for it (`NoteOps`): what its dialog
 * opens on, the note a send goes to, and the one notice of what came of it.
 */

const FILE = 'note.md';

let live: VaultSession | undefined;
beforeEach(() => { Notice.messages.length = 0; });
afterEach(() => { live?.dispose(); live = undefined; });

async function open(lines: string[], others: Record<string, string[]> = {}) {
    const { contents, session } = await openLiveVault({ [FILE]: lines, ...others }, s => { live = s; });
    const ops = new NoteOps(session.app, new TaskWriteService(session.index), () => ({ ...DEFAULT_SETTINGS }));
    const idOf = (content: string) => session.index.getTasks().find(one => one.content === content)!.id;
    const row = (content: string) => {
        const task = session.index.getTasks().find(one => one.content === content)!;
        return { taskId: task.id, base: task.subtreeLines! };
    };
    return { contents, session, ops, idOf, row, lines: () => contents.get(FILE)!.split('\n') };
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

    it('within the rows\' own note: not told', async () => {
        const note = await open(['- [ ] A', '## Tasks', '']);

        await note.ops.send({ rows: [note.row('A')], to: { note: { kind: 'existing', path: FILE }, section: SECTION }, frontmatter: [] });

        expect(Notice.messages).toEqual([]);
    });

    it('to a new note: made, and told once, with the undo it cannot take back whole', async () => {
        const note = await open(['- [ ] A', '']);

        const sent = await note.ops.send({ rows: [note.row('A')], to: NEW('Projects', '設計'), frontmatter: [{ key: 'k', yaml: ['k: 1'], from: [], obsidian: false }] });

        expect(sent.kind === 'done' && sent.note.path).toBe('Projects/設計.md');
        expect(note.contents.get('Projects/設計.md')).toBe('---\nk: 1\n---\n\n## Tasks\n- [ ] A\n');
        expect(Notice.messages).toEqual([t('notice.sent', { subject: 'A', note: 'Projects/設計.md' })]);
    });

    it('to a new note by the path a note has in another case: to that note', async () => {
        const note = await open(['- [ ] A', ''], { 'Projects/Plan.md': ['# p', ''] });

        const sent = await note.ops.send({ rows: [note.row('A')], to: NEW('projects', 'plan.md'), frontmatter: [] });

        expect(sent.kind === 'done' && sent.note.path).toBe('Projects/Plan.md');
        expect(note.contents.get('Projects/Plan.md')).toBe('# p\n\n## Tasks\n- [ ] A\n');
        expect(note.lines()).toEqual(['- [[Plan]]', '']);
    });

    it('of two rows: told once for both', async () => {
        const note = await open(['- [ ] A', '- [ ] B', '']);

        await note.ops.send({ rows: [note.row('A'), note.row('B')], to: NEW('', 'X'), frontmatter: [] });

        expect(Notice.messages).toEqual([t('notice.sentRows', { count: 2, note: 'X.md' })]);
    });

    it('whose note refused: not made, the note taken away, and told once why', async () => {
        const note = await open(['- [ ] A', '']);
        refuseNext(note, FILE);

        const sent = await note.ops.send({ rows: [note.row('A')], to: NEW('', 'X'), frontmatter: [] });

        expect(sent).toEqual({ kind: 'not-done' });
        expect(note.contents.has('X.md')).toBe(false);
        expect(Notice.messages).toEqual([[
            t('notice.notSent'),
            t('notice.sendRefused', { note: FILE, reason: refusalClause({ kind: 'changed' }), subject: 'A' }),
        ].join(' ')]);
    });

    it('one of whose notes refused: made for the others, and told once which did not go and why', async () => {
        const note = await open(['- [ ] A', ''], { 'b.md': ['- [ ] B', ''] });
        refuseNext(note, 'b.md');

        const sent = await note.ops.send({ rows: [note.row('A'), note.row('B')], to: NEW('', 'X'), frontmatter: [] });

        expect(sent.kind === 'partly' && [sent.note.path, sent.refused]).toEqual(['X.md', ['b.md']]);
        expect(Notice.messages).toEqual([[
            t('notice.sentPartly', { note: 'X.md' }),
            t('notice.sendRefused', { note: 'b.md', reason: refusalClause({ kind: 'changed' }), subject: 'B' }),
        ].join(' ')]);
    });

    it('whose note refused, the note written since: the rows are in both notes, and the notice says so', async () => {
        const note = await open(['- [ ] A', '']);
        refuseNext(note, FILE, () => note.contents.set('X.md', note.contents.get('X.md') + 'typed\n'));

        const sent = await note.ops.send({ rows: [note.row('A')], to: NEW('', 'X'), frontmatter: [] });

        expect(sent.kind === 'partly' && sent.refused).toEqual([FILE]);
        expect(Notice.messages).toEqual([[
            t('notice.notSent'),
            t('notice.sendRefused', { note: FILE, reason: refusalClause({ kind: 'changed' }), subject: 'A' }),
            t('notice.sendStranded', { note: 'X.md' }),
        ].join(' ')]);
    });

    it('asked wrongly — a name no note can have, a key given twice — is not made', async () => {
        const note = await open(['- [ ] A', '']);
        const key = { key: 'k', yaml: ['k: 1'], from: [], obsidian: false };

        expect(await note.ops.send({ rows: [note.row('A')], to: NEW('', 'a|b'), frontmatter: [] })).toEqual({ kind: 'not-done' });
        expect(await note.ops.send({ rows: [note.row('A')], to: NEW('', 'X'), frontmatter: [key, key] })).toEqual({ kind: 'not-done' });
        expect([...note.contents.keys()]).toEqual([FILE]);
        expect(Notice.messages).toEqual([]);
    });
});

const SECTION = { heading: 'Tasks', level: 2, side: 'head' as const };

function NEW(folder: string, name: string): SendDestination {
    return { note: { kind: 'new', folder, name }, section: SECTION };
}

/** Before the next write to `path`, edit it from outside — and do `also` — so the write is refused as `changed`. */
function refuseNext(note: { contents: Map<string, string>; session: VaultSession }, path: string, also?: () => void): void {
    const vault = note.session.app.vault as unknown as { process: (file: { path: string }, fn: (data: string) => string) => Promise<string> };
    const process = vault.process.bind(vault);
    let armed = true;
    vault.process = async (file, fn) => {
        if (armed && file.path === path) {
            armed = false;
            note.contents.set(path, note.contents.get(path) + '- [ ] typed\n');
            also?.();
        }
        return process(file, fn);
    };
}
