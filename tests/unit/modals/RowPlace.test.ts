import { describe, it, expect, vi } from 'vitest';
import { t } from '../../../src/i18n';
import { RowPlace, type PlaceMove, type RowPlaceHost } from '../../../src/modals/hub/RowPlace';
import type { SendViewState } from '../../../src/modals/noteops/SendDialog';
import type { ShownPlace } from '../../../src/modals/place/PlaceShown';
import { FocusDoc, asEl, type FocusEl } from '../helpers/focusDom';

/**
 * Where a row stands, as the hub on it shows it (`RowPlace`): the place shown
 * with no field, and a button on the note's row that begins a move; in a
 * move, the destination's fields in its place, drawn as the move's send
 * says. Which of the two it is comes from the host each time it is
 * refreshed. The move is a stand-in that records what it is told.
 */

const app = { fileManager: { getNewFileParent: () => ({ path: '/' }) }, keymap: { pushScope: () => { }, popScope: () => { } }, scope: {} } as never;

const HERE: ShownPlace = { note: 'note.md', heading: 'Tasks', parent: 'Parent' };

function setUp(movable = true) {
    const doc = new FocusDoc();
    const root = doc.root();
    const pane = root.createDiv();
    const before = pane.createDiv({ cls: 'dates' });
    let move: PlaceMove | null = null;
    const host = {
        shown: () => HERE,
        moving: () => move,
        beginMove: vi.fn<RowPlaceHost['beginMove']>(async () => { }),
    };
    const place = new RowPlace(app, asEl(pane), host, movable);
    const made = () => ({
        initial: { note: { text: 'note', picked: 'note.md' }, heading: 'Tasks' },
        fieldsChanged: vi.fn<PlaceMove['fieldsChanged']>(),
        check: vi.fn<PlaceMove['check']>(),
        submit: vi.fn<PlaceMove['submit']>(),
        show: vi.fn<PlaceMove['show']>(),
    });
    return {
        doc, pane, before, place, host, made,
        /** The host is in `next` now, or in no move, and the form refreshes its fields. */
        moveTo: (next: PlaceMove | null) => { move = next; place.refresh(); },
        button: () => pane.find('task-hub__move'),
        shownGroup: () => pane.find('task-hub__shown'),
    };
}

/** Every text under `el`, in order. */
function said(el: FocusEl): string[] {
    return [el.text, ...el.children.flatMap(said)].filter(text => text !== '');
}

const STATE: SendViewState = {
    phase: 'open',
    headings: ['Tasks', 'Done'],
    candidates: null,
    issues: [
        { at: 'note', tone: 'info', text: 'under the note' },
        { at: 'heading', tone: 'error', text: 'under the heading' },
        { at: 'form', tone: 'warning', text: 'of the move' },
    ],
    canSend: false,
};

describe('out of a move', () => {
    it('shows where the row stands with a button at the end of the note\'s row, named as the menu\'s item, that begins a move there', () => {
        const s = setUp();
        const button = s.button()!;
        expect(button.attrs.get('aria-label')).toBe(t('menu.sendToNote'));
        const rows = s.shownGroup()!.findAll('tv-form__row');
        expect(rows).toHaveLength(3);
        expect(rows[0].children.at(-1)).toBe(button);
        button.dispatchEvent(new Event('click'));
        expect(s.host.beginMove).toHaveBeenCalledWith('here');
    });

    it('has no button on a row read only; the button is shut with the form', () => {
        expect(setUp(false).button()).toBeNull();
        const s = setUp();
        s.place.setEnabled(false);
        expect(s.button()!.disabled).toBe(true);
        s.place.setEnabled(true);
        expect(s.button()!.disabled).toBe(false);
    });

    it('has no field to focus', () => {
        expect(setUp().place.focus()).toBeNull();
    });
});

describe('in a move', () => {
    it('puts the destination\'s fields in the shown place\'s stead, on where the move opened, the parent\'s row gone, answering the note as its focus and putting none', () => {
        const s = setUp();
        const move = s.made();
        s.moveTo(move);
        expect(s.shownGroup()).toBeNull();
        expect(s.pane.children[0]).toBe(s.before);
        const group = s.pane.children[1];
        expect(group.classList.contains('task-hub__place')).toBe(true);
        const note = s.place.focus()!.to as unknown as FocusEl;
        expect(group.contains(note)).toBe(true);
        expect(note.value).toBe('note');
        // The host puts it once the rest of the move is drawn (`HubForm.focusPlace`).
        expect(s.doc.activeElement).not.toBe(note);
        expect(move.show).toHaveBeenCalledWith(s.place);
    });

    it('says under the note and the heading what the send says of them, and not what it says of the move as a whole', () => {
        const s = setUp();
        s.moveTo(s.made());
        s.place.render(STATE);
        const texts = said(s.pane);
        expect(texts).toContain('under the note');
        expect(texts).toContain('under the heading');
        expect(texts).not.toContain('of the move');
        // The first field an error is said under takes the focus.
        const heading = s.place.focus()!.to as unknown as FocusEl;
        expect(heading.value).toBe('Tasks');
    });

    it('tells the move what its fields hold as they are typed in', () => {
        const s = setUp();
        const move = s.made();
        s.moveTo(move);
        (s.place.focus()!.to as unknown as FocusEl).type('Plan');
        expect(move.fieldsChanged).toHaveBeenLastCalledWith(expect.objectContaining({ note: expect.objectContaining({ text: 'Plan' }), heading: 'Tasks' }));
    });

    it('shuts its fields with the form', () => {
        const s = setUp();
        s.moveTo(s.made());
        s.place.setEnabled(false);
        expect((s.place.focus()!.to as unknown as FocusEl).disabled).toBe(true);
    });

    it('gives way to the shown place again once the host is in no move, the focus on the button', () => {
        const s = setUp();
        const move = s.made();
        s.moveTo(move);
        s.place.render(STATE);
        s.moveTo(null);
        expect(s.pane.children).toEqual([s.before, s.shownGroup()]);
        expect(said(s.pane)).not.toContain('under the note');
        expect(move.show).toHaveBeenLastCalledWith(null);
        expect(s.doc.activeElement).toBe(s.button());
        expect(s.place.focus()).toBeNull();
    });
});
