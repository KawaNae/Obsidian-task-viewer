import { describe, it, expect, vi } from 'vitest';
import { TaskHubSourceView, type SourceViewActions } from '../../../src/modals/hub/TaskHubSourceView';
import type { SeatView, SourceViewState } from '../../../src/modals/hub/TaskHubSource';
import { FocusDoc, FocusEl, asEl } from '../helpers/focusDom';

vi.mock('../../../src/modals/form/source/SourceEditor', () => ({ editorOn: () => ({}) }));

/**
 * The hub's source mode as it looks (`TaskHubSourceView`), where the card and
 * the source's place stand in the body, which scrolls: the switch's title
 * line does not, so the one it shows is brought into the body's sight.
 *
 * The body's room is laid out by hand: each element of it stands at an
 * offset in the body's content, its rect read from where the body is
 * scrolled, as a browser lays it out.
 */

/** The body's top in the window, and the height it shows (px). */
const BODY_TOP = 178;
const ROOM = 400;

/** An element of the body standing `offset` px down its content, `height` px tall. */
function stand(body: FocusEl, el: FocusEl, at: { offset: number; height: number }): void {
    Object.assign(el, {
        getBoundingClientRect: () => {
            const top = BODY_TOP + at.offset - body.scrollTop;
            return { left: 0, right: 0, top, bottom: top + at.height, height: at.height };
        },
    });
}

function setUp(card: { offset: number; height: number }, pane: { offset: number; height: number }) {
    const doc = new FocusDoc();
    const root = doc.root();
    const head = root.createDiv();
    const body = root.createDiv();
    const foot = root.createDiv();
    Object.assign(body, {
        clientTop: 0,
        clientHeight: ROOM,
        getBoundingClientRect: () => ({ left: 0, right: 0, top: BODY_TOP, bottom: BODY_TOP + ROOM, height: ROOM }),
        scrollTo: ({ top }: { top: number }) => { body.scrollTop = top; },
    });
    const toggle = head.createDiv();
    const shut = body.createDiv();
    const cardEl = body.createDiv();
    const paneEl = body.createDiv();
    stand(body, cardEl, card);
    stand(body, paneEl, pane);
    const actions: SourceViewActions = {
        enter: vi.fn(), back: vi.fn(), draftText: () => null,
        cancel: vi.fn(), apply: vi.fn(), discard: vi.fn(), keep: vi.fn(),
    };
    const view = new TaskHubSourceView({} as never, {
        toggle: asEl(toggle), shut: asEl(shut), card: asEl(cardEl), pane: asEl(paneEl), foot: asEl(foot), body: asEl(body),
    }, actions);
    const seat: SeatView = { foot: null, busy: false, asking: false, lost: null };
    const state = (open: boolean, over: Partial<SourceViewState> = {}): SourceViewState => ({
        phase: open ? 'source' : 'view', shut: null, held: false, issues: [], seat: open ? seat : null, ...over,
    });
    const shown = (el: FocusEl) => el.style.display !== 'none';
    const viewButton = toggle.findAll('task-hub__mode-button')[0];
    view.render(state(false));
    return { view, body, card: cardEl, pane: paneEl, state, shown, actions, viewButton };
}

describe('the card and the source swapped by the switch on the title\'s line', () => {
    it('opens the source in sight: the body scrolled up to the source\'s top where it stood above the body', () => {
        const s = setUp({ offset: 120, height: 200 }, { offset: 120, height: 150 });
        s.body.scrollTop = 392;
        s.view.render(s.state(true));
        expect(s.shown(s.pane)).toBe(true);
        expect(s.body.scrollTop).toBe(120);
    });

    it('goes back to the card in sight: the body scrolled up to the card\'s top', () => {
        const s = setUp({ offset: 120, height: 200 }, { offset: 120, height: 150 });
        s.view.render(s.state(true));
        s.body.scrollTop = 392;
        s.view.render(s.state(false));
        expect(s.shown(s.card)).toBe(true);
        expect(s.body.scrollTop).toBe(120);
    });

    it('scrolls down to the bottom of the one shown where it ended below the body, and no further', () => {
        const s = setUp({ offset: 500, height: 150 }, { offset: 500, height: 150 });
        s.view.render(s.state(true));
        expect(s.body.scrollTop).toBe(500 + 150 - ROOM);
    });

    it('puts the top of one taller than the body at the body\'s top, from above and from below', () => {
        const s = setUp({ offset: 120, height: 700 }, { offset: 120, height: 600 });
        s.body.scrollTop = 392;
        s.view.render(s.state(true));
        expect(s.body.scrollTop).toBe(120);

        s.body.scrollTop = 0;
        const low = setUp({ offset: 450, height: 700 }, { offset: 450, height: 600 });
        low.view.render(low.state(true));
        expect(low.body.scrollTop).toBe(450);
    });

    it('leaves the body where it is when the one shown is in sight, and on a draw that swaps nothing', () => {
        const s = setUp({ offset: 120, height: 200 }, { offset: 120, height: 150 });
        s.body.scrollTop = 50;
        s.view.render(s.state(true));
        expect(s.body.scrollTop).toBe(50);

        s.body.scrollTop = 392;
        s.view.render(s.state(true, { issues: [{ at: 'form', tone: 'error', text: 'not a task' }] }));
        expect(s.body.scrollTop).toBe(392);
    });

    it('brings the source and what is said under it into sight when the switch back is pressed and the source stays', () => {
        const s = setUp({ offset: 120, height: 200 }, { offset: 120, height: 150 });
        s.view.render(s.state(true));
        s.body.scrollTop = 392;
        s.viewButton.dispatchEvent(new Event('click'));
        expect(s.actions.back).toHaveBeenCalledTimes(1);
        expect(s.shown(s.pane)).toBe(true);
        expect(s.body.scrollTop).toBe(120);
    });
});
