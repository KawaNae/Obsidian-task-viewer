import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { t } from '../../../src/i18n';
import { PlaceFields, type PlaceFieldsHost, type PlaceViewState } from '../../../src/modals/place/PlaceFields';
import type { DestinationAsk, NoteDestination, NotePlace, NoteRead } from '../../../src/services/data/NotePlaces';

/**
 * The place fields as logic (`PlaceFields`), apart from the DOM: the host
 * answers the destination as told and records what it is told, and the
 * surface records what it was told to show.
 */

const SECTION = { heading: 'Tasks', level: 2, side: 'head' as const };

/** A note the fields name: one there is, `Plan.md` with its section's heading found once, unless `overrides` say otherwise. */
function place(overrides: Partial<Extract<NotePlace, { kind: 'existing' }>> | ({ kind: 'new' } & Partial<Extract<NotePlace, { kind: 'new' }>>) = {}): NotePlace {
    if (overrides.kind === 'new') {
        const path = overrides.path ?? 'Inbox/A.md';
        const spot = overrides.to?.spot ?? SECTION;
        return {
            by: 'name',
            folderMade: null,
            namesakes: [],
            path,
            to: { note: { kind: 'new', path }, spot },
            heading: spot === 'end' ? null : { kind: 'none' },
            headings: [],
            ignored: false,
            ...overrides,
        };
    }
    const path = overrides.path ?? 'Plan.md';
    return {
        kind: 'existing',
        lines: [],
        path,
        to: { note: { kind: 'existing', path }, spot: SECTION },
        heading: { kind: 'one', heading: { level: 2, text: 'Tasks', line: 0 } as never },
        headings: ['Tasks', 'Done'],
        ignored: false,
        ...overrides,
    };
}

/** The existing `Plan.md` with the lines going to `spot`, the heading as looked up there. */
function at(spot: NoteDestination['spot'], heading: NotePlace['heading']): NotePlace {
    return place({ to: { note: { kind: 'existing', path: 'Plan.md' }, spot }, heading });
}

const typed = (text: string) => ({ text, picked: null });
const EMPTY: NoteRead = { kind: 'unnamed', why: { ok: false, why: 'empty', at: 'name' } };
const CHARS: NoteRead = { kind: 'unnamed', why: { ok: false, why: 'chars', chars: '|', at: 'name' } };

/**
 * Fields on `initial`, the host's readings left to the test to answer, and
 * what the host was told in one list, in the order it was told: `reading`
 * for each time the fields were typed in, and each answer.
 */
function setUp(initial: DestinationAsk = { note: typed(''), heading: 'Tasks' }) {
    const states: PlaceViewState[] = [];
    const asks: { ask: DestinationAsk; answer(read: NoteRead): Promise<void>; fail(e: Error): Promise<void> }[] = [];
    const told: unknown[] = [];
    const host: PlaceFieldsHost = {
        read: (ask) => new Promise<NoteRead>((resolve, reject) => {
            const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
            asks.push({
                ask,
                answer: async (read) => { resolve(read); await settle(); },
                fail: async (e) => { reject(e); await settle(); },
            });
        }),
        reading: vi.fn(() => { told.push('reading'); }),
        answered: vi.fn((answer) => { told.push(answer); }),
    };
    const fields = new PlaceFields(initial, host, { render: (state) => { states.push(state); } });
    return {
        fields, asks, host, told,
        state: () => states[states.length - 1],
        /** Answer the last asking of the destination. */
        answer: (read: NoteRead) => asks[asks.length - 1].answer(read),
    };
}

/** Fields whose destination is answered `read`. */
async function answered(read: NoteRead, initial?: DestinationAsk) {
    const h = setUp(initial);
    await h.answer(read);
    return h;
}

/** What the fields say of `at`, each text with its tone. */
function says(state: PlaceViewState, at: 'note' | 'heading'): { text: string; tone: string }[] {
    return state.issues.filter(issue => issue.at === at).map(issue => ({ text: issue.text, tone: issue.tone }));
}

describe('opening', () => {
    it('tells the host it is reading the fields it opens on, before it asks, and their answer once it comes', async () => {
        const h = setUp({ note: { text: 'Plan', picked: 'Plan.md' }, heading: 'Tasks' });

        expect(h.told).toEqual(['reading']);
        expect(h.asks.map(one => one.ask)).toEqual([{ note: { text: 'Plan', picked: 'Plan.md' }, heading: 'Tasks' }]);
        expect(h.fields.state()).toEqual({ headings: [], issues: [] });

        await h.answer(place());
        expect(h.told).toEqual(['reading', { kind: 'to', to: { note: { kind: 'existing', path: 'Plan.md' }, spot: SECTION } }]);
        expect(h.state().headings).toEqual(['Tasks', 'Done']);
    });

    it('opens on an empty note field saying nothing under it, and answers that it names no note', async () => {
        const h = await answered(EMPTY);

        expect(h.state()).toEqual({ headings: [], issues: [] });
        expect(h.told).toEqual(['reading', EMPTY]);
    });
});

describe('answering', () => {
    it('tells the host it is reading as a field changes, before the answer, then the answer', async () => {
        const h = await answered(EMPTY);
        h.fields.fieldsChanged({ note: typed('Plan'), heading: '' });

        expect(h.told).toEqual(['reading', EMPTY, 'reading']);
        await h.answer(at('end', null));
        expect(h.told.at(-1)).toEqual({ kind: 'to', to: { note: { kind: 'existing', path: 'Plan.md' }, spot: 'end' } });
    });

    it('answers a note and where in it, a section or the end, a note not made yet too', async () => {
        const section = await answered(place());
        expect(section.host.answered).toHaveBeenLastCalledWith({ kind: 'to', to: { note: { kind: 'existing', path: 'Plan.md' }, spot: SECTION } });

        const end = await answered(place({ kind: 'new', to: { note: { kind: 'new', path: 'Inbox/A.md' }, spot: 'end' } }));
        expect(end.host.answered).toHaveBeenLastCalledWith({ kind: 'to', to: { note: { kind: 'new', path: 'Inbox/A.md' }, spot: 'end' } });
    });

    it('answers a note with more than one heading by the name as the note and its spot: the host finds no one place there', async () => {
        const h = await answered(at({ ...SECTION, heading: 'Done' }, { kind: 'many', count: 2 }));

        expect(h.host.answered).toHaveBeenLastCalledWith({ kind: 'to', to: { note: { kind: 'existing', path: 'Plan.md' }, spot: { ...SECTION, heading: 'Done' } } });
    });

    it('answers a name no note can have, and more than one note by the name, as they were read', async () => {
        const chars = await answered(CHARS);
        expect(chars.host.answered).toHaveBeenLastCalledWith(CHARS);

        const files = [Object.assign(new TFile(), { path: 'a/本.md' }), Object.assign(new TFile(), { path: 'b/本.md' })];
        const ambiguous: NoteRead = { kind: 'ambiguous', name: '本', files };
        const many = await answered(ambiguous);
        expect(many.host.answered).toHaveBeenLastCalledWith(ambiguous);
    });

    it('answers only to the last asking: an answer to what the fields held before is not handed on', async () => {
        const h = setUp({ note: typed('A'), heading: 'Tasks' });
        h.fields.fieldsChanged({ note: typed('Plan'), heading: '' });
        expect(h.asks.map(one => one.ask)).toEqual([{ note: typed('A'), heading: 'Tasks' }, { note: typed('Plan'), heading: '' }]);

        await h.asks[1].answer(at('end', null));
        await h.asks[0].answer(place({ kind: 'new' }));

        expect(h.told).toEqual(['reading', 'reading', { kind: 'to', to: { note: { kind: 'existing', path: 'Plan.md' }, spot: 'end' } }]);
    });

    it('answers that the fields could not be read when the destination\'s read fails, taking back what was said under them', async () => {
        const h = await answered(CHARS);
        expect(h.state().issues).toHaveLength(1);
        h.fields.fieldsChanged({ note: typed('Plan'), heading: '' });
        await h.asks[1].fail(new Error('read'));

        expect(h.told).toEqual(['reading', CHARS, 'reading', { kind: 'unread' }]);
        expect(h.state()).toEqual({ headings: [], issues: [] });
    });

    it('answers that the fields could not be read when the read throws as it is asked', async () => {
        const told: unknown[] = [];
        const host: PlaceFieldsHost = {
            read: () => { throw new Error('read'); },
            reading: () => { told.push('reading'); },
            answered: (answer) => { told.push(answer); },
        };
        new PlaceFields({ note: typed('Plan'), heading: '' }, host, { render: () => { } });
        await Promise.resolve();
        await Promise.resolve();

        expect(told).toEqual(['reading', { kind: 'unread' }]);
    });

    it('tells nothing of a read that fails once a later asking came: the later one answers', async () => {
        const h = setUp({ note: typed('A'), heading: 'Tasks' });
        h.fields.fieldsChanged({ note: typed('Plan'), heading: '' });
        await h.asks[0].fail(new Error('read'));
        expect(h.told).toEqual(['reading', 'reading']);

        await h.asks[1].answer(at('end', null));
        expect(h.told.at(-1)).toEqual({ kind: 'to', to: { note: { kind: 'existing', path: 'Plan.md' }, spot: 'end' } });
    });

    it('follows each reading it tells with one answer to what the fields hold then, however their reads end', async () => {
        const h = setUp({ note: typed('A'), heading: 'Tasks' });
        h.fields.fieldsChanged({ note: typed('B'), heading: '' });
        h.fields.fieldsChanged({ note: typed('Plan'), heading: '' });
        await h.asks[2].fail(new Error('read'));
        await h.asks[1].answer(place());
        await h.asks[0].fail(new Error('read'));

        // Three readings told, the last answered once; the two overtaken tell nothing.
        expect(h.told).toEqual(['reading', 'reading', 'reading', { kind: 'unread' }]);
    });

    it('tells nothing, nor draws, once disposed', async () => {
        const h = setUp();
        const before = h.state();
        h.fields.dispose();
        await h.answer(place());

        expect(h.state()).toBe(before);
        expect(h.told).toEqual(['reading']);
    });
});

describe('which note, said under the note field: warnings and errors alone', () => {
    it('the note there is: nothing', async () => {
        const h = await answered(place());

        expect(h.state().issues).toEqual([]);
    });

    it('a note not made yet, by a name or by a path: a warning that it is made, with no path', async () => {
        const made = { text: t('modal.newTask.noteNew'), tone: 'warning' };
        expect(says((await answered(place({ kind: 'new' }))).state(), 'note')).toEqual([made]);
        expect(says((await answered(place({ kind: 'new', by: 'path', path: 'Q/A.md' }))).state(), 'note')).toEqual([made]);
    });

    it('a note made with its folder, and notes by its name in other folders: warnings after the note made', async () => {
        const byPath = place({ kind: 'new', by: 'path', path: 'P/Q/A.md', folderMade: 'P', namesakes: [Object.assign(new TFile(), { path: 'Old/A.md' })] });

        expect(says((await answered(byPath)).state(), 'note')).toEqual([
            { text: t('modal.newTask.noteNew'), tone: 'warning' },
            { text: t('modal.destination.noteFolderMade', { folder: 'P' }), tone: 'warning' },
            { text: t('modal.destination.namesakes', { notes: 'Old/A.md' }), tone: 'warning' },
        ]);
    });

    it('a note the views do not show: a warning, as the line above the create says it', async () => {
        const h = await answered(place({ ignored: true }));

        expect(says(h.state(), 'note')).toEqual([{ text: t('modal.newTask.ignored', { note: 'Plan.md' }), tone: 'warning' }]);
    });

    it('a name no note can have, or more than one note: why, as an error', async () => {
        const chars = await answered(CHARS);
        expect(chars.state().issues).toEqual([{ at: 'note', tone: 'error', text: t('modal.destination.nameChars', { chars: '|' }) }]);

        const files = [Object.assign(new TFile(), { path: 'a/本.md' }), Object.assign(new TFile(), { path: 'b/本.md' })];
        const many = await answered({ kind: 'ambiguous', name: '本', files });
        expect(many.state().issues).toEqual([{ at: 'note', tone: 'error', text: t('modal.noteAmbiguous', { name: '本', count: '2', notes: 'a/本.md, b/本.md' }) }]);
    });

    it('the empty note field: nothing, typed empty again too', async () => {
        const h = await answered(place());
        h.fields.fieldsChanged({ note: typed(''), heading: 'Tasks' });
        await h.answer(EMPTY);

        expect(h.state().issues).toEqual([]);
    });

    it('what was said stays while the fields are read again', async () => {
        const h = await answered(CHARS);
        h.fields.fieldsChanged({ note: typed('Plan'), heading: 'Tasks' });

        expect(h.state().issues).toEqual([{ at: 'note', tone: 'error', text: t('modal.destination.nameChars', { chars: '|' }) }]);
    });
});

describe('where in the note, said under the heading field: errors alone', () => {
    const heading = async (read: NoteRead) => says((await answered(read)).state(), 'heading');

    it('a section there is, a heading made, the note\'s end, a new note: nothing', async () => {
        expect(await heading(place())).toEqual([]);
        expect(await heading(at({ ...SECTION, heading: 'Later' }, { kind: 'none' }))).toEqual([]);
        expect(await heading(at('end', null))).toEqual([]);
        expect(await heading(place({ kind: 'new' }))).toEqual([]);
    });

    it('more than one heading by the name: why there is no one place, as the line above the create says it', async () => {
        expect(await heading(at({ ...SECTION, heading: 'Done' }, { kind: 'many', count: 2 })))
            .toEqual([{ text: t('modal.newTask.headings', { note: 'Plan.md', heading: 'Done', count: '2' }), tone: 'error' }]);
    });
});
