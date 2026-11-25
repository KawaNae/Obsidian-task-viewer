import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { TaskHubForm } from '../../../src/modals/hub/TaskHubForm';
import { DraftHost } from '../../../src/modals/hub/DraftHost';
import type { CreatePlace, PlaceFacts } from '../../../src/services/data/CreatePlaces';
import type { NewRow } from '../../../src/services/persistence/NewRow';
import type { WriteAnswer } from '../../../src/services/operations/WriteAnswer';
import type { CloseAnswer } from '../../../src/views/sharedUI/CloseGate';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SETTINGS } from '../../../src/types/Settings';
import type { DraftSeed } from '../../../src/services/data/TaskDraft';
import { t } from '../../../src/i18n';
import { refusalText } from '../../../src/services/operations/WriteAnswer';
import { valuesOf } from '../helpers/properties';
import { FocusDoc, FocusEl, asEl } from '../helpers/focusDom';
import type { HubHost } from '../../../src/modals/hub/HubHost';

// The icon a button shows, read back from its element.
vi.mock('obsidian', async (importOriginal) => ({
    ...await importOriginal<typeof import('obsidian')>(),
    setIcon: (el: FocusEl, icon: string) => { el.setAttribute('data-icon', icon); },
}));

/**
 * The hub's form on a task not written yet (`DraftHost`), in a stand-in DOM
 * (`focusDom`). Each field hands its change on to the draft and the card is
 * drawn again, and nothing is written; the create writes once, the fields
 * put in first; a close asks whether to throw away a task that was given
 * anything, and once only. What the create does, and why a create was
 * refused, is said on a line above it in the foot, which a button at the
 * row's start shows or hides.
 */

beforeAll(() => {
    vi.stubGlobal('Element', FocusEl);
    vi.stubGlobal('HTMLInputElement', class { });
    vi.stubGlobal('document', {
        createDocumentFragment: () => ({ appendChild: () => { } }),
        createElement: () => ({ style: {}, classList: { add: () => { } }, setAttribute: () => { }, appendChild: () => { } }),
    });
});
afterAll(() => { vi.unstubAllGlobals(); });

/** A row under a heading that gives it a color, a value and a list: what a line put beside it inherits, and from where. */
const SIBLING = FileParsePipeline.parse('n.md', [
    '# h',
    '- tv-color:: red',
    '- owner:: you',
    '- area::',
    '    - lab',
    '    - desk',
    '- [ ] 親',
], DEFAULT_SETTINGS, namesOutsideIndex('n.md')).tasks[0];

const PLACE: CreatePlace = { kind: 'childOf', taskId: 'parent' };
const FACTS: PlaceFacts = { kind: 'childOf', parent: '親', inherits: SIBLING.cascadeContext!, inheritedFrom: SIBLING.inheritedFrom };

const GONE: PlaceFacts = { kind: 'gone', inherits: {} };
const IGNORED: PlaceFacts = {
    kind: 'note', path: '2031-01-15.md', spot: { heading: 'Tasks', level: 2, side: 'head' }, note: 'existing', seed: 'daily',
    heading: { kind: 'none' }, ignored: true, inherits: {},
};

const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

interface MenuItem { pick: () => void }

/** A form on a draft at a place that has answered, its writes held until the test answers them. */
async function setUp(seed: DraftSeed = {}, opts: { hold?: boolean; facts?: PlaceFacts; place?: boolean } = {}) {
    const doc = new FocusDoc();
    Object.assign(doc, { createElement: () => ({ getContext: () => null }) });
    // The panel: the form in its body, the row of buttons in its foot.
    const root = doc.root();
    const body = root.createDiv({ cls: 'tv-overlay__body' });
    const foot = root.createDiv({ cls: 'tv-overlay__foot' });
    const rows: NewRow[] = [];
    let answer = () => { };
    const writes: ((answer: WriteAnswer) => void)[] = [];
    const places = {
        noteOf: () => 'n.md',
        fromDestination: () => { throw new Error('the place fields give no answer here'); },
        facts: vi.fn(() => (opts.hold ? new Promise<PlaceFacts>(resolve => { answer = () => resolve(opts.facts ?? FACTS); }) : Promise.resolve(opts.facts ?? FACTS))),
        create: vi.fn((_place: CreatePlace, row: NewRow) => {
            rows.push(row);
            return new Promise<WriteAnswer>(resolve => { writes.push(resolve); });
        }),
    };
    const menus: MenuItem[][] = [];
    const present = (build: (menu: unknown) => void) => {
        const items: MenuItem[] = [];
        const menu = {
            addItem: (cb: (item: unknown) => void) => {
                const one: MenuItem = { pick: () => { } };
                const item = { setTitle: () => item, setChecked: () => item, onClick: (fn: () => void) => { one.pick = fn; return item; } };
                cb(item);
                items.push(one);
                return menu;
            },
        };
        build(menu);
        menus.push(items);
    };
    const app = { keymap: { pushScope: () => { }, popScope: () => { } } } as never;
    const plugin = { settings: DEFAULT_SETTINGS, menuPresenter: { present } } as never;
    const index = { getTasks: () => [], getTask: () => undefined, onChange: () => () => { } } as never;
    const host = new DraftHost(PLACE, seed, { places, scopeKeys: () => DEFAULT_SETTINGS.scopeKeys });
    const closes: CloseAnswer[] = [];
    // The place tab's pane beside the form's, as the panel builds them: its
    // field, and the tab chosen for an element, told with where the focus is then.
    const placeEl = root.createDiv();
    const placeInput = placeEl.createEl('input');
    const pane = {
        focus: vi.fn(() => ({ to: asEl(placeInput), selection: 'end' as const })),
        setEnabled: vi.fn(),
        dispose: vi.fn(),
    };
    const revealed: { el: FocusEl; focused: boolean }[] = [];
    const tabs = opts.place ? {
        place: { el: asEl(placeEl), pane },
        reveal: (el: Element) => { const at = el as unknown as FocusEl; revealed.push({ el: at, focused: doc.activeElement === at }); },
    } : {};
    const form: TaskHubForm = new TaskHubForm(asEl(body), host, { app, plugin, index, foot: asEl(foot), requestClose: () => { closes.push(form.beforeClose()); }, ...tabs });
    const panel = { redrawPreview: vi.fn(), close: vi.fn() };
    host.attach(panel);
    await settle();
    const el = (field: Parameters<TaskHubForm['fieldElement']>[0]) => form.fieldElement(field) as unknown as FocusEl;
    const create = () => root.findAll('mod-cta')[0];
    return {
        root, body, foot, host, form, panel, places, rows, closes, menus, el, create, placeInput, pane, revealed,
        write: async (written: WriteAnswer) => { writes.at(-1)!(written); await settle(); },
        answer: async () => { answer(); await settle(); },
        press: (target: FocusEl) => target.dispatchEvent(new Event('click')),
        /** The row of the property `key`. */
        rowOf: (key: string) => root.findAll('tv-form__row').find(row => row.find('tv-form__label')?.children.some(c => c.text === key)),
    };
}

describe('the fields of a hub on a task not written yet', () => {
    it('hand each change on to the draft and draw the card again, writing nothing', async () => {
        const s = await setUp();
        const drawn = () => s.panel.redrawPreview.mock.calls.length;

        let before = drawn();
        s.el('name').focus();
        s.el('name').type('電話 #仕事');
        s.el('name').enter();
        await settle();
        expect(s.host.task()).toMatchObject({ content: '電話 #仕事', tags: ['仕事'] });
        expect(drawn()).toBeGreaterThan(before);

        before = drawn();
        s.press(s.el('status'));
        s.menus[0][DEFAULT_SETTINGS.statusDefinitions.findIndex(d => d.char === 'x')].pick();
        await settle();
        expect(s.host.task().statusChar).toBe('x');
        expect(drawn()).toBeGreaterThan(before);

        s.el('start').focus();
        s.el('start').type('2031-01-20');
        s.el('start').enter();
        expect(s.host.task().startDate).toBe('2031-01-20');

        s.el('tags').focus();
        s.el('tags').type('家');
        s.el('tags').enter();
        expect(s.host.task().tags).toEqual(['仕事', '家']);

        s.el('linestyle').focus();
        s.el('linestyle').type('dashed');
        s.el('linestyle').enter();
        expect(s.host.task().linestyle).toBe('dashed');

        expect(s.places.create).not.toHaveBeenCalled();
    });

    it('make an inherited value the task\'s own when it is typed again', async () => {
        const s = await setUp();
        const input = s.rowOf('owner')!.find('tv-form__control')!;
        expect(s.rowOf('owner')!.classes.has('task-hub__row--cascade')).toBe(true);
        input.focus();
        input.type('you');
        input.enter();
        await settle();

        expect(valuesOf(s.host.task().properties)).toEqual({ owner: { type: 'text', text: 'you', spelling: 'you' } });
        expect(s.places.create).not.toHaveBeenCalled();
    });

    it('make an inherited list the task\'s own from its items, written to the draft by its first edit', async () => {
        const s = await setUp();
        s.press(s.rowOf('area')!.find('task-hub__make-own')!);
        expect(s.host.task().properties).toEqual({});

        const add = s.rowOf('area')!.find('task-hub__list-add')!;
        add.focus();
        add.type('shed');
        add.enter();
        await settle();
        expect(valuesOf(s.host.task().properties).area).toMatchObject({ type: 'list', items: [{ text: 'lab' }, { text: 'desk' }, { text: 'shed' }] });
        expect(s.places.create).not.toHaveBeenCalled();
    });

    it('take a property\'s row out with its ×, and the row does not come back as the fields are built anew', async () => {
        const s = await setUp();
        const addRow = () => s.root.find('task-hub__prop-add')!;
        const key = addRow().find('tv-form__label')!.children.find(c => c.placeholder !== '')!;
        key.focus();
        key.type('memo');
        addRow().find('tv-form__control')!.type('x');
        key.enter();
        expect(Object.keys(valuesOf(s.host.task().properties))).toEqual(['memo']);

        s.press(s.rowOf('memo')!.find('task-hub__prop-remove')!);
        await settle();
        s.form.refresh();
        expect(s.host.task().properties).toEqual({});
        expect(s.rowOf('memo')).toBeUndefined();
    });
});

describe('the dates of a hub on a task not written yet', () => {
    const startTime = (s: Awaited<ReturnType<typeof setUp>>) => s.root.findAll('tv-ctrl__text-input')
        .find(input => input.attrs.get('aria-label') === `${t('modal.start')} — ${t('modal.time')}`)!;

    it('read a time with no date as a start only where the place gives a start date', async () => {
        const plain = await setUp();
        startTime(plain).focus();
        startTime(plain).type('10:00');
        startTime(plain).enter();
        expect(plain.host.task().startTime).toBeUndefined();

        const given = await setUp({}, { facts: { ...FACTS, inherits: { ...FACTS.inherits, startDate: '2031-01-10' } } });
        startTime(given).focus();
        startTime(given).type('10:00');
        startTime(given).enter();
        expect(given.host.task().startTime).toBe('10:00');
        expect(given.host.task().startDate).toBeUndefined();
    });

    it('creates nothing where a time committed breaks a rule once the place no longer gives the start date it leant on, and puts the focus on it', async () => {
        const s = await setUp({}, { facts: { ...FACTS, inherits: { ...FACTS.inherits, startDate: '2031-01-10' } } });
        startTime(s).focus();
        startTime(s).type('10:00');
        startTime(s).enter();
        expect(s.host.task().startTime).toBe('10:00');

        // A refused create asks the place again, which now gives no start date.
        s.places.facts.mockResolvedValue(FACTS);
        s.press(s.create());
        await s.write({ written: false, refused: null });
        expect(s.host.task().cascadeContext?.startDate).toBeUndefined();

        s.el('name').focus();
        s.press(s.create());
        expect(s.places.create).toHaveBeenCalledTimes(1);
        expect(startTime(s).ownerDocument.activeElement).toBe(startTime(s));
    });
});

describe('the create of a hub on a task not written yet', () => {
    it('is not offered before the place has answered, and what was typed meanwhile stays once it answers', async () => {
        const s = await setUp({}, { hold: true });
        expect(s.create().disabled).toBe(true);
        s.press(s.create());
        expect(s.places.create).not.toHaveBeenCalled();

        s.el('name').focus();
        s.el('name').type('電話');
        s.el('name').enter();
        s.el('tags').focus();
        s.el('tags').type('打ちかけ');
        await s.answer();

        expect(s.create().disabled).toBe(false);
        expect(s.el('name').value).toBe('電話');
        expect(s.el('tags').value).toBe('打ちかけ');
        expect(s.host.task()).toMatchObject({ content: '電話', cascadeContext: { color: 'red' } });
    });

    it('is offered once the place has answered', async () => {
        const s = await setUp();
        expect(s.create().text).toBe(t('modal.create'));
        expect(s.create().disabled).toBe(false);
    });

    it('creates nothing while a value typed does not read, and puts the focus on it', async () => {
        const s = await setUp();
        s.el('start').focus();
        s.el('start').type('not a date');
        s.el('name').focus();
        s.press(s.create());

        expect(s.places.create).not.toHaveBeenCalled();
        expect(s.el('start').ownerDocument.activeElement).toBe(s.el('start'));
    });

    it('puts in what is typed and reads before it creates', async () => {
        const s = await setUp();
        s.el('name').focus();
        s.el('name').type('電話');
        s.press(s.create());

        expect(s.places.create).toHaveBeenCalledTimes(1);
        expect(s.rows[0].line).toBe('- [ ] 電話');
    });

    it('creates with no name', async () => {
        const s = await setUp();
        s.press(s.create());
        expect(s.places.create).toHaveBeenCalledTimes(1);
        expect(s.rows[0].line.trimEnd()).toBe('- [ ]');
    });

    it('creates nothing on the name\'s Enter', async () => {
        const s = await setUp();
        s.el('name').focus();
        s.el('name').type('電話');
        s.el('name').enter();
        expect(s.places.create).not.toHaveBeenCalled();
    });

    it('reads as creating, and shuts the fields, while it is under way', async () => {
        const s = await setUp();
        s.press(s.create());
        expect(s.create().text).toBe(t('modal.newTask.creating'));
        expect(s.create().disabled).toBe(true);
        expect(s.el('name').disabled).toBe(true);

        await s.write({ written: false, refused: null });
        expect(s.create().text).toBe(t('modal.create'));
        expect(s.el('name').disabled).toBe(false);
    });
});

describe('a close of a hub on a task not written yet', () => {
    const asked = (s: Awaited<ReturnType<typeof setUp>>) => s.root.find('tv-form__ask')?.text ?? '';

    it('offers cancel before the create, which closes as × does: at once with nothing given, else asking', async () => {
        const plain = await setUp({ startDate: '2031-01-15' });
        const cancel = plain.root.find('tv-form__cancel')!;
        expect([cancel.text, cancel.style.display]).toEqual([t('modal.cancel'), '']);
        const row = plain.root.find('tv-form__buttons')!;
        expect(row.children.indexOf(cancel)).toBeLessThan(row.children.indexOf(plain.create()));
        plain.press(cancel);
        expect(plain.closes).toEqual(['close']);

        const given = await setUp();
        given.el('name').focus();
        given.el('name').type('電話');
        given.press(given.root.find('tv-form__cancel')!);
        expect(given.closes).toEqual(['stay']);
        expect(asked(given)).toBe(t('modal.newTask.discardAsk'));
    });

    it('asks nothing when nothing was given', async () => {
        const s = await setUp({ startDate: '2031-01-15' });
        expect(s.form.beforeClose()).toBe('close');
        expect(asked(s)).toBe('');
    });

    it('asks nothing when what was given was taken back', async () => {
        const s = await setUp();
        s.el('name').focus();
        s.el('name').type('電話');
        s.el('name').enter();
        s.el('name').type('');
        s.el('name').enter();
        expect(s.form.beforeClose()).toBe('close');
    });

    it('asks whether to throw it away when a name was typed and not left, and throws it away when told, asking once', async () => {
        const s = await setUp();
        s.el('name').focus();
        s.el('name').type('電話');

        expect(s.form.beforeClose()).toBe('stay');
        expect(asked(s)).toBe(t('modal.newTask.discardAsk'));
        expect(s.root.find('tv-form__cancel')?.text).toBe(t('modal.draft.keep'));

        s.press(s.root.find('tv-form__discard')!);
        expect(s.closes).toEqual(['close']);
        expect(s.places.create).not.toHaveBeenCalled();
    });

    it('asks again when a close after a kept question finds the task given something still', async () => {
        const s = await setUp();
        s.el('name').focus();
        s.el('name').type('電話');
        expect(s.form.beforeClose()).toBe('stay');
        s.press(s.root.find('tv-form__cancel')!);
        expect(asked(s)).toBe('');
        expect(s.form.beforeClose()).toBe('stay');
    });

    it('asks whether to throw the whole task away when a value typed does not read, and closes on one answer, writing nothing', async () => {
        const s = await setUp();
        s.el('name').focus();
        s.el('name').type('電話');
        s.el('name').enter();
        s.el('start').focus();
        s.el('start').type('not a date');

        expect(s.form.beforeClose()).toBe('stay');
        expect(asked(s)).toBe(t('modal.newTask.discardAsk'));
        expect(s.root.find('tv-form__cancel')?.text).toBe(t('modal.draft.keep'));

        s.press(s.root.find('tv-form__discard')!);
        expect(s.closes).toEqual(['close']);
        expect(s.places.create).not.toHaveBeenCalled();
    });

    it('puts the focus on the value that does not read when the task is kept', async () => {
        const s = await setUp();
        s.el('name').focus();
        s.el('name').type('電話');
        s.el('name').enter();
        s.el('start').focus();
        s.el('start').type('not a date');
        s.el('name').focus();

        expect(s.form.beforeClose()).toBe('stay');
        s.press(s.root.find('tv-form__cancel')!);
        expect(asked(s)).toBe('');
        expect(s.el('start').ownerDocument.activeElement).toBe(s.el('start'));
    });

    it('asks whether to throw the task away when all it was given is a value that does not read', async () => {
        const s = await setUp();
        s.el('start').focus();
        s.el('start').type('not a date');

        expect(s.form.beforeClose()).toBe('stay');
        expect(asked(s)).toBe(t('modal.newTask.discardAsk'));
    });

    it('waits for a create under way', async () => {
        const s = await setUp();
        s.press(s.create());
        const answer = s.form.beforeClose();
        expect(answer).toBeInstanceOf(Promise);
        await s.write({ written: true });
        expect(await answer).toBe('close');
        expect(s.panel.close).toHaveBeenCalledTimes(1);
    });
});

describe('the place tab of a hub on a task not written yet', () => {
    const asked = (s: Awaited<ReturnType<typeof setUp>>) => s.root.find('tv-form__ask')?.text ?? '';

    it('focuses the place\'s first field as the place\'s pane says, its tab chosen first', async () => {
        const s = await setUp({}, { place: true });
        expect(s.form.focusOf('place')).toEqual({ to: asEl(s.placeInput), selection: 'end' });
        expect(s.form.fieldElement('place')).toBe(asEl(s.placeInput));

        s.form.focusField('place');
        expect(s.revealed).toEqual([{ el: s.placeInput, focused: false }]);
        expect(s.placeInput.ownerDocument.activeElement).toBe(s.placeInput);
    });

    it('has no place field without a place pane', async () => {
        const s = await setUp();
        expect(s.form.focusOf('place')).toBeNull();
        expect(s.form.fieldElement('place')).toBeNull();
    });

    it('chooses the tab of each field it puts the focus on before it puts it there', async () => {
        const s = await setUp({}, { place: true });
        s.form.focusField('name');
        expect(s.revealed.at(-1)).toEqual({ el: s.el('name'), focused: false });

        // The create, on a value that does not read.
        s.el('start').focus();
        s.el('start').type('not a date');
        s.placeInput.focus();
        s.press(s.create());
        expect(s.places.create).not.toHaveBeenCalled();
        expect(s.revealed.at(-1)).toEqual({ el: s.el('start'), focused: false });
        expect(s.el('start').ownerDocument.activeElement).toBe(s.el('start'));

        // The keep of a close's question.
        s.placeInput.focus();
        expect(s.form.beforeClose()).toBe('stay');
        s.press(s.root.find('tv-form__cancel')!);
        expect(s.revealed.at(-1)).toEqual({ el: s.el('start'), focused: false });
        expect(s.el('start').ownerDocument.activeElement).toBe(s.el('start'));
    });

    it('shuts the place\'s fields with its own while a create is under way, and opens them after', async () => {
        const s = await setUp({}, { place: true });
        s.press(s.create());
        expect(s.pane.setEnabled).toHaveBeenLastCalledWith(false);
        await s.write({ written: false, refused: null });
        expect(s.pane.setEnabled).toHaveBeenLastCalledWith(true);
    });

    it('withdraws a close\'s question as the place\'s fields are typed in', async () => {
        const s = await setUp({}, { place: true });
        s.el('name').focus();
        s.el('name').type('電話');
        expect(s.form.beforeClose()).toBe('stay');
        expect(asked(s)).toBe(t('modal.newTask.discardAsk'));

        s.placeInput.focus();
        s.placeInput.type('n');
        expect(asked(s)).toBe('');
    });
});

describe('the line above the create of a hub on a task not written yet', () => {
    type S = Awaited<ReturnType<typeof setUp>>;
    const line = (s: S) => s.foot.find('task-hub__create-line')!;
    const said = (s: S) => line(s).find('task-hub__create-says')!.children.map(c => [[...c.classes].join(' '), c.text]);
    const toggle = (s: S) => s.foot.find('task-hub__create-toggle')!;
    const shown = (s: S) => !(line(s) as unknown as { hidden?: boolean }).hidden;

    it('says where the task goes in the foot, above the row of buttons, and nothing of it in the body', async () => {
        const s = await setUp();
        expect(said(s)).toEqual([['tv-form__info', t('modal.newTask.toChild', { parent: '親' })]]);
        expect(shown(s)).toBe(true);
        const row = s.foot.find('tv-form__buttons')!;
        expect(s.foot.children.indexOf(line(s))).toBeLessThan(s.foot.children.indexOf(row));
        expect(s.body.find('tv-form__says--form')!.children).toEqual([]);
    });

    it('has its button first in the row, before cancel, shown open with a chevron down', async () => {
        const s = await setUp();
        const row = s.foot.find('tv-form__buttons')!;
        expect(row.children[0]).toBe(toggle(s));
        expect(toggle(s).attrs.get('data-icon')).toBe('chevron-down');
        expect(toggle(s).attrs.get('aria-expanded')).toBe('true');
        expect(toggle(s).attrs.get('aria-label')).toBe(t('modal.newTask.hideLine'));
    });

    it('is hidden whole by its button, which then reads as what it would show, and shown again by it', async () => {
        const s = await setUp();
        s.press(toggle(s));
        expect(shown(s)).toBe(false);
        expect(toggle(s).attrs.get('data-icon')).toBe('chevron-up');
        expect(toggle(s).attrs.get('aria-expanded')).toBe('false');
        expect(toggle(s).attrs.get('aria-label')).toBe(t('modal.newTask.showLine'));

        s.press(toggle(s));
        expect(shown(s)).toBe(true);
        expect(toggle(s).attrs.get('data-icon')).toBe('chevron-down');
    });

    it('hides an error too, its button marked in the error\'s tone while hidden only', async () => {
        const s = await setUp({}, { facts: GONE });
        expect(said(s)).toEqual([['tv-form__error', t('modal.newTask.gone')]]);
        expect(toggle(s).attrs.get('data-icon')).toBe('chevron-down');
        expect(toggle(s).classes.has('is-error')).toBe(false);

        s.press(toggle(s));
        expect(shown(s)).toBe(false);
        expect(toggle(s).attrs.get('data-icon')).toBe('alert-triangle');
        expect(toggle(s).classes.has('is-error')).toBe(true);
        expect(toggle(s).attrs.get('aria-label')).toBe(t('modal.newTask.showLineError'));
    });

    it('hides a warning too, its button marked in the warning\'s tone while hidden', async () => {
        const s = await setUp({}, { facts: IGNORED });
        expect(said(s).map(([cls]) => cls)).toEqual(['tv-form__info', 'tv-form__warning']);

        s.press(toggle(s));
        expect(shown(s)).toBe(false);
        expect(toggle(s).attrs.get('data-icon')).toBe('alert-triangle');
        expect(toggle(s).classes.has('is-warning')).toBe(true);
        expect(toggle(s).classes.has('is-error')).toBe(false);
        expect(toggle(s).attrs.get('aria-label')).toBe(t('modal.newTask.showLineWarning'));
    });

    it('stays hidden when the place says the same again, and shows again when what it says changes', async () => {
        const s = await setUp();
        s.press(toggle(s));
        s.form.sayPlace([{ at: 'form', tone: 'info', text: t('modal.newTask.toChild', { parent: '親' }) }]);
        expect(shown(s)).toBe(false);

        s.form.sayPlace([{ at: 'form', tone: 'error', text: t('modal.newTask.gone') }]);
        expect(shown(s)).toBe(true);
        expect(toggle(s).attrs.get('data-icon')).toBe('chevron-down');
    });

    it('says why a create was refused, shown again when it was hidden, and the place is asked again', async () => {
        const s = await setUp();
        s.press(s.create());
        s.press(toggle(s));
        await s.write({ written: false, refused: null });

        expect(shown(s)).toBe(true);
        expect(said(s)).toEqual([
            ['tv-form__info', t('modal.newTask.toChild', { parent: '親' })],
            ['tv-form__error', refusalText(null)],
        ]);
        expect(s.body.find('tv-form__says--form')!.children).toEqual([]);
        expect(s.places.facts).toHaveBeenCalledTimes(2);
    });

    it('leaves the notice that the fields are shut while creating at the form\'s end', async () => {
        const s = await setUp();
        s.press(s.create());
        expect(s.body.find('tv-form__says--form')!.children.map(c => c.text)).toEqual([t('modal.newTask.formShut')]);
        expect(said(s).map(([, text]) => text)).not.toContain(t('modal.newTask.formShut'));
    });

    it('has its button stand aside while a close asks, and the line stays as it is', async () => {
        const s = await setUp();
        s.el('name').focus();
        s.el('name').type('電話');
        expect(s.form.beforeClose()).toBe('stay');
        expect(toggle(s).style.display).toBe('none');
        expect(shown(s)).toBe(true);

        s.press(s.root.find('tv-form__cancel')!);
        expect(toggle(s).style.display).toBe('');
    });

    it('opens shown each time the hub opens', async () => {
        const first = await setUp();
        first.press(toggle(first));
        expect(shown(first)).toBe(false);

        const again = await setUp();
        expect(shown(again)).toBe(true);
        expect(toggle(again).attrs.get('data-icon')).toBe('chevron-down');
    });
});

describe('the hub on a row', () => {
    it('has no line above its row of buttons, nor a button to show one', () => {
        const doc = new FocusDoc();
        Object.assign(doc, { createElement: () => ({ getContext: () => null }) });
        const root = doc.root();
        const body = root.createDiv();
        const foot = root.createDiv();
        const host: HubHost = {
            task: () => SIBLING,
            put: async () => true,
            shut: () => null,
            openSource: null,
            draft: null,
            closing: () => 'close',
            bind: () => { },
        };
        const app = { keymap: { pushScope: () => { }, popScope: () => { } } } as never;
        const plugin = { settings: DEFAULT_SETTINGS, menuPresenter: { present: () => { } } } as never;
        const index = { getTasks: () => [], getTask: () => undefined, onChange: () => () => { } } as never;
        const form = new TaskHubForm(asEl(body), host, { app, plugin, index, foot: asEl(foot) });

        expect(foot.find('task-hub__create-line')).toBeNull();
        expect(foot.find('task-hub__create-toggle')).toBeNull();
        form.sayWrite('refused');
        expect(body.find('tv-form__says--form')!.children.map(c => c.text)).toEqual(['refused']);
    });
});
