import { describe, it, expect, vi, afterEach } from 'vitest';
import { t } from '../../../src/i18n';
import { PlacePane } from '../../../src/modals/place/PlacePane';
import type { PlaceFieldsHost } from '../../../src/modals/place/PlaceFields';
import { DestinationField } from '../../../src/modals/noteops/DestinationField';
import type { DestinationAsk, NoteRead } from '../../../src/services/data/NotePlaces';
import { FakeEl, asEl } from '../helpers/fakeDom';

const { noteSuggests } = vi.hoisted(() => ({ noteSuggests: [] as { selectSuggestion(value: unknown, evt: Event): void }[] }));
// The note field's list of candidates, each kept to pick from as Obsidian's list does.
vi.mock('../../../src/suggest/NoteSuggest', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../../../src/suggest/NoteSuggest')>();
    return {
        ...mod,
        NoteSuggest: class extends mod.NoteSuggest {
            constructor(...args: ConstructorParameters<typeof mod.NoteSuggest>) {
                super(...args);
                noteSuggests.push(this);
            }
        },
    };
});

/**
 * The place tab's pane of a hub on a task not written yet (`PlacePane`):
 * its fields as they open, what is typed in them and an Enter reaching its
 * logic (`PlaceFields`), what the logic says drawn under them, the focus it
 * answers for its first field, and its fields shut and opened with the
 * form's. The host answers at once, as the vault does in `vault`.
 */

const app = { fileManager: { getNewFileParent: () => ({ path: '/' }) }, keymap: { pushScope: () => { }, popScope: () => { } }, scope: {} } as never;

const PLAN: Extract<NoteRead, { kind: 'existing' }> = {
    kind: 'existing',
    lines: [],
    path: 'Plan.md',
    to: { note: { kind: 'existing', path: 'Plan.md' }, spot: 'end' },
    heading: null,
    headings: [],
    ignored: false,
};

const EMPTY: NoteRead = { kind: 'unnamed', why: { ok: false, why: 'empty', at: 'name' } };

/**
 * The vault as the fields name it: nothing in an empty note field, `Plan.md`
 * for `Plan`, at the end of it or under the heading named, its headings
 * `Tasks` and `Done`, and a note not made yet for any other name.
 */
function vault(ask: DestinationAsk): NoteRead {
    if (ask.note.text === '') return EMPTY;
    const spot = ask.heading === '' ? 'end' as const : { heading: ask.heading, level: 2, side: 'head' as const };
    if (ask.note.text !== 'Plan') {
        const path = `${ask.note.text}.md`;
        return { kind: 'new', by: 'name', folderMade: null, namesakes: [], path, to: { note: { kind: 'new', path }, spot }, heading: spot === 'end' ? null : { kind: 'none' }, headings: [], ignored: false };
    }
    const heading = spot === 'end' ? null : { kind: 'one' as const, heading: { level: 2, text: spot.heading, line: 0 } as never };
    return { ...PLAN, to: { note: { kind: 'existing', path: 'Plan.md' }, spot }, heading, headings: ['Tasks', 'Done'] };
}

function setUp(initial: DestinationAsk = { note: { text: '', picked: null }, heading: 'Tasks' }) {
    const el = new FakeEl('tv-tabs__pane');
    const told: unknown[] = [];
    const asked: DestinationAsk[] = [];
    const host: PlaceFieldsHost = {
        read: async (ask) => { asked.push(ask); return vault(ask); },
        reading: () => { told.push('reading'); },
        answered: (answer) => { told.push(answer); },
    };
    const pane = new PlacePane(app, asEl(el), { initial, host });
    const placeholder = (text: string) => withAttr(el, 'placeholder', text)!;
    return {
        el, pane, told, asked,
        note: () => placeholder(t('modal.notePlaceholder')),
        heading: () => placeholder(t('modal.destination.headingEmpty')),
        clears: () => el.findAll('tv-form__clear-button'),
        /** What is said under the note field's row, and under the heading's. */
        says: () => el.findAll('tv-form__says--row').map(row => row.lines()),
    };
}

/** The first element under `el` whose attribute `name` is `value`. */
function withAttr(el: FakeEl, name: string, value: string): FakeEl | null {
    for (const child of el.children) {
        if (child.attrs.get(name) === value) return child;
        const deeper = withAttr(child, name, value);
        if (deeper) return deeper;
    }
    return null;
}

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

afterEach(() => {
    vi.restoreAllMocks();
    noteSuggests.length = 0;
});

describe('PlacePane', () => {
    it('builds the note and heading fields in the pane, on the form\'s shared pieces, with no title nor buttons', () => {
        const h = setUp();

        const form = h.el.children[0];
        expect([...form.classes]).toEqual(['task-hub__place', 'tv-form']);
        expect(form.children.map(child => [...child.classes].join(' '))).toEqual(['tv-form__group']);
        expect(h.el.find('tv-form__title')).toBeNull();
        expect(h.el.find('tv-form__buttons')).toBeNull();
    });

    it('opens its fields on the values given, and reads what they show', async () => {
        const h = setUp({ note: { text: 'Plan', picked: 'Plan.md' }, heading: 'Tasks' });
        await settle();

        expect([h.note().value, h.heading().value]).toEqual(['Plan', 'Tasks']);
        expect(h.asked).toEqual([{ note: { text: 'Plan', picked: 'Plan.md' }, heading: 'Tasks' }]);
        expect(h.told).toEqual(['reading', { kind: 'to', to: { note: { kind: 'existing', path: 'Plan.md' }, spot: { heading: 'Tasks', level: 2, side: 'head' } } }]);
    });

    it('reads again as a field is typed in, telling the host it is reading before the answer', async () => {
        const h = setUp();
        await settle();
        h.note().type('Plan');
        expect(h.told.at(-1)).toBe('reading');
        await settle();
        h.heading().type('');
        await settle();

        expect(h.asked).toEqual([
            { note: { text: '', picked: null }, heading: 'Tasks' },
            { note: { text: 'Plan', picked: null }, heading: 'Tasks' },
            { note: { text: 'Plan', picked: null }, heading: '' },
        ]);
        expect(h.told.at(-1)).toEqual({ kind: 'to', to: { note: { kind: 'existing', path: 'Plan.md' }, spot: 'end' } });
    });

    it('reads again as a field\'s × empties it, telling the host it is reading first', async () => {
        const h = setUp({ note: { text: 'Plan', picked: null }, heading: 'Tasks' });
        await settle();
        h.told.length = 0;
        h.clears()[0].press();

        expect(h.told).toEqual(['reading']);
        await settle();
        expect(h.told).toEqual(['reading', EMPTY]);
    });

    it('reads again as a note is picked from the note field\'s list, telling the host it is reading first', async () => {
        const h = setUp();
        await settle();
        h.told.length = 0;
        noteSuggests[0].selectSuggestion({ kind: 'unresolved', linkpath: 'Plan' }, new Event('click'));

        expect(h.told).toEqual(['reading']);
        await settle();
        expect(h.asked.at(-1)).toEqual({ note: { text: 'Plan', picked: null }, heading: 'Tasks' });
        expect(h.told).toEqual(['reading', { kind: 'to', to: { note: { kind: 'existing', path: 'Plan.md' }, spot: { heading: 'Tasks', level: 2, side: 'head' } } }]);
    });

    it('does nothing on Enter in a field: what they name is told as it is typed', async () => {
        const h = setUp({ note: { text: 'Plan', picked: null }, heading: '' });
        await settle();
        const before = [...h.told];
        h.note().enter();
        h.heading().enter();
        await settle();

        expect(h.told).toEqual(before);
        expect(h.says()).toEqual([[], []]);
    });

    it('says under each field what the logic says, nothing for a note there is', async () => {
        const h = setUp({ note: { text: 'Plan', picked: null }, heading: 'Tasks' });
        await settle();
        expect(h.says()).toEqual([[], []]);

        h.note().type('Idea');
        await settle();
        expect(h.says()).toEqual([[`warning: ${t('modal.newTask.noteNew')}`], []]);
    });

    it('offers the heading field the headings of the note named', async () => {
        const offered = vi.spyOn(DestinationField.prototype, 'offerHeadings');
        setUp({ note: { text: 'Plan', picked: null }, heading: 'Tasks' });
        await settle();

        expect(offered).toHaveBeenLastCalledWith(['Tasks', 'Done']);
    });

    it('answers the focus for its first field on the note field, the caret after its text', () => {
        const h = setUp();
        const focus = h.pane.focus();

        expect(focus?.selection).toBe('end');
        expect(focus?.to as unknown).toBe(h.note());
    });

    it('shuts its fields and their × with the form\'s, and opens them again', () => {
        const h = setUp({ note: { text: 'Plan', picked: null }, heading: 'Tasks' });
        h.pane.setEnabled(false);
        expect([h.note().disabled, h.heading().disabled]).toEqual([true, true]);
        expect(h.clears().map(clear => clear.disabled)).toEqual([true, true]);

        h.pane.setEnabled(true);
        expect([h.note().disabled, h.heading().disabled]).toEqual([false, false]);
        expect(h.clears().map(clear => clear.disabled)).toEqual([false, false]);
    });

    it('tells nothing once disposed', async () => {
        const h = setUp({ note: { text: 'Plan', picked: null }, heading: '' });
        h.pane.dispose();
        await settle();

        expect(h.told).toEqual(['reading']);
    });
});
