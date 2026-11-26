import { describe, it, expect, vi, beforeEach } from 'vitest';
import realMoment from 'moment';
import { Notice } from '../mocks/obsidian';
import { DraftHost, noPlaceIssues, placeIssues, placeText } from '../../../src/modals/hub/DraftHost';
import type { HubForm } from '../../../src/modals/hub/HubHost';
import { CreatePlaces, type CreatePlace, type PlaceFacts } from '../../../src/services/data/CreatePlaces';
import type { NoteDestination, NoteRead, PlaceAnswer } from '../../../src/services/data/NotePlaces';
import { DestinationText } from '../../../src/modals/noteops/DestinationText';
import type { IndexRefusal } from '../../../src/services/core/RefusalClause';
import { refusalNotice } from '../../../src/services/core/RefusalClause';
import type { NewRow } from '../../../src/services/persistence/NewRow';
import { refusalText, type WriteAnswer } from '../../../src/services/operations/WriteAnswer';
import type { FormIssue } from '../../../src/modals/form/FormIssue';
import { DEFAULT_SETTINGS } from '../../../src/types/Settings';
import { t } from '../../../src/i18n';

// A daily note's path is its day as the daily notes' format names it.
vi.mock('obsidian', async () => {
    const actual = await vi.importActual<typeof import('../mocks/obsidian')>('../mocks/obsidian');
    return { ...actual, moment: realMoment };
});

/**
 * The host of a hub on a task not written yet. It opens on a place, or on
 * none for the user to choose, and the place fields move it: each answer
 * naming a note is a place by the place it opened on (`fromDestination`),
 * read anew unless it is the place already; an answer naming none leaves it
 * on no place, saying why, with no create, as an answer that they could not
 * be read does. A create is under way from the press until it is written
 * or not: asked while the fields or the place are being read, the fields
 * are shut, it reads as creating, and it is asked of the form again once
 * they answer where it can go, or ends unwritten, why said, where it
 * cannot. What the fields hand on is
 * put over the draft at once and written nowhere; the card and the fields
 * are drawn again once the field handing it on is done. What the place is
 * is asked once the hub has opened, again after a write refused, and only
 * the last answer is taken. A create is offered once the place has answered
 * and the task can go there; it writes the draft's row once, with no notice,
 * shuts the fields while it is under way, closes the hub once written, and
 * says why above the create and asks the place again once refused. A close
 * asked for meanwhile waits for it; a refusal after the hub closed otherwise
 * is told by a notice.
 */

const PLACE: CreatePlace = { kind: 'note', note: { kind: 'daily', date: '2031-01-15' }, spot: { heading: 'Tasks', level: 2, side: 'head' } };
const SECTION = { heading: 'Tasks', level: 2, side: 'head' as const };

function daily(over: Partial<Extract<PlaceFacts, { kind: 'note' }>> = {}): PlaceFacts {
    return { kind: 'note', path: '2031-01-15.md', spot: SECTION, note: 'existing', seed: 'daily', heading: { kind: 'none' }, ignored: false, inherits: {}, ...over };
}

const REFUSED: IndexRefusal = { file: '2031-01-15.md', reason: { kind: 'changed' }, subject: '2031-01-15.md' };

/** A few microtasks: an answer handed in is taken, and what it starts has run. */
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

/** The places' own reckoning of a note's path and of an answer's place: the daily notes as their settings default. */
const REAL = new CreatePlaces({ internalPlugins: { getPluginById: () => null } } as never, {} as never, () => DEFAULT_SETTINGS, () => undefined);

/** A host on a place (none: the user chooses) whose answers the test gives, a form and a panel that record what they are told. */
function rig(seed: Parameters<typeof makeHost>[0] = {}, place: CreatePlace | null = PLACE) {
    const answers: ((facts: PlaceFacts) => void)[] = [];
    const writes: ((answer: WriteAnswer) => void)[] = [];
    const rows: NewRow[] = [];
    const told: string[] = [];
    const places = {
        noteOf: vi.fn((at: CreatePlace) => REAL.noteOf(at)),
        fromDestination: vi.fn((to: NoteDestination, openedOn?: CreatePlace) => REAL.fromDestination(to, openedOn)),
        facts: vi.fn((_at: CreatePlace) => new Promise<PlaceFacts>(resolve => { answers.push(resolve); })),
        create: vi.fn((_place: CreatePlace, row: NewRow, _opts: unknown) => {
            rows.push(row);
            return new Promise<WriteAnswer>(resolve => { writes.push(resolve); });
        }),
    };
    const host = makeHost(seed, places, place);
    const form: HubForm & { said: (string | null)[]; place: (readonly FormIssue<never>[])[] } = {
        said: [],
        place: [],
        refresh: vi.fn(() => { told.push('form'); }),
        showShut: vi.fn(() => { told.push(`shut:${host.shut() !== null}`); }),
        sayPut: vi.fn(),
        sayWrite(refusal) { this.said.push(refusal); },
        sayPlace(issues) { this.place.push(issues); },
        showDraft: vi.fn(() => { told.push(`draft:${host.canCreate()}:${host.creating()}`); }),
        // The form's create, its fields all saved: it asks the host's.
        write: vi.fn(() => { host.create(); }),
        putTyped: vi.fn(() => true),
        // Told with whether the fields are open and whether a create may be asked then.
        notWritten: vi.fn(() => { told.push(`unwritten:${host.shut() === null}:${host.canCreate()}`); }),
    };
    const panel = { redrawPreview: vi.fn(() => { told.push('card'); }), close: vi.fn() };
    host.bind(form);
    return {
        host, form, panel, places, rows, told,
        open: () => host.attach(panel),
        answer: async (facts: PlaceFacts = daily()) => { answers.at(-1)!(facts); await settle(); },
        answerAt: async (at: number, facts: PlaceFacts) => { answers[at](facts); await settle(); },
        write: async (answer: WriteAnswer) => { writes.at(-1)!(answer); await settle(); },
    };
}

function makeHost(seed: ConstructorParameters<typeof DraftHost>[1], places: ConstructorParameters<typeof DraftHost>[2]['places'], place: CreatePlace | null) {
    return new DraftHost(place, seed, { places, scopeKeys: () => DEFAULT_SETTINGS.scopeKeys });
}

/** The place fields' answers: a note by its path and the spot, or why they name none. */
const to = (path: string, spot: NoteDestination['spot'] = SECTION): PlaceAnswer => ({ kind: 'to', to: { note: { kind: 'existing', path }, spot } });
const EMPTY: PlaceAnswer = { kind: 'unnamed', why: { ok: false, why: 'empty', at: 'name' } };
const CHARS: Extract<NoteRead, { kind: 'unnamed' }> = { kind: 'unnamed', why: { ok: false, why: 'chars', chars: '?', at: 'name' } };
const AMBIGUOUS: Extract<NoteRead, { kind: 'ambiguous' }> = { kind: 'ambiguous', name: 'n', files: [{ path: 'a/n.md' }, { path: 'b/n.md' }] as never };
const OTHER: CreatePlace = { kind: 'note', note: { kind: 'path', path: 'other.md' }, spot: SECTION };
const UNREAD: PlaceAnswer = { kind: 'unread' };
/** What is said above the create while the place could not be read. */
const UNREAD_SAID = [{ at: 'form', tone: 'error', text: t('modal.newTask.unread') }];

beforeEach(() => { Notice.messages.length = 0; });

describe('DraftHost', () => {
    it('asks the place once the hub has opened, and once only', async () => {
        const r = rig();
        expect(r.places.facts).not.toHaveBeenCalled();
        r.open();
        expect(r.places.facts).toHaveBeenCalledTimes(1);
        await r.answer();
        expect(r.places.facts).toHaveBeenCalledTimes(1);
    });

    it('offers no create until the place has answered, and then says where the task goes', async () => {
        const r = rig();
        r.open();
        expect(r.host.canCreate()).toBe(false);
        r.host.create();
        expect(r.places.create).not.toHaveBeenCalled();

        await r.answer();
        expect(r.host.canCreate()).toBe(true);
        expect(r.form.place.at(-1)).toEqual([{ at: 'form', tone: 'info', text: t('modal.newTask.toMade', { note: '2031-01-15.md', heading: 'Tasks' }) }]);
        expect(r.told).toContain('draft:true:false');
    });

    it('offers no create where the task has no one place: the heading twice, the row gone', async () => {
        for (const facts of [daily({ heading: { kind: 'many', count: 2 } }), { kind: 'gone', inherits: {} } as PlaceFacts]) {
            const r = rig();
            r.open();
            await r.answer(facts);
            expect(r.host.canCreate()).toBe(false);
            expect(r.form.place.at(-1)?.[0].tone).toBe('error');
            r.host.create();
            expect(r.places.create).not.toHaveBeenCalled();
        }
    });

    it('warns of a note the views do not read, and creates there all the same', async () => {
        const r = rig();
        r.open();
        await r.answer(daily({ ignored: true }));
        expect(r.form.place.at(-1)).toContainEqual({ at: 'form', tone: 'warning', text: t('modal.newTask.ignored', { note: '2031-01-15.md' }) });
        expect(r.host.canCreate()).toBe(true);
    });

    it('puts the draft in the place as it answers: what it inherits, and from where, its own values kept', async () => {
        const r = rig({ startTime: '10:00' });
        r.open();
        void r.host.put({ content: '打った名前' });
        await r.answer(daily({ inherits: { startDate: '2031-01-10', color: 'red' }, inheritedFrom: { color: 'file' } as never }));

        expect(r.host.task()).toMatchObject({ content: '打った名前', startTime: '10:00', file: '2031-01-15.md' });
        expect(r.host.task().cascadeContext).toEqual({ startDate: '2031-01-10', color: 'red' });
        expect(r.host.task().inheritedFrom).toEqual({ color: 'file' });
        expect(r.told.slice(-3)).toEqual(['form', 'draft:true:false', 'card']);
    });

    it('takes only the answer to the last asking', async () => {
        const r = rig();
        r.open();
        await r.answer();
        // Refused, and moved before the place answers again: asked twice more.
        r.host.create();
        await r.write({ written: false, refused: REFUSED });
        r.host.answered(to('other.md'));
        expect(r.places.facts).toHaveBeenCalledTimes(3);

        await r.answerAt(2, daily({ path: 'other.md', inherits: { color: 'blue' } }));
        // The second asking's answer comes late: not taken over the third's.
        await r.answerAt(1, daily({ inherits: { color: 'red' } }));
        expect(r.host.task().cascadeContext).toEqual({ color: 'blue' });
    });

    it('puts what is handed on over the draft at once, writes nothing, and draws it once the field is done', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.told.length = 0;

        const taken = r.host.put({ content: '電話 #仕事' });
        expect(r.host.task().content).toBe('電話 #仕事');
        expect(r.host.task().tags).toEqual(['仕事']);
        expect(r.told).toEqual([]);
        expect(await taken).toBe(true);
        await settle();
        expect(r.told).toEqual(['card', 'form']);
        expect(r.places.create).not.toHaveBeenCalled();
    });

    it('writes the draft\'s line and property lines once, with no notice, and closes once it is written', async () => {
        const r = rig({ startDate: '2031-01-15', startTime: '10:00' });
        r.open();
        await r.answer();
        void r.host.put({ content: '電話', color: 'red' });
        r.host.create();
        r.host.create();

        expect(r.places.create).toHaveBeenCalledTimes(1);
        expect(r.places.create.mock.calls[0][0]).toEqual(PLACE);
        expect(r.places.create.mock.calls[0][2]).toEqual({ tellRefusal: false });
        expect(r.rows[0].line).toBe('- [ ] 電話 @2031-01-15T10:00');
        expect(r.rows[0].properties?.ops).toEqual([expect.objectContaining({ op: 'set', key: 'tv-color' })]);

        await r.write({ written: true });
        expect(r.panel.close).toHaveBeenCalledTimes(1);
        expect(Notice.messages).toEqual([]);
    });

    it('shuts the fields while a create is under way, takes nothing handed on then, and waits a close for it', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.told.length = 0;
        r.host.create();

        expect(r.host.shut()).toEqual({ reach: 'form', why: t('modal.newTask.formShut') });
        expect(r.host.creating()).toBe(true);
        expect(r.host.canCreate()).toBe(false);
        expect(r.told).toEqual(['shut:true', 'draft:false:true']);
        expect(await r.host.put({ content: '後から' })).toBe(false);
        expect(r.host.task().content).toBe('');

        const closing = r.host.closing();
        expect(closing).toBeInstanceOf(Promise);
        await r.write({ written: true });
        expect(await closing).toBe('close');
    });

    it('stays open over a write refused, says why at the form\'s end once, opens the fields, and asks the place again', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.create();
        const closing = r.host.closing();
        await r.write({ written: false, refused: REFUSED });

        expect(await closing).toBe('stay');
        expect(r.panel.close).not.toHaveBeenCalled();
        expect(r.form.said).toEqual([null, refusalText(REFUSED)]);
        expect(Notice.messages).toEqual([]);
        expect(r.host.shut()).toBeNull();
        expect(r.places.facts).toHaveBeenCalledTimes(2);
        await r.answer();
        expect(r.host.canCreate()).toBe(true);

        // Asked again, the last refusal is taken back.
        r.host.create();
        expect(r.form.said.at(-1)).toBeNull();
    });

    it('waits a create asked while the place is asked again after a refusal for its answer', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.create();
        await r.write({ written: false, refused: REFUSED });
        r.host.create();
        expect(r.places.create).toHaveBeenCalledTimes(1);
        await r.answer();
        expect(r.places.create).toHaveBeenCalledTimes(2);
    });

    it('tells a refusal that comes after the hub closed by a notice', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.create();
        r.host.dispose();
        await r.write({ written: false, refused: REFUSED });

        expect(Notice.messages).toEqual([refusalNotice(REFUSED)]);
        expect(r.form.said).toEqual([null]);
        expect(r.panel.close).not.toHaveBeenCalled();
    });

    it('says it was given something only while a write would write other than the task as it opened', async () => {
        const r = rig({ startDate: '2031-01-15' });
        r.open();
        await r.answer();
        expect(r.host.changed()).toBe(false);

        void r.host.put({ content: '打った' });
        expect(r.host.changed()).toBe(true);
        void r.host.put({ content: '' });
        expect(r.host.changed()).toBe(false);

        void r.host.put({ color: 'red' });
        expect(r.host.changed()).toBe(true);
        void r.host.put({ color: undefined });
        expect(r.host.changed()).toBe(false);

        // What the place answers it inherits is not anything given.
        r.host.create();
        await r.write({ written: false, refused: REFUSED });
        await r.answer(daily({ inherits: { color: 'blue' } }));
        expect(r.host.changed()).toBe(false);
    });

    it('has no row to open', () => {
        expect(rig().host.openSource).toBeNull();
    });
});

describe('DraftHost moved by the place fields', () => {
    it('opened on no place asks nothing, says to choose a note, and offers no create', async () => {
        const r = rig({}, null);
        r.open();
        await settle();

        expect(r.places.facts).not.toHaveBeenCalled();
        expect(r.form.place.at(-1)).toEqual([{ at: 'form', tone: 'info', text: t('modal.newTask.noNote') }]);
        expect(r.host.canCreate()).toBe(false);
        expect(r.host.task().file).toBe('');
        r.host.create();
        expect(r.places.create).not.toHaveBeenCalled();
    });

    it('moves the draft to the note an answer names, reads it anew, and creates there', async () => {
        const r = rig({ startTime: '10:00' });
        r.open();
        await r.answer();

        r.host.answered(to('other.md'));
        expect(r.places.fromDestination).toHaveBeenLastCalledWith({ note: { kind: 'existing', path: 'other.md' }, spot: SECTION }, PLACE);
        expect(r.places.facts).toHaveBeenCalledTimes(2);
        expect(r.places.facts).toHaveBeenLastCalledWith(OTHER);
        await r.answer(daily({ path: 'other.md', inherits: { color: 'red' } }));

        expect(r.host.task()).toMatchObject({ file: 'other.md', startTime: '10:00', cascadeContext: { color: 'red' } });
        expect(r.form.place.at(-1)).toEqual(placeIssues(daily({ path: 'other.md' })));
        r.host.create();
        expect(r.places.create.mock.calls[0][0]).toEqual(OTHER);
    });

    it('takes each answer by the place it opened on: the daily note\'s path, after another note, is the daily note again', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.answered(to('other.md'));
        await r.answer(daily({ path: 'other.md' }));
        r.host.answered(to('2031-01-15.md', 'end'));

        expect(r.places.fromDestination.mock.calls.map(([, openedOn]) => openedOn)).toEqual([PLACE, PLACE]);
        expect(r.places.facts).toHaveBeenLastCalledWith({ ...PLACE, spot: 'end' });
        await r.answer(daily({ spot: 'end', heading: null }));
        r.host.create();
        expect(r.places.create.mock.calls[0][0]).toEqual({ ...PLACE, spot: 'end' });
    });

    it('reads nothing anew for an answer naming the place it is in', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.answered(to('2031-01-15.md'));
        expect(r.places.facts).toHaveBeenCalledTimes(1);

        r.host.answered(to('other.md'));
        r.host.answered(to('other.md'));
        expect(r.places.facts).toHaveBeenCalledTimes(2);
        await r.answer(daily({ path: 'other.md' }));
        r.host.answered(to('other.md'));
        expect(r.places.facts).toHaveBeenCalledTimes(2);
    });

    it('takes back why a create was refused once it moves', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.create();
        await r.write({ written: false, refused: REFUSED });
        expect(r.form.said.at(-1)).toBe(refusalText(REFUSED));

        r.host.answered(to('other.md'));
        expect(r.form.said.at(-1)).toBeNull();
    });

    it('is on no place once an answer names no note, saying why, with no create', async () => {
        for (const [answer, issues] of [
            [EMPTY, [{ at: 'form', tone: 'info', text: t('modal.newTask.noNote') }]],
            [CHARS, [{ at: 'form', tone: 'error', text: DestinationText.unnamed(CHARS) }]],
            [AMBIGUOUS, [{ at: 'form', tone: 'error', text: DestinationText.ambiguous(AMBIGUOUS) }]],
        ] as const) {
            const r = rig();
            r.open();
            await r.answer();
            r.told.length = 0;
            r.host.answered(answer);

            expect(r.form.place.at(-1)).toEqual(issues);
            expect(r.host.canCreate()).toBe(false);
            expect(r.host.task().file).toBe('');
            expect(r.places.facts).toHaveBeenCalledTimes(1);
            expect(r.told).toEqual(['form', 'draft:false:false', 'card']);
        }
    });

    it('takes no answer to an asking made before it moved to no place', async () => {
        const r = rig();
        r.open();
        r.host.answered(EMPTY);
        await r.answer();
        expect(r.host.canCreate()).toBe(false);
        expect(r.host.task().file).toBe('');
    });

    it('offers no create where the place it moved to could not be read, saying so, and keeps nothing of the place left', async () => {
        const r = rig({}, null);
        r.open();
        r.host.answered(to('2031-01-15.md'));
        await r.answer();
        expect(r.host.task().file).toBe('2031-01-15.md');
        r.places.facts.mockImplementationOnce(() => Promise.reject(new Error('unreadable')));
        r.host.answered(to('other.md'));
        await settle();

        expect(r.host.canCreate()).toBe(false);
        expect(r.form.place.at(-1)).toEqual(UNREAD_SAID);
        expect(r.host.task().file).toBe('');
        expect(r.told.slice(-3)).toEqual(['form', 'draft:false:false', 'card']);
        r.host.create();
        expect(r.places.create).not.toHaveBeenCalled();
        // Answered again, it is read again.
        r.host.answered(to('other.md'));
        expect(r.places.facts).toHaveBeenCalledTimes(3);
    });

    it('keeps the create offered while the fields are read, and a create asked then is under way from the press: the fields shut, read as creating', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.reading();
        expect(r.host.canCreate()).toBe(true);
        r.told.length = 0;
        r.host.create();

        expect(r.places.create).not.toHaveBeenCalled();
        expect(r.host.creating()).toBe(true);
        expect(r.host.canCreate()).toBe(false);
        expect(r.host.shut()).toEqual({ reach: 'form', why: t('modal.newTask.formShut') });
        expect(r.told).toEqual(['shut:true', 'draft:false:true']);
        expect(await r.host.put({ content: '後から' })).toBe(false);
        r.host.create();

        r.host.answered(to('other.md'));
        expect(r.host.creating()).toBe(true);
        expect(r.places.create).not.toHaveBeenCalled();
        await r.answer(daily({ path: 'other.md' }));

        expect(r.form.write).toHaveBeenCalledTimes(1);
        expect(r.places.create).toHaveBeenCalledTimes(1);
        expect(r.places.create.mock.calls[0][0]).toEqual(OTHER);
        expect(r.rows[0].line.trimEnd()).toBe('- [ ]');
        expect(r.host.creating()).toBe(true);
    });

    it('waits a close asked while a create waits for a read for that create: written, it closes', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.reading();
        r.host.create();
        const closing = r.host.closing();
        expect(closing).toBeInstanceOf(Promise);

        r.host.answered(to('2031-01-15.md'));
        await r.write({ written: true });
        expect(await closing).toBe('close');
    });

    it('waits a close asked while a create waits for a read for that create: not written, it stays', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.reading();
        r.host.create();
        const closing = r.host.closing();

        r.host.answered(EMPTY);
        expect(await closing).toBe('stay');
    });

    it('ends a create that waited unwritten, the fields open, where the form finds a field it cannot create with under the place now', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.reading();
        r.host.create();
        // The form's second look finds a date the place's inherits now break: it asks no create.
        vi.mocked(r.form.write).mockImplementationOnce(() => { r.told.push(`form create:${r.host.shut() !== null}`); });
        r.told.length = 0;
        r.host.answered(to('2031-01-15.md'));

        expect(r.form.write).toHaveBeenCalledTimes(1);
        expect(r.places.create).not.toHaveBeenCalled();
        expect(r.host.creating()).toBe(false);
        expect(r.host.shut()).toBeNull();
        // The fields open before the form looks, so its focus can go to the field.
        expect(r.told).toEqual(['draft:false:true', 'shut:false', 'form create:false', 'draft:true:false']);
    });

    it('makes a create that waited once the fields answer the place it is in', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.reading();
        r.host.create();
        r.host.answered(to('2031-01-15.md'));
        expect(r.places.create).toHaveBeenCalledTimes(1);
        expect(r.places.create.mock.calls[0][0]).toEqual(PLACE);
    });

    it('ends a create that waited unwritten, the fields open, where the answer says the task cannot go, why said above it', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.reading();
        r.host.create();
        r.host.answered(to('other.md'));
        await r.answer(daily({ path: 'other.md', heading: { kind: 'many', count: 2 } }));

        expect(r.places.create).not.toHaveBeenCalled();
        expect(r.form.write).not.toHaveBeenCalled();
        expect(r.host.creating()).toBe(false);
        expect(r.host.shut()).toBeNull();
        expect(r.told.slice(-2)).toEqual(['draft:false:false', 'unwritten:true:false']);
        expect(r.form.place.at(-1)?.[0].tone).toBe('error');
    });

    it('ends a create that waited unwritten once an answer names no note, why said above it', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.reading();
        r.host.create();
        r.host.answered(EMPTY);

        expect(r.host.creating()).toBe(false);
        expect(r.host.shut()).toBeNull();
        expect(r.form.place.at(-1)).toEqual(noPlaceIssues(EMPTY as Extract<PlaceAnswer, { kind: 'unnamed' }>));
        r.host.reading();
        r.host.answered(to('other.md'));
        await r.answer(daily({ path: 'other.md' }));
        expect(r.places.create).not.toHaveBeenCalled();
    });

    it('is on no place once the fields could not be read, saying so, and ends a create that waited for them unwritten', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.reading();
        r.host.create();
        r.host.answered(UNREAD);

        expect(r.places.create).not.toHaveBeenCalled();
        expect(r.host.creating()).toBe(false);
        expect(r.host.shut()).toBeNull();
        expect(r.host.canCreate()).toBe(false);
        expect(r.form.place.at(-1)).toEqual(UNREAD_SAID);
        expect(r.host.task().file).toBe('');

        // Typed again, they are read again.
        r.host.reading();
        r.host.answered(to('2031-01-15.md'));
        expect(r.places.facts).toHaveBeenCalledTimes(2);
    });

    it('ends a create that waited for the place it moved to unwritten once that place could not be read', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.reading();
        r.host.create();
        r.places.facts.mockImplementationOnce(() => Promise.reject(new Error('unreadable')));
        r.host.answered(to('other.md'));
        await settle();

        expect(r.places.create).not.toHaveBeenCalled();
        expect(r.host.creating()).toBe(false);
        expect(r.host.shut()).toBeNull();
        expect(r.form.place.at(-1)).toEqual(UNREAD_SAID);
    });

    it('keeps the place as last read, the create offered, where asking it again after a refusal fails', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.create();
        r.places.facts.mockImplementationOnce(() => Promise.reject(new Error('unreadable')));
        const said = r.form.place.length;
        await r.write({ written: false, refused: REFUSED });

        expect(r.host.canCreate()).toBe(true);
        expect(r.form.place).toHaveLength(said);
        expect(r.host.task().file).toBe('2031-01-15.md');
        // The create was drawn offered as the refusal opened the fields, and stays so.
        expect(r.told.slice(-2)).toEqual(['draft:true:false', 'unwritten:true:true']);
    });

    it('ends a create that waited for the place asked again after a refusal unwritten once that asking fails, saying so above it', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.create();
        let fail = (_e: Error) => { };
        r.places.facts.mockImplementationOnce(() => new Promise<PlaceFacts>((_resolve, reject) => { fail = reject; }));
        await r.write({ written: false, refused: REFUSED });
        r.host.create();
        expect(r.host.creating()).toBe(true);
        const said = r.form.place.length;
        r.told.length = 0;
        fail(new Error('unreadable'));
        await settle();

        expect(r.places.create).toHaveBeenCalledTimes(1);
        expect(r.host.creating()).toBe(false);
        expect(r.form.said.at(-1)).toBe(t('modal.newTask.unread'));
        expect(r.host.canCreate()).toBe(true);
        // The fields open, the create is drawn offered, and what is said of the place stays as last read.
        expect(r.told).toEqual(['shut:false', 'draft:true:false', 'unwritten:true:true']);
        expect(r.form.place).toHaveLength(said);
    });

    it('offers no create while the place it comes back to from no place is read', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.answered(EMPTY);
        r.host.answered(to('2031-01-15.md'));

        expect(r.places.facts).toHaveBeenCalledTimes(2);
        expect(r.host.canCreate()).toBe(false);
        await r.answer();
        expect(r.host.canCreate()).toBe(true);
    });

    it('writes nothing for a create that waited once the hub has closed', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.reading();
        r.host.create();
        r.host.dispose();
        r.host.answered(to('2031-01-15.md'));
        expect(r.places.create).not.toHaveBeenCalled();
        expect(r.host.creating()).toBe(false);
    });

    it('takes no reading nor answer while a create is under way, nor once the hub has closed', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.create();
        r.host.reading();
        r.host.answered(to('other.md'));
        expect(r.places.fromDestination).not.toHaveBeenCalled();
        await r.write({ written: false, refused: REFUSED });
        await r.answer();
        r.host.create();
        expect(r.places.create).toHaveBeenCalledTimes(2);
        expect(r.places.create.mock.calls[1][0]).toEqual(PLACE);

        const closed = rig();
        closed.open();
        await closed.answer();
        closed.host.dispose();
        closed.host.answered(to('other.md'));
        expect(closed.places.fromDestination).not.toHaveBeenCalled();
        expect(closed.places.facts).toHaveBeenCalledTimes(1);
    });

    it('says it was given something while it is moved from the place it opened on, and not once moved back', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.answered(to('other.md'));
        expect(r.host.changed()).toBe(true);
        r.host.answered(EMPTY);
        expect(r.host.changed()).toBe(true);
        r.host.answered(to('2031-01-15.md'));
        expect(r.host.changed()).toBe(false);

        const none = rig({}, null);
        none.open();
        none.host.answered(EMPTY);
        expect(none.host.changed()).toBe(false);
        none.host.answered(to('other.md'));
        expect(none.host.changed()).toBe(true);
        none.host.answered(CHARS);
        expect(none.host.changed()).toBe(false);
    });
});

describe('DraftHost under a row', () => {
    const CHILD: CreatePlace = { kind: 'childOf', taskId: 'parent' };
    const UNDER: PlaceFacts = { kind: 'childOf', parent: '親', path: 'f/n.md', under: 'Work', inherits: {} };

    it('shows nothing of the place until it is read, and then the parent\'s note, the heading it stands under, and the parent', async () => {
        const r = rig({}, CHILD);
        r.open();
        expect(r.host.shown()).toBeNull();
        await r.answer(UNDER);
        expect(r.host.shown()).toEqual({ note: 'f/n.md', heading: 'Work', parent: '親' });
    });

    it('shows a parent above the note\'s first heading as under none', async () => {
        const r = rig({}, CHILD);
        r.open();
        await r.answer({ ...UNDER, under: null });
        expect(r.host.shown()).toEqual({ note: 'f/n.md', heading: null, parent: '親' });
    });

    it('shows nothing once the parent is gone, nor where the place could not be read', async () => {
        const gone = rig({}, CHILD);
        gone.open();
        await gone.answer({ kind: 'gone', inherits: {} });
        expect(gone.host.shown()).toBeNull();

        const unread = rig({}, CHILD);
        unread.places.facts.mockImplementationOnce(() => Promise.reject(new Error('unreadable')));
        unread.open();
        await settle();
        expect(unread.host.shown()).toBeNull();
    });

    it('shows nothing of a place in a note', async () => {
        const r = rig();
        r.open();
        await r.answer();
        expect(r.host.shown()).toBeNull();
    });
});

describe('DraftHost, a create ending unwritten', () => {
    /** What the form was told of a create ended unwritten, as it was told: whether the fields were open, and whether a create could be asked. */
    const ends = (r: ReturnType<typeof rig>) => r.told.filter(one => one.startsWith('unwritten:'));
    const CHILD: CreatePlace = { kind: 'childOf', taskId: 'parent' };
    const UNDER: PlaceFacts = { kind: 'childOf', parent: '親', path: 'f/n.md', under: 'Work', inherits: {} };

    it('tells the form once, the fields open and the place read, where a create that waited cannot go: the heading twice', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.reading();
        r.host.create();
        r.host.answered(to('other.md'));
        expect(ends(r)).toEqual([]);
        await r.answer(daily({ path: 'other.md', heading: { kind: 'many', count: 2 } }));

        expect(ends(r)).toEqual(['unwritten:true:false']);
        // Told last: after the fields opened and the create was drawn.
        expect(r.told.slice(-3)).toEqual(['shut:false', 'draft:false:false', 'unwritten:true:false']);
    });

    it('tells the form once where a create that waited ends on an answer naming no note, a name no note can have, more than one note, or fields that could not be read', async () => {
        for (const answer of [EMPTY, CHARS, AMBIGUOUS, UNREAD]) {
            const r = rig();
            r.open();
            await r.answer();
            r.host.reading();
            r.host.create();
            r.host.answered(answer);

            expect(ends(r)).toEqual(['unwritten:true:false']);
        }
    });

    it('tells the form once where a create that waited for the place it moved to ends as that place could not be read', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.reading();
        r.host.create();
        r.places.facts.mockImplementationOnce(() => Promise.reject(new Error('unreadable')));
        r.host.answered(to('other.md'));
        await settle();

        expect(ends(r)).toEqual(['unwritten:true:false']);
    });

    it('tells the form nothing where a create that waited is asked of the form again and the form finds a field to fix', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.reading();
        r.host.create();
        vi.mocked(r.form.write).mockImplementationOnce(() => { });
        r.host.answered(to('2031-01-15.md'));

        expect(r.host.creating()).toBe(false);
        expect(r.form.notWritten).not.toHaveBeenCalled();
    });

    it('tells the form once a refused create\'s place has been asked again, not before, a create offered still', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.create();
        await r.write({ written: false, refused: REFUSED });
        expect(ends(r)).toEqual([]);

        await r.answer();
        expect(ends(r)).toEqual(['unwritten:true:true']);
        expect(r.told.at(-1)).toBe('unwritten:true:true');
    });

    it('tells the form once a refused create\'s place, asked again, says the task cannot go there now', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.create();
        await r.write({ written: false, refused: REFUSED });
        await r.answer(daily({ heading: { kind: 'many', count: 2 } }));

        expect(ends(r)).toEqual(['unwritten:true:false']);
    });

    it('tells the form once a refused create\'s place could not be asked again, a create offered still', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.create();
        r.places.facts.mockImplementationOnce(() => Promise.reject(new Error('unreadable')));
        await r.write({ written: false, refused: REFUSED });

        expect(ends(r)).toEqual(['unwritten:true:true']);
    });

    it('tells the form once a refused create\'s place has been asked again and the fields typed meanwhile have answered', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.create();
        await r.write({ written: false, refused: REFUSED });
        r.host.reading();
        await r.answer();
        expect(ends(r)).toEqual([]);

        r.host.answered(to('2031-01-15.md'));
        expect(ends(r)).toEqual(['unwritten:true:true']);
    });

    it('under a row, tells the form once the parent is found gone as a refused create\'s place is asked again', async () => {
        const r = rig({}, CHILD);
        r.open();
        await r.answer(UNDER);
        r.host.create();
        await r.write({ written: false, refused: REFUSED });
        expect(ends(r)).toEqual([]);
        await r.answer({ kind: 'gone', inherits: {} });

        expect(ends(r)).toEqual(['unwritten:true:false']);
    });

    it('tells the form only of the create pressed again while a refused create\'s place is asked again', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.create();
        await r.write({ written: false, refused: REFUSED });
        r.host.create();
        await r.answer();
        expect(r.places.create).toHaveBeenCalledTimes(2);
        expect(ends(r)).toEqual([]);

        await r.write({ written: false, refused: REFUSED });
        await r.answer();
        expect(ends(r)).toEqual(['unwritten:true:true']);
    });

    it('tells the form nothing of a create written, nor of one ended once the hub has closed', async () => {
        const written = rig();
        written.open();
        await written.answer();
        written.host.create();
        await written.write({ written: true });
        expect(written.form.notWritten).not.toHaveBeenCalled();

        const closedAsked = rig();
        closedAsked.open();
        await closedAsked.answer();
        closedAsked.host.create();
        await closedAsked.write({ written: false, refused: REFUSED });
        closedAsked.host.dispose();
        await closedAsked.answer();
        expect(closedAsked.form.notWritten).not.toHaveBeenCalled();

        const closedWaiting = rig();
        closedWaiting.open();
        await closedWaiting.answer();
        closedWaiting.host.reading();
        closedWaiting.host.create();
        closedWaiting.host.dispose();
        closedWaiting.host.answered(EMPTY);
        expect(closedWaiting.form.notWritten).not.toHaveBeenCalled();
    });

    it('tells the form nothing of a place read with no create ended', async () => {
        const r = rig();
        r.open();
        await r.answer();
        r.host.answered(to('other.md'));
        await r.answer(daily({ path: 'other.md', heading: { kind: 'many', count: 2 } }));
        r.host.answered(EMPTY);

        expect(r.form.notWritten).not.toHaveBeenCalled();
    });
});

describe('noPlaceIssues', () => {
    it('asks for a note while the field is empty, and says why one cannot be named otherwise', () => {
        expect(noPlaceIssues(EMPTY as Extract<PlaceAnswer, { kind: 'unnamed' }>)).toEqual([{ at: 'form', tone: 'info', text: t('modal.newTask.noNote') }]);
        expect(noPlaceIssues(CHARS)).toEqual([{ at: 'form', tone: 'error', text: DestinationText.unnamed(CHARS) }]);
        expect(noPlaceIssues(AMBIGUOUS)).toEqual([{ at: 'form', tone: 'error', text: DestinationText.ambiguous(AMBIGUOUS) }]);
        expect(noPlaceIssues({ kind: 'unread' })).toEqual(UNREAD_SAID);
    });
});

describe('placeIssues', () => {
    it('says where the line goes, and warns of a note the views do not read', () => {
        expect(placeIssues(daily({ ignored: true }))).toEqual([
            { at: 'form', tone: 'info', text: t('modal.newTask.toMade', { note: '2031-01-15.md', heading: 'Tasks' }) },
            { at: 'form', tone: 'warning', text: t('modal.newTask.ignored', { note: '2031-01-15.md' }) },
        ]);
    });
});

describe('placeText', () => {
    it('says each place by where the line goes', () => {
        const vars = { note: '2031-01-15.md', heading: 'Tasks' };
        expect(placeText(daily({ note: 'new', heading: { kind: 'one', heading: {} as never } }))).toEqual({ text: t('modal.newTask.toNew', vars), tone: 'info' });
        expect(placeText(daily({ heading: { kind: 'one', heading: {} as never } }))).toEqual({ text: t('modal.newTask.toHead', vars), tone: 'info' });
        expect(placeText(daily({ heading: { kind: 'one', heading: {} as never }, spot: { ...SECTION, side: 'end' } }))).toEqual({ text: t('modal.newTask.toEnd', vars), tone: 'info' });
        expect(placeText(daily())).toEqual({ text: t('modal.newTask.toMade', vars), tone: 'info' });
        expect(placeText(daily({ heading: { kind: 'many', count: 2 } }))).toEqual({ text: t('modal.newTask.headings', { ...vars, count: '2' }), tone: 'error' });
        expect(placeText({ kind: 'childOf', parent: '親', path: 'n.md', under: null, inherits: {} })).toEqual({ text: t('modal.newTask.toChild', { parent: '親' }), tone: 'info' });
        expect(placeText({ kind: 'gone', inherits: {} })).toEqual({ text: t('modal.newTask.gone'), tone: 'error' });
    });

    it('says the end of a note, and a note made for the line: empty as a warning, as the day\'s daily note as any place', () => {
        const note = { note: 'n.md' };
        const at = (over: Partial<Extract<PlaceFacts, { kind: 'note' }>>) => placeText(daily({ path: 'n.md', seed: 'empty', ...over }));
        expect(at({ spot: 'end', heading: null })).toEqual({ text: t('modal.newTask.toNoteEnd', note), tone: 'info' });
        expect(at({ spot: 'end', heading: null, note: 'new' })).toEqual({ text: t('modal.newTask.toNewNoteEnd', note), tone: 'warning' });
        expect(at({ spot: 'end', heading: null, note: 'new', seed: 'daily' })).toEqual({ text: t('modal.newTask.toNewEnd', note), tone: 'info' });
        expect(at({ note: 'new' })).toEqual({ text: t('modal.newTask.toNewNote', { ...note, heading: 'Tasks' }), tone: 'warning' });
    });
});
