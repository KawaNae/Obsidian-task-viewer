import { describe, it, expect } from 'vitest';
import { t } from '../../../src/i18n';
import type { AskShell } from '../../../src/modals/ask/Ask';
import { PlaceModal, type PlaceOptions } from '../../../src/modals/place/PlaceModal';
import type { DestinationAsk, NoteDestination, NoteRead } from '../../../src/services/data/NotePlaces';
import { CloseGate } from '../../../src/views/sharedUI/CloseGate';
import type { OverlayOpenOpts } from '../../../src/views/sharedUI/OverlayShell';
import { FakeEl, asEl } from '../helpers/fakeDom';

/**
 * The place dialog as it opens on its overlay (`PlaceModal`): the title and
 * the button the opener gives, the focus, and the one answer it gives
 * however it closes. The overlay is a stand-in that keeps OverlayShell's
 * rules: every close the user asks for goes through `beforeClose`, and
 * `onClose` is called once.
 */

class StandInShell implements AskShell {
    opts: OverlayOpenOpts | null = null;
    readonly body = new FakeEl();
    readonly head = new FakeEl();
    readonly foot = new FakeEl();
    private readonly gate = new CloseGate({
        isOpen: () => this.opts !== null,
        ask: () => this.opts?.beforeClose?.() ?? 'close',
        close: () => this.close(),
    });

    open(opts: OverlayOpenOpts): void {
        this.opts = opts;
        opts.build(asEl(this.body), { head: asEl(this.head), foot: asEl(this.foot) });
    }

    close(): void {
        const opts = this.opts;
        if (!opts) return;
        this.opts = null;
        opts.onClose?.();
    }

    requestClose(): Promise<boolean> {
        return this.gate.request();
    }
}

const APP = { fileManager: { getNewFileParent: () => ({ path: '/' }) }, keymap: {}, scope: {} } as never;
const PLAN: NoteRead = {
    kind: 'existing',
    lines: [],
    path: 'Plan.md',
    to: { note: { kind: 'existing', path: 'Plan.md' }, spot: 'end' },
    heading: null,
    headings: [],
    ignored: false,
};

function setUp(opts: Partial<PlaceOptions> = {}) {
    const shell = new StandInShell();
    const asked: { ask: DestinationAsk; folder: string }[] = [];
    const answers: (NoteDestination | null)[] = [];
    const answered = PlaceModal.pick(APP, {
        readFields: async (ask, folder) => { asked.push({ ask, folder }); return PLAN; },
    }, {
        purpose: 'create',
        initial: { note: { text: '', picked: null }, heading: 'Tasks' },
        folderFrom: '',
        ...opts,
    }, shell).then((to) => { answers.push(to); return to; });
    const buttons = () => shell.foot.find('tv-form__buttons')!.children;
    return { shell, asked, answers, answered, buttons, cta: () => buttons().find(b => b.classes.has('mod-cta'))! };
}

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('PlaceModal', () => {
    it('to make a task, the hub\'s title in the head, and cancel and next in the foot', () => {
        const h = setUp({ purpose: 'create' });

        expect(h.shell.head.textContent).toBe(t('modal.newTask.title'));
        expect(h.buttons().map(b => b.text)).toEqual([t('modal.cancel'), t('modal.place.next')]);
    });

    it('to move a task to make, the change title, and cancel and change', () => {
        const h = setUp({ purpose: 'move' });

        expect(h.shell.head.textContent).toBe(t('modal.place.moveTitle'));
        expect(h.buttons().map(b => b.text)).toEqual([t('modal.cancel'), t('modal.place.move')]);
    });

    it('opens with the focus on the note field, its text selected', () => {
        const h = setUp();
        const focus = h.shell.opts!.initialFocus!();

        expect(focus?.selection).toBe('all');
        expect((focus?.to as unknown as FakeEl).attrs.get('placeholder')).toBe(t('modal.notePlaceholder'));
    });

    it('asks the fields as they open, a new note\'s folder reckoned from the note given', async () => {
        const h = setUp({ initial: { note: { text: 'Plan', picked: null }, heading: '' } });
        await settle();

        expect(h.asked).toEqual([{ ask: { note: { text: 'Plan', picked: null }, heading: '' }, folder: '' }]);
    });

    it('answers the place chosen once it has closed', async () => {
        const h = setUp();
        await settle();
        (h.cta() as unknown as { dispatchEvent(e: Event): void }).dispatchEvent(new Event('click'));

        expect(await h.answered).toEqual({ note: { kind: 'existing', path: 'Plan.md' }, spot: 'end' });
        expect(h.shell.opts).toBeNull();
    });

    it('answers null for a close of any other kind, asking nothing', async () => {
        const h = setUp();
        await settle();
        expect(await h.shell.requestClose()).toBe(true);

        expect(await h.answered).toBeNull();
        await settle();
        expect(h.answers).toEqual([null]);
    });

    it('answers null for cancel', async () => {
        const h = setUp();
        h.buttons().find(b => b.classes.has('tv-form__cancel'))!.dispatchEvent(new Event('click'));

        expect(await h.answered).toBeNull();
    });
});
