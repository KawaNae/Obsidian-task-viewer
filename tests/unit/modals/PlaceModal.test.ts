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
 * however it closes; and its fields tied to its logic: what they show as
 * they open, what is typed and an Enter in them reach the logic, and what
 * the logic says is drawn under them and on the button. The overlay is a stand-in that keeps OverlayShell's
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

/** An app whose new notes go in `folder`, whatever note they are reckoned from; the notes they were reckoned from, in `from`. */
function appOf(folder = '/') {
    const from: string[] = [];
    const app = { fileManager: { getNewFileParent: (source: string) => { from.push(source); return { path: folder }; } }, keymap: {}, scope: {} } as never;
    return { app, from };
}
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
 * The vault as the fields name it: nothing in an empty note field, and any
 * name `Plan.md`, at the end of it or under the heading named, its headings
 * `Tasks` and `Done`.
 */
function vault(ask: DestinationAsk): NoteRead {
    if (ask.note.text === '') return EMPTY;
    const spot = ask.heading === '' ? 'end' as const : { heading: ask.heading, level: 2, side: 'head' as const };
    const heading = spot === 'end' ? null : { kind: 'one' as const, heading: { level: 2, text: spot.heading, line: 0 } as never };
    return { ...PLAN, to: { note: { kind: 'existing', path: 'Plan.md' }, spot }, heading, headings: ['Tasks', 'Done'] };
}

function setUp(opts: Partial<PlaceOptions> = {}, read: (ask: DestinationAsk) => NoteRead = () => PLAN, app = appOf().app) {
    const shell = new StandInShell();
    const asked: { ask: DestinationAsk; folder: string }[] = [];
    const answers: (NoteDestination | null)[] = [];
    const answered = PlaceModal.pick(app, {
        readFields: async (ask, folder) => { asked.push({ ask, folder }); return read(ask); },
    }, {
        purpose: 'create',
        initial: { note: { text: '', picked: null }, heading: 'Tasks' },
        folderFrom: '',
        ...opts,
    }, shell).then((to) => { answers.push(to); return to; });
    const buttons = () => shell.foot.find('tv-form__buttons')!.children;
    const placeholder = (text: string) => withAttr(shell.body, 'placeholder', text)!;
    return {
        shell, asked, answers, answered, buttons,
        cta: () => buttons().find(b => b.classes.has('mod-cta'))!,
        note: () => placeholder(t('modal.notePlaceholder')),
        heading: () => placeholder(t('modal.destination.headingEmpty')),
        /** What is said under the note field's row, and under the heading's. */
        says: () => shell.body.findAll('tv-form__says--row').map(el => el.lines()),
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

    it('opens with the focus on the note field, the caret after its text', () => {
        const h = setUp();
        const focus = h.shell.opts!.initialFocus!();

        expect(focus?.selection).toBe('end');
        expect((focus?.to as unknown as FakeEl).attrs.get('placeholder')).toBe(t('modal.notePlaceholder'));
    });

    it('asks the fields as they open, a new note\'s folder reckoned from the note given', async () => {
        const h = setUp({ initial: { note: { text: 'Plan', picked: null }, heading: '' } });
        await settle();

        expect(h.asked).toEqual([{ ask: { note: { text: 'Plan', picked: null }, heading: '' }, folder: '' }]);
    });

    it('asks of the heading the field opens on, and places under it', async () => {
        const h = setUp({ initial: { note: { text: 'Plan', picked: null }, heading: 'Tasks' } }, vault);
        await settle();

        expect(h.heading().value).toBe('Tasks');
        expect(h.asked.map(one => one.ask.heading)).toEqual(['Tasks']);
        h.cta().press();
        expect((await h.answered)?.spot).toEqual({ heading: 'Tasks', level: 2, side: 'head' });
    });

    it('asks again as a field is typed in, and places where the fields name now', async () => {
        const h = setUp({}, vault);
        await settle();
        h.note().type('Plan');
        await settle();
        h.heading().type('');
        await settle();

        expect(h.asked.map(one => one.ask)).toEqual([
            { note: { text: '', picked: null }, heading: 'Tasks' },
            { note: { text: 'Plan', picked: null }, heading: 'Tasks' },
            { note: { text: 'Plan', picked: null }, heading: '' },
        ]);
        h.cta().press();
        expect(await h.answered).toEqual({ note: { kind: 'existing', path: 'Plan.md' }, spot: 'end' });
    });

    it('takes a press of its button only while a place is named', async () => {
        const h = setUp({}, vault);
        await settle();
        expect(h.cta().disabled).toBe(true);

        h.note().type('Plan');
        await settle();
        expect(h.cta().disabled).toBe(false);
    });

    it('on Enter in the empty note field, says under it that a note is wanted, and places nothing', async () => {
        const h = setUp({}, vault);
        await settle();
        expect(h.says()).toEqual([[], []]);

        h.note().enter();
        expect(h.says()).toEqual([[`error: ${t('modal.destination.nameEmpty')}`], []]);
        expect(h.shell.opts).not.toBeNull();
    });

    it('says under each field what the fields name', async () => {
        const h = setUp({ initial: { note: { text: 'Plan', picked: null }, heading: 'Tasks' } }, vault);
        await settle();

        expect(h.says()).toEqual([
            [`info: ${t('modal.destination.noteExisting', { note: 'Plan.md' })}`],
            [`info: ${t('modal.place.toHead', { heading: 'Tasks' })}`],
        ]);
    });

    it('reckons a new note\'s folder from the note it is given', async () => {
        const { app, from } = appOf('Inbox');
        const h = setUp({ folderFrom: 'Daily/2026-11-24.md' }, vault, app);
        await settle();

        expect(from).toEqual(['Daily/2026-11-24.md']);
        expect(h.asked.map(one => one.folder)).toEqual(['Inbox']);
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
