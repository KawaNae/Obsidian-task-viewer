import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Notice, TFolder } from 'obsidian';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { NoteOps } from '../../../src/services/data/NoteOps';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { t } from '../../../src/i18n';
import { refusalClause, refusalNotice } from '../../../src/services/core/RefusalClause';
import type { DestinationAsk, DestinationFacts, SendDestination } from '../../../src/services/data/NoteOps';

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
    it('opens on each row once, in the order they stand, with its note\'s lines, to the settings\' section', async () => {
        const note = await open(['- [ ] A', '- [ ] P', '    - [ ] c', '']);

        const preview = await note.ops.previewSend([note.idOf('c'), note.idOf('P'), note.idOf('A')]);

        expect(preview?.rows.map(row => row.task.content)).toEqual(['A', 'P']);
        expect(preview?.rows[1].task.subtreeLines).toEqual(['- [ ] P', '    - [ ] c']);
        expect(preview?.rows[0].lines).toEqual(note.lines());
        expect(preview?.defaults.section).toEqual({ heading: 'Tasks', level: 2, side: 'head' });
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

describe('previewSend: the note by default', () => {
    const noteOf = async (row: string, others: Record<string, string[]> = {}) => {
        const note = await open([row, ''], others);
        newNotesIn(note, 'Inbox');
        return (await note.ops.previewSend([note.session.index.getTasks()[0].id]))!.defaults.note;
    };

    it('the one note the row links to', async () => {
        expect(await noteOf('- [ ] 読む [[plan]]', { 'Projects/Plan.md': ['# p', ''] }))
            .toEqual({ kind: 'existing', path: 'Projects/Plan.md' });
        expect(await noteOf('- [ ] 読む [計画](Projects/Plan.md)', { 'Projects/Plan.md': ['# p', ''] }))
            .toEqual({ kind: 'existing', path: 'Projects/Plan.md' });
    });

    it('a link no note answers: a new note where the link spells it, or in the folder for new notes', async () => {
        expect(await noteOf('- [ ] 読む [[Ideas/Later#h|あとで]]')).toEqual({ kind: 'new', folder: 'Ideas', name: 'Later' });
        expect(await noteOf('- [ ] 読む [[Later]]')).toEqual({ kind: 'new', folder: 'Inbox', name: 'Later' });
    });

    it('no link, or more than one: a new note in the folder for new notes, named after the row', async () => {
        expect(await noteOf('- [ ] 設計 #plan')).toEqual({ kind: 'new', folder: 'Inbox', name: '設計' });
        expect(await noteOf('- [ ] [[a]] と [[b]]', { 'a.md': [''], 'b.md': [''] })).toEqual({ kind: 'new', folder: 'Inbox', name: 'a と b' });
        // A link into its own note names none.
        expect(await noteOf('- [ ] 見る [[#Done]]')).toEqual({ kind: 'new', folder: 'Inbox', name: '見る' });
    });
});

describe('previewSend: candidates and links', () => {
    it('offers what the row inherits, Obsidian\'s own keys marked', async () => {
        const note = await open(['---', 'aliases: [x]', 'k: 1', '---', '- [ ] A', '']);

        const preview = (await note.ops.previewSend([note.idOf('A')]))!;

        expect(preview.candidates.map(one => [one.key, one.obsidian])).toEqual([['aliases', true], ['k', false]]);
    });

    it('of more than one row, only the keys every row inherits alike', async () => {
        const note = await open([
            '---', 'k: 1', '---',
            '## a', '- same:: s', '- differ:: 1', '- only:: o', '- [ ] A',
            '## b', '- same:: s', '- differ:: 2', '- [ ] B', '',
        ]);

        const preview = (await note.ops.previewSend([note.idOf('A'), note.idOf('B')]))!;

        expect(preview.candidates.map(one => one.key)).toEqual(['k', 'same']);
    });

    it('the links to a block of the rows\' subtrees, from elsewhere and from the rest of the note', async () => {
        const note = await open(
            ['- [ ] A ^a', '    - [ ] c ^c', '- [ ] B', '    - [[#^c]]', '- see [[#^a]]', ''],
            { 'other.md': ['x [[note#^c]]', ''] },
        );

        const preview = (await note.ops.previewSend([note.idOf('A'), note.idOf('B')]))!;

        // The link on line 3 goes with B.
        expect(preview.links).toEqual([
            { anchor: 'a', from: FILE, line: 4 },
            { anchor: 'c', from: 'other.md', line: 0 },
        ]);
    });
});

describe('destinationFacts', () => {
    const facts = async (lines: string[], ask: Partial<DestinationAsk>, others: Record<string, string[]> = {}, sent = ['A']) => {
        const note = await open(lines, others);
        const preview = (await note.ops.previewSend(sent.map(note.idOf)))!;
        return note.ops.destinationFacts(preview, { folder: '', name: 'X', heading: '', ...ask });
    };

    it('a name no note can have: why', async () => {
        expect(await facts(['- [ ] A', ''], { name: 'a|b' })).toEqual({ kind: 'unnamed', why: { ok: false, why: 'chars', chars: '|' } });
        expect(await facts(['- [ ] A', ''], { name: ' ' })).toEqual({ kind: 'unnamed', why: { ok: false, why: 'empty' } });
    });

    it('a new note: to make, its heading made, the settings\' when none is typed', async () => {
        const found = await facts(['- [ ] A', ''], { folder: 'projects', name: '設計' }, { 'Projects/old.md': [''] });

        expect(found).toMatchObject({
            kind: 'new',
            path: 'Projects/設計.md',
            to: { note: { kind: 'new', folder: 'projects', name: '設計' }, section: { heading: 'Tasks', level: 2, side: 'head' } },
            heading: { kind: 'none' },
            headings: [],
            present: [],
            ignored: false,
            namesakes: [],
            shared: [],
            unresolved: [],
        });
    });

    it('a note there is, named in another case: that note, and its heading one, none or many', async () => {
        const other = { 'Plan.md': ['# Top', '## Tasks', '## Done', '## Done', ''] };

        const one = await facts(['- [ ] A', ''], { name: 'plan' }, other);
        expect(one).toMatchObject({ kind: 'existing', path: 'Plan.md', to: { note: { kind: 'existing', path: 'Plan.md' } }, heading: { kind: 'one' } });
        expect(one.kind !== 'unnamed' && one.headings).toEqual(['Top', 'Tasks', 'Done', 'Done']);

        expect(await facts(['- [ ] A', ''], { name: 'Plan', heading: ' Later ' }, other))
            .toMatchObject({ to: { section: { heading: 'Later' } }, heading: { kind: 'none' } });
        expect(await facts(['- [ ] A', ''], { name: 'Plan', heading: 'done' }, other))
            .toMatchObject({ heading: { kind: 'many', count: 2 } });
    });

    it('the rows\' own note: same, and another note holding only some of them: existing', async () => {
        expect(await facts(['- [ ] A', ''], { name: 'note' })).toMatchObject({ kind: 'same', path: FILE });
        expect(await facts(['- [ ] A', ''], { name: 'note' }, { 'b.md': ['- [ ] B', ''] }, ['A', 'B'])).toMatchObject({ kind: 'existing' });
    });

    it('the keys offered that the note has already', async () => {
        const found = await facts(['---', 'k: 1', 'm: 2', '---', '- [ ] A', ''], { name: 'Plan' }, { 'Plan.md': ['---', 'm: 9', '---', ''] });

        expect(found).toMatchObject({ present: ['m'] });
    });

    it('a note the index does not read', async () => {
        expect(await facts(['- [ ] A', ''], { name: 'Plan' }, { 'Plan.md': ['---', 'tv-ignore: true', '---', ''] })).toMatchObject({ ignored: true });
        expect(await facts(['- [ ] A', ''], { name: 'Plan' }, { 'Plan.md': [''] })).toMatchObject({ ignored: false });
    });

    it('notes by the same name in other folders', async () => {
        const found = await facts(['- [ ] A', ''], { name: 'Plan' }, { 'a/Plan.md': [''] });

        expect(found.kind !== 'unnamed' && found.namesakes.map(file => file.path)).toEqual(['a/Plan.md']);
    });

    it('the ^ids a row of another note shares with the note; none for rows of the note itself', async () => {
        const lines = ['- [ ] A ^a', '    - [ ] c ^c', '- [ ] B ^b', ''];

        expect(await facts(lines, { name: 'Plan' }, { 'Plan.md': ['x ^c', 'y ^z', ''] })).toMatchObject({ shared: ['c'] });
        expect(await facts(lines, { name: 'note' }, {}, ['A', 'B'])).toMatchObject({ shared: [] });
    });

    it('the commands of the rows and their descendants the note does not resolve, the heading it makes counted', async () => {
        const lines = ['- [ ] A', '    - [ ] c @2026-09-28 ==> move([[#Done]])', '    - [ ] d @2026-09-28 ==> move([[#Tasks]])', ''];
        const unresolved = (found: DestinationFacts) => found.kind === 'unnamed' ? null : found.unresolved.map(one => one.kind === 'heading' && [one.task.content, one.name, one.found]);

        expect(unresolved(await facts(lines, { name: 'X' }))).toEqual([['c', 'Done', 'none']]);
        expect(unresolved(await facts(lines, { name: 'Plan' }, { 'Plan.md': ['## Done', ''] }))).toEqual([]);
        expect(unresolved(await facts(lines, { name: 'Plan', heading: 'Done' }, { 'Plan.md': ['# p', ''] }))).toEqual([['d', 'Tasks', 'none']]);
    });
});

describe('send', () => {
    it('sends to a section of the rows\' own note', async () => {
        const note = await open(['- [ ] A', '    - [ ] a', '## Tasks', '']);
        const preview = (await note.ops.previewSend([note.idOf('A')]))!;
        const facts = await note.ops.destinationFacts(preview, { folder: '', name: 'note', heading: '' });
        if (facts.kind === 'unnamed') throw new Error('named');

        const sent = await note.ops.send({
            rows: preview.rows.map(({ task }) => ({ taskId: task.id, base: task.subtreeLines! })),
            to: facts.to,
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

        const why = [
            t('notice.notSent'),
            t('notice.sendRefused', { note: FILE, reason: refusalClause({ kind: 'changed' }), subject: 'A' }),
        ].join(' ');
        expect(sent).toEqual({ kind: 'not-done', why });
        expect(note.contents.has('X.md')).toBe(false);
        expect(Notice.messages).toEqual([why]);
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

        const wrongly = { kind: 'not-done', why: t('notice.notSent') };
        expect(await note.ops.send({ rows: [note.row('A')], to: NEW('', 'a|b'), frontmatter: [] })).toEqual(wrongly);
        expect(await note.ops.send({ rows: [note.row('A')], to: NEW('', 'X'), frontmatter: [key, key] })).toEqual(wrongly);
        expect([...note.contents.keys()]).toEqual([FILE]);
        expect(Notice.messages).toEqual([]);
    });
});

describe('send: a refusal the caller shows (tellRefusal: false)', () => {
    const quiet = { tellRefusal: false };

    it('the note sent to turned away: not told, and why answered', async () => {
        const note = await open(['- [ ] A', ''], { 'Plan.md': ['## Tasks', '### tasks', ''] });
        const to = { note: { kind: 'existing' as const, path: 'Plan.md' }, section: SECTION };

        const sent = await note.ops.send({ rows: [note.row('A')], to, frontmatter: [] }, quiet);

        // Said of the row sent, though the note sent to holds none of the rows.
        expect(sent).toEqual({ kind: 'not-done', why: refusalNotice({ file: 'Plan.md', reason: { kind: 'headings', name: 'Tasks', count: 2 }, subject: 'A' }) });
        expect(Notice.messages).toEqual([]);
        // Told by default, in the same words.
        expect(await note.ops.send({ rows: [note.row('A')], to, frontmatter: [] })).toEqual(sent);
        expect(Notice.messages).toEqual([sent.kind === 'not-done' && sent.why]);
    });

    it('the note a row comes from turned its write away as it was tried: not told, nothing made', async () => {
        const note = await open(['- [ ] A', '    ```', '    x', '    ```', 'para', '']);
        const row = { ...note.row('A'), draft: { text: '- [ ] A', children: [{ text: '    ```', was: 1 }, { text: '    x', was: 2 }] } };

        const sent = await note.ops.send({ rows: [row], to: NEW('', 'X'), frontmatter: [] }, quiet);

        expect(sent).toMatchObject({ kind: 'not-done', why: expect.stringContaining('A') });
        expect(note.contents.has('X.md')).toBe(false);
        expect(Notice.messages).toEqual([]);
    });

    it('a row the index read otherwise than the disk holds: not told, why answered, and the note read again', async () => {
        const note = await open(['- [ ] A', '']);
        const row = note.row('A');
        // Changed from outside, and the index never told.
        note.contents.set(FILE, '- [ ] A2\n');

        const sent = await note.ops.send({ rows: [row], to: NEW('', 'X'), frontmatter: [] }, quiet);

        expect(sent).toEqual({ kind: 'not-done', why: t('notice.readAgain', { subject: 'A' }) });
        expect(Notice.messages).toEqual([]);
        await note.session.settle(FILE);
        expect(note.session.index.getTasks().map(one => one.content)).toEqual(['A2']);
    });

    it('every note the rows came from refused, and what went taken back: not told, why answered', async () => {
        const note = await open(['- [ ] A', '']);
        refuseNext(note, FILE);

        const sent = await note.ops.send({ rows: [note.row('A')], to: NEW('', 'X'), frontmatter: [] }, quiet);

        expect(sent).toEqual({
            kind: 'not-done',
            why: [t('notice.notSent'), t('notice.sendRefused', { note: FILE, reason: refusalClause({ kind: 'changed' }), subject: 'A' })].join(' '),
        });
        expect(note.contents.has('X.md')).toBe(false);
        expect(Notice.messages).toEqual([]);
    });

    it('some rows sent: told all the same, the note written, and why answered too', async () => {
        const note = await open(['- [ ] A', ''], { 'b.md': ['- [ ] B', ''] });
        refuseNext(note, 'b.md');

        const sent = await note.ops.send({ rows: [note.row('A'), note.row('B')], to: NEW('', 'X'), frontmatter: [] }, quiet);

        expect(sent.kind === 'partly' && sent.why).toBe(Notice.messages[0]);
        expect(Notice.messages).toHaveLength(1);
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

/** Make Obsidian's place for new notes, as the user's settings say it, the folder `path`. */
function newNotesIn(note: { session: VaultSession }, path: string): void {
    const fileManager = note.session.app.fileManager as unknown as { getNewFileParent: (source: string) => TFolder };
    fileManager.getNewFileParent = () => Object.assign(new TFolder(), { path });
}
