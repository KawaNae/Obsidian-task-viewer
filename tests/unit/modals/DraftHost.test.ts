import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notice } from '../mocks/obsidian';
import { DraftHost, placeIssues, placeText } from '../../../src/modals/hub/DraftHost';
import type { HubForm } from '../../../src/modals/hub/HubHost';
import type { CreatePlace, PlaceFacts } from '../../../src/services/data/CreatePlaces';
import type { IndexRefusal } from '../../../src/services/core/RefusalClause';
import { refusalNotice } from '../../../src/services/core/RefusalClause';
import type { NewRow } from '../../../src/services/persistence/NewRow';
import { refusalText, type WriteAnswer } from '../../../src/services/operations/WriteAnswer';
import type { FormIssue } from '../../../src/modals/form/FormIssue';
import { DEFAULT_SETTINGS } from '../../../src/types/Settings';
import { t } from '../../../src/i18n';

/**
 * The host of a hub on a task not written yet. What the fields hand on is
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

/** A host on a place whose answers the test gives, a form and a panel that record what they are told. */
function rig(seed: Parameters<typeof makeHost>[0] = {}) {
    const answers: ((facts: PlaceFacts) => void)[] = [];
    const writes: ((answer: WriteAnswer) => void)[] = [];
    const rows: NewRow[] = [];
    const told: string[] = [];
    const places = {
        noteOf: vi.fn(() => '2031-01-15.md'),
        facts: vi.fn(() => new Promise<PlaceFacts>(resolve => { answers.push(resolve); })),
        create: vi.fn((_place: CreatePlace, row: NewRow, _opts: unknown) => {
            rows.push(row);
            return new Promise<WriteAnswer>(resolve => { writes.push(resolve); });
        }),
    };
    const host = makeHost(seed, places);
    const form: HubForm & { said: (string | null)[]; place: (readonly FormIssue<never>[])[] } = {
        said: [],
        place: [],
        refresh: vi.fn(() => { told.push('form'); }),
        showShut: vi.fn(() => { told.push(`shut:${host.shut() !== null}`); }),
        sayWrite(refusal) { this.said.push(refusal); },
        sayPlace(issues) { this.place.push(issues); },
        showDraft: vi.fn(() => { told.push(`draft:${host.canCreate()}:${host.creating()}`); }),
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

function makeHost(seed: ConstructorParameters<typeof DraftHost>[1], places: ConstructorParameters<typeof DraftHost>[2]['places']) {
    return new DraftHost(PLACE, seed, { places, scopeKeys: () => DEFAULT_SETTINGS.scopeKeys });
}

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
        // Created and refused twice before the place answers again: asked twice more.
        r.host.create();
        await r.write({ written: false, refused: REFUSED });
        r.host.create();
        await r.write({ written: false, refused: REFUSED });
        expect(r.places.facts).toHaveBeenCalledTimes(3);

        await r.answerAt(2, daily({ inherits: { color: 'blue' } }));
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

        expect(r.host.shut()).toBe(t('modal.newTask.formShut'));
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
        expect(placeText({ kind: 'childOf', parent: '親', inherits: {} })).toEqual({ text: t('modal.newTask.toChild', { parent: '親' }), tone: 'info' });
    });
});
