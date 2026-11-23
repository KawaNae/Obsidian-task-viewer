import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { t } from '../../../src/i18n';
import { PlaceDialog, type PlaceHost, type PlaceViewState } from '../../../src/modals/place/PlaceDialog';
import type { DestinationAsk, NoteDestination, NotePlace, NoteRead } from '../../../src/services/data/NotePlaces';

/**
 * The place dialog as logic (`PlaceDialog`), apart from the DOM: the host
 * answers the destination as told, and the surface records what it was
 * told to show.
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

function setUp(initial: DestinationAsk = { note: typed(''), heading: 'Tasks' }) {
    const states: PlaceViewState[] = [];
    const asks: { ask: DestinationAsk; answer(read: NoteRead): Promise<void> }[] = [];
    const placed = vi.fn();
    const host: PlaceHost = {
        read: (ask) => new Promise<NoteRead>((resolve) => {
            asks.push({
                ask,
                answer: async (read) => { resolve(read); await Promise.resolve(); await Promise.resolve(); },
            });
        }),
        placed,
    };
    const dialog = new PlaceDialog(initial, host, { render: (state) => { states.push(state); } });
    return {
        dialog, asks, placed,
        state: () => states[states.length - 1],
        /** Answer the last asking of the destination. */
        answer: (read: NoteRead) => asks[asks.length - 1].answer(read),
    };
}

/** A dialog whose destination is answered `read`. */
async function answered(read: NoteRead, initial?: DestinationAsk) {
    const h = setUp(initial);
    await h.answer(read);
    return h;
}

/** What the dialog says of `at`, each text with its tone. */
function says(state: PlaceViewState, at: 'note' | 'heading'): { text: string; tone: string }[] {
    return state.issues.filter(issue => issue.at === at).map(issue => ({ text: issue.text, tone: issue.tone }));
}

describe('opening', () => {
    it('asks the destination the fields open on, and places nothing until answered', async () => {
        const h = setUp({ note: { text: 'Plan', picked: 'Plan.md' }, heading: 'Tasks' });

        expect(h.asks.map(one => one.ask)).toEqual([{ note: { text: 'Plan', picked: 'Plan.md' }, heading: 'Tasks' }]);
        expect(h.state()).toEqual({ headings: [], issues: [], canPlace: false });

        await h.answer(place());
        expect(h.state().canPlace).toBe(true);
        expect(h.state().headings).toEqual(['Tasks', 'Done']);
    });

    it('opens on an empty note field without saying it wrong, and places nothing', async () => {
        const h = await answered(EMPTY);

        expect(h.state()).toEqual({ headings: [], issues: [], canPlace: false });
    });
});

describe('which note, said under the note field', () => {
    it('the note there is, as any text is', async () => {
        const h = await answered(place());

        expect(says(h.state(), 'note')).toEqual([{ text: t('modal.destination.noteExisting', { note: 'Plan.md' }), tone: 'info' }]);
    });

    it('a new note by a name, or by a path and the folder it makes, and the notes by its name: warnings', async () => {
        expect(says((await answered(place({ kind: 'new' }))).state(), 'note'))
            .toEqual([{ text: t('modal.destination.noteNewByName', { note: 'Inbox/A.md' }), tone: 'warning' }]);

        const byPath = place({ kind: 'new', by: 'path', path: 'P/Q/A.md', folderMade: 'P', namesakes: [Object.assign(new TFile(), { path: 'Old/A.md' })] });
        expect(says((await answered(byPath)).state(), 'note')).toEqual([
            { text: t('modal.destination.noteNew', { note: 'P/Q/A.md' }), tone: 'warning' },
            { text: t('modal.destination.noteFolderMade', { folder: 'P' }), tone: 'warning' },
            { text: t('modal.destination.namesakes', { notes: 'Old/A.md' }), tone: 'warning' },
        ]);
    });

    it('a note the views do not show: a warning, and it can be placed in', async () => {
        const h = await answered(place({ ignored: true }));

        expect(says(h.state(), 'note')).toContainEqual({ text: t('modal.place.ignored', { note: 'Plan.md' }), tone: 'warning' });
        expect(h.state().canPlace).toBe(true);
    });

    it('a name no note can have, or more than one note: why, and nothing placed', async () => {
        const chars = await answered({ kind: 'unnamed', why: { ok: false, why: 'chars', chars: '|', at: 'name' } });
        expect(chars.state().issues).toEqual([{ at: 'note', tone: 'error', text: t('modal.destination.nameChars', { chars: '|' }) }]);
        expect(chars.state().canPlace).toBe(false);

        const files = [Object.assign(new TFile(), { path: 'a/本.md' }), Object.assign(new TFile(), { path: 'b/本.md' })];
        const many = await answered({ kind: 'ambiguous', name: '本', files });
        expect(many.state().issues).toEqual([{ at: 'note', tone: 'error', text: t('modal.noteAmbiguous', { name: '本', count: '2', notes: 'a/本.md, b/本.md' }) }]);
        expect(many.state().canPlace).toBe(false);
    });
});

describe('where in the note, said under the heading field', () => {
    const heading = async (read: NoteRead) => says((await answered(read)).state(), 'heading');

    it('the top or the end of the heading\'s section, by the settings\' side', async () => {
        expect(await heading(place())).toEqual([{ text: t('modal.place.toHead', { heading: 'Tasks' }), tone: 'info' }]);
        expect(await heading(at({ ...SECTION, side: 'end' }, { kind: 'one', heading: {} as never })))
            .toEqual([{ text: t('modal.place.toEnd', { heading: 'Tasks' }), tone: 'info' }]);
    });

    it('a heading the note has not: made at its end, and placed under it', async () => {
        const h = await answered(at({ ...SECTION, heading: 'Later' }, { kind: 'none' }));

        expect(says(h.state(), 'heading')).toEqual([{ text: t('modal.place.toMade', { heading: 'Later' }), tone: 'info' }]);
        expect(h.state().canPlace).toBe(true);
    });

    it('the note\'s end, under no heading; in a new note, no heading made', async () => {
        expect(await heading(at('end', null))).toEqual([{ text: t('modal.place.toNoteEnd'), tone: 'info' }]);
        expect(await heading(place({ kind: 'new', to: { note: { kind: 'new', path: 'Inbox/A.md' }, spot: 'end' } })))
            .toEqual([{ text: t('modal.place.toNewEnd'), tone: 'info' }]);
    });

    it('a new note: its heading made, and the task under it', async () => {
        expect(await heading(place({ kind: 'new' }))).toEqual([{ text: t('modal.place.toNew', { heading: 'Tasks' }), tone: 'info' }]);
    });

    it('more than one heading by the name: why there is no one place, and nothing placed', async () => {
        const h = await answered(at({ ...SECTION, heading: 'Done' }, { kind: 'many', count: 2 }));

        expect(says(h.state(), 'heading')).toEqual([{ text: t('modal.place.headings', { note: 'Plan.md', heading: 'Done', count: '2' }), tone: 'error' }]);
        expect(h.state().canPlace).toBe(false);
        h.dialog.choose();
        h.dialog.enter();
        expect(h.placed).not.toHaveBeenCalled();
    });
});

describe('placing', () => {
    it('answers the note and where in it: a section, or the end', async () => {
        const section = await answered(place());
        section.dialog.choose();
        expect(section.placed).toHaveBeenCalledWith({ note: { kind: 'existing', path: 'Plan.md' }, spot: SECTION });

        const end = await answered(place({ kind: 'new', to: { note: { kind: 'new', path: 'Inbox/A.md' }, spot: 'end' } }));
        end.dialog.choose();
        expect(end.placed).toHaveBeenCalledWith({ note: { kind: 'new', path: 'Inbox/A.md' }, spot: 'end' });
    });

    it('places on Enter where it can', async () => {
        const h = await answered(place());
        h.dialog.enter();

        expect(h.placed).toHaveBeenCalledTimes(1);
    });

    it('on Enter in an empty note field, says a note is wanted until a field changes, and places nothing', async () => {
        const h = await answered(EMPTY);
        h.dialog.enter();

        expect(h.placed).not.toHaveBeenCalled();
        expect(h.state().issues).toEqual([{ at: 'note', tone: 'error', text: t('modal.destination.nameEmpty') }]);

        h.dialog.fieldsChanged({ note: typed(''), heading: 'Tasks' });
        await h.answer(EMPTY);
        expect(h.state().issues).toEqual([]);
    });

    it('places nothing while the answer is not for what the fields hold now', async () => {
        const h = await answered(place());
        h.dialog.fieldsChanged({ note: typed('Other'), heading: 'Tasks' });

        expect(h.state().canPlace).toBe(false);
        h.dialog.choose();
        h.dialog.enter();
        expect(h.placed).not.toHaveBeenCalled();
    });

    it('takes only the answer to the last asking', async () => {
        const h = setUp({ note: typed('A'), heading: 'Tasks' });
        h.dialog.fieldsChanged({ note: typed('Plan'), heading: '' });
        expect(h.asks.map(one => one.ask)).toEqual([{ note: typed('A'), heading: 'Tasks' }, { note: typed('Plan'), heading: '' }]);

        await h.asks[1].answer(at('end', null));
        await h.asks[0].answer(place({ kind: 'new' }));

        expect(says(h.state(), 'heading')).toEqual([{ text: t('modal.place.toNoteEnd'), tone: 'info' }]);
        h.dialog.choose();
        expect(h.placed).toHaveBeenCalledWith({ note: { kind: 'existing', path: 'Plan.md' }, spot: 'end' });
    });

    it('draws nothing once disposed', async () => {
        const h = setUp();
        const before = h.state();
        h.dialog.dispose();
        await h.answer(place());

        expect(h.state()).toBe(before);
    });
});
