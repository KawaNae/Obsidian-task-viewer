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
import { valuesOf } from '../helpers/properties';
import { FocusDoc, FocusEl, asEl } from '../helpers/focusDom';

/**
 * The hub's form on a task not written yet (`DraftHost`), in a stand-in DOM
 * (`focusDom`). Each field hands its change on to the draft and the card is
 * drawn again, and nothing is written; the create writes once, the fields
 * put in first; a close asks whether to throw away a task that was given
 * anything, and once only.
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

const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

interface MenuItem { pick: () => void }

/** A form on a draft at a place that has answered, its writes held until the test answers them. */
async function setUp(seed: DraftSeed = {}, opts: { hold?: boolean; facts?: PlaceFacts } = {}) {
    const doc = new FocusDoc();
    Object.assign(doc, { createElement: () => ({ getContext: () => null }) });
    const root = doc.root();
    const rows: NewRow[] = [];
    let answer = () => { };
    const writes: ((answer: WriteAnswer) => void)[] = [];
    const places = {
        noteOf: () => 'n.md',
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
    const form: TaskHubForm = new TaskHubForm(asEl(root), host, { app, plugin, index, foot: asEl(root), requestClose: () => { closes.push(form.beforeClose()); } });
    const panel = { redrawPreview: vi.fn(), close: vi.fn() };
    host.attach(panel);
    await settle();
    const el = (field: Parameters<TaskHubForm['fieldElement']>[0]) => form.fieldElement(field) as unknown as FocusEl;
    const create = () => root.findAll('mod-cta')[0];
    return {
        root, host, form, panel, places, rows, closes, menus, el, create,
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
