import { describe, it, expect, afterEach } from 'vitest';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { NotePlaces } from '../../../src/services/data/NotePlaces';
import type { NoteAsk } from '../../../src/services/data/NoteName';
import type { NoteSpot } from '../../../src/services/persistence/Notes';
import { DEFAULT_SETTINGS } from '../../../src/types';

/**
 * What a destination is, read off the vault alone (`NotePlaces.read`): the
 * note the field names, there or to make, and where in it the lines would go.
 */

const TASKS = { heading: 'Tasks', level: 2, side: 'head' } as const;

let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; });

async function open(files: Record<string, string[]>) {
    const { session } = await openLiveVault(files, s => { live = s; });
    const places = new NotePlaces(session.app, () => DEFAULT_SETTINGS);
    return (note: NoteAsk, spot: NoteSpot = TASKS, folder = 'Inbox') => places.read({ note, spot }, folder);
}

const typed = (text: string): NoteAsk => ({ text, picked: null });

describe('a destination read off the vault', () => {
    it('a note there: its lines, its headings, and the heading of the section one, none or many', async () => {
        const read = await open({ 'Plan.md': ['# Top', '## Tasks', '## Done', '## Done', ''] });

        const one = await read(typed('plan'));
        expect(one).toMatchObject({
            kind: 'existing',
            path: 'Plan.md',
            to: { note: { kind: 'existing', path: 'Plan.md' }, spot: TASKS },
            heading: { kind: 'one' },
            headings: ['Top', 'Tasks', 'Done', 'Done'],
            ignored: false,
        });
        expect(one.kind === 'existing' && one.lines).toEqual(['# Top', '## Tasks', '## Done', '## Done', '']);
        expect(await read(typed('Plan'), { ...TASKS, heading: 'Later' })).toMatchObject({ heading: { kind: 'none' } });
        expect(await read(typed('Plan'), { ...TASKS, heading: 'done' })).toMatchObject({ heading: { kind: 'many', count: 2 } });
    });

    it('the end of a note there: no heading to look up, its headings all the same', async () => {
        const read = await open({ 'Plan.md': ['# Top', '## Tasks', ''] });

        expect(await read(typed('Plan'), 'end')).toMatchObject({
            kind: 'existing',
            to: { note: { kind: 'existing', path: 'Plan.md' }, spot: 'end' },
            heading: null,
            headings: ['Top', 'Tasks'],
        });
    });

    it('a note the index does not read', async () => {
        const read = await open({ 'Plan.md': ['---', 'tv-ignore: true', '---', ''], 'Open.md': [''] });

        expect(await read(typed('Plan'))).toMatchObject({ ignored: true });
        expect(await read(typed('Open'))).toMatchObject({ ignored: false });
    });

    it('a new note by a name: in the folder given, its heading to make, or none at the end', async () => {
        const read = await open({ 'Inbox/x.md': [''] });

        expect(await read(typed('設計'))).toMatchObject({
            kind: 'new',
            by: 'name',
            folderMade: null,
            namesakes: [],
            path: 'Inbox/設計.md',
            to: { note: { kind: 'new', path: 'Inbox/設計.md' }, spot: TASKS },
            heading: { kind: 'none' },
            headings: [],
            ignored: false,
        });
        expect(await read(typed('設計'), 'end')).toMatchObject({ kind: 'new', to: { spot: 'end' }, heading: null });
    });

    it('a new note by a path: the first folder it makes, and the notes by its name in other folders', async () => {
        const read = await open({ 'Projects/old.md': [''], 'a/Plan.md': [''] });

        expect(await read(typed('projects/web/設計'))).toMatchObject({ kind: 'new', by: 'path', folderMade: 'Projects/web', path: 'Projects/web/設計.md' });
        const namesake = await read(typed('b/Plan'));
        expect(namesake.kind === 'new' && namesake.namesakes.map(file => file.path)).toEqual(['a/Plan.md']);
    });

    it('more than one note by the name: which, until one is picked', async () => {
        const read = await open({ 'a/Plan.md': [''], 'b/plan.md': [''] });

        const many = await read(typed('Plan'));
        expect(many.kind === 'ambiguous' && [many.name, many.files.map(f => f.path)]).toEqual(['Plan', ['a/Plan.md', 'b/plan.md']]);
        expect(await read({ text: 'Plan', picked: 'b/plan.md' })).toMatchObject({ kind: 'existing', path: 'b/plan.md' });
    });

    it('a note held as picked that is not there: the new note at its path, not the one its name would make', async () => {
        const read = await open({ 'Daily/old.md': [''], 'Inbox/2031-01-15.md': [''] });

        expect(await read({ text: '2031-01-15', picked: '2031-01-15.md' })).toMatchObject({
            kind: 'new', by: 'path', path: '2031-01-15.md', to: { note: { kind: 'new', path: '2031-01-15.md' } },
        });
        expect(await read({ text: '2031-01-15', picked: 'daily/2031-01-15.md' })).toMatchObject({
            kind: 'new', path: 'daily/2031-01-15.md', to: { note: { kind: 'new', path: 'daily/2031-01-15.md' } },
        });
    });

    it('a name no note can have: why', async () => {
        const read = await open({ 'x.md': [''] });

        expect(await read(typed('a:b'))).toMatchObject({ kind: 'unnamed', why: { ok: false, why: 'chars' } });
        expect(await read(typed('   '))).toMatchObject({ kind: 'unnamed' });
    });
});

describe('a destination read off its fields', () => {
    it('a heading typed names its section at the settings\' level and side; none typed, the note\'s end', async () => {
        const { session } = await openLiveVault({ 'Plan.md': ['## Tasks', ''] }, s => { live = s; });
        const settings = { ...DEFAULT_SETTINGS, taskHeadingLevel: 3, sectionSide: 'end' as const };
        const places = new NotePlaces(session.app, () => settings);

        expect(await places.readFields({ note: typed('Plan'), heading: ' Log ' }, ''))
            .toMatchObject({ to: { spot: { heading: 'Log', level: 3, side: 'end' } }, heading: { kind: 'none' } });
        expect(await places.readFields({ note: typed('Plan'), heading: '  ' }, ''))
            .toMatchObject({ to: { note: { kind: 'existing', path: 'Plan.md' }, spot: 'end' }, heading: null });
    });
});
