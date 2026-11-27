import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { VaultSession } from '../helpers/vaultSession';
import { openMoveHub, stubMoveHubGlobals, settle, tick } from '../helpers/moveHub';
import { TaskHubForm } from '../../../src/modals/hub/TaskHubForm';
import { DraftHost } from '../../../src/modals/hub/DraftHost';
import type { CreatePlace, PlaceFacts } from '../../../src/services/data/CreatePlaces';
import type { WriteAnswer } from '../../../src/services/operations/WriteAnswer';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SETTINGS } from '../../../src/types/Settings';
import type { Properties, PropertyScalar } from '../../../src/types';
import { t } from '../../../src/i18n';
import { byKey, valuesOf } from '../helpers/properties';
import { menuSpy } from '../helpers/menuSpy';
import { FocusDoc, type FocusEl, asEl } from '../helpers/focusDom';

/**
 * A custom property's row once its value field is committed with the focus
 * kept in it (Enter), and then left for another field: what the row shows
 * (its frame, the mark by its key, the faint text of no value) and what its
 * menu offers are those of the row as it is now, not as it was drawn, and
 * the field committed keeps the focus. On a row the hub edits, on one it
 * moves, and on a task to make.
 */

const lives: VaultSession[] = [];
beforeAll(stubMoveHubGlobals);
afterAll(() => vi.unstubAllGlobals());
afterEach(() => { while (lives.length) lives.pop()!.dispose(); vi.restoreAllMocks(); });

/** What a test does to a hub, whichever host it is on. */
interface PropHub {
    root: FocusEl;
    /** The name field: somewhere to take the focus to. */
    name(): FocusEl;
    /** The task's own properties, as the host holds them now. */
    properties(): Properties | undefined;
    /** Let the write and its echo be answered. */
    settle(): Promise<void>;
    menus: ReturnType<typeof menuSpy>;
}

/** The note's lines for a row with nothing of its own, under a heading that gives `inherited`. */
const noteOf = (inherited: string[]) => ['# Tasks', ...inherited, '- [ ] Row', '# Done', ''];

async function rowHub(inherited: string[], moving: boolean): Promise<PropHub> {
    const h = await openMoveHub(s => { lives.push(s); }, noteOf(inherited));
    if (moving) await h.begin();
    return asHub(h);
}

function asHub(h: Awaited<ReturnType<typeof openMoveHub>>): PropHub {
    return { root: h.root, name: () => h.field('name'), properties: () => h.host.task().properties, settle: async () => { await settle(); await tick(60); }, menus: h.menus };
}

async function draftHub(inherited: string[]): Promise<PropHub> {
    const parent = FileParsePipeline.parse('n.md', ['# h', ...inherited, '- [ ] 親'], DEFAULT_SETTINGS, namesOutsideIndex('n.md')).tasks[0];
    const place: CreatePlace = { kind: 'childOf', taskId: 'parent' };
    const facts: PlaceFacts = { kind: 'childOf', parent: '親', path: 'n.md', under: 'h', inherits: parent.cascadeContext ?? {}, inheritedFrom: parent.inheritedFrom };
    const doc = new FocusDoc();
    Object.assign(doc, { createElement: () => ({ getContext: () => null }) });
    const root = doc.root();
    const body = root.createDiv({ cls: 'tv-overlay__body' });
    const foot = root.createDiv({ cls: 'tv-overlay__foot' });
    const places = {
        noteOf: () => 'n.md',
        fromDestination: () => { throw new Error('the place fields give no answer here'); },
        facts: vi.fn(() => Promise.resolve(facts)),
        create: vi.fn(() => new Promise<WriteAnswer>(() => { })),
    };
    const menus = menuSpy();
    const host = new DraftHost(place, {}, { places, scopeKeys: () => DEFAULT_SETTINGS.scopeKeys });
    const form: TaskHubForm = new TaskHubForm(asEl(body), host, {
        app: { keymap: { pushScope: () => { }, popScope: () => { } } } as never,
        plugin: { settings: DEFAULT_SETTINGS, menuPresenter: menus.presenter } as never,
        index: { getTasks: () => [], getTask: () => undefined, onChange: () => () => { } } as never,
        foot: asEl(foot),
        requestClose: () => { void form.beforeClose(); },
        hasFocus: () => doc.activeElement !== root && root.contains(doc.activeElement),
    });
    host.attach({ redrawPreview: vi.fn(), close: vi.fn() });
    const microtasks = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
    await microtasks();
    return {
        root,
        name: () => form.fieldElement('name') as unknown as FocusEl,
        properties: () => host.task().properties,
        settle: microtasks,
        menus,
    };
}

const HOSTS: [string, (inherited: string[]) => Promise<PropHub>][] = [
    ['a row the hub edits', (inherited) => rowHub(inherited, false)],
    ['a row the hub moves', (inherited) => rowHub(inherited, true)],
    ['a task to make', draftHub],
];

const rowOf = (h: PropHub, key: string) => h.root.findAll('tv-form__row').find(row => row.find('task-hub__prop-key')?.text === key);
const valueOf = (h: PropHub, key: string) => rowOf(h, key)!.find('task-hub__value')!;
const focused = (h: PropHub) => h.root.ownerDocument.activeElement;
/** The titles of the menu the row's … shows now. */
const menuOf = (h: PropHub, key: string) => {
    rowOf(h, key)!.find('tv-form__menu-button')!.dispatchEvent(new Event('click'));
    return h.menus.last()!.items.map(item => item.title);
};
const pick = (h: PropHub, key: string, title: string) => {
    rowOf(h, key)!.find('tv-form__menu-button')!.dispatchEvent(new Event('click'));
    h.menus.last()!.items.find(item => item.title === title)!.click!();
};
/** Whether the box of the row's value field is drawn dashed, as what it is given. */
const dashed = (h: PropHub, key: string) => valueOf(h, key).parent!.classes.has('tv-form__control--inherited');
/** The value the row's own no value hides, as the box draws it struck through; null for none. */
const struckOf = (h: PropHub, key: string) => valueOf(h, key).parent!.find('tv-form__struck-text')?.text ?? null;

/** Add the property `k` with the value `a` from the add row. */
async function addOwn(h: PropHub) {
    const [keyInput, valueInput] = h.root.find('task-hub__prop-add')!.findAll('tv-ctrl__text-input');
    keyInput.focus();
    keyInput.type('k');
    valueInput.focus();
    valueInput.type('a');
    valueInput.enter();
    await h.settle();
    h.name().focus();
    await h.settle();
}

/** Type `text` in the row's value field, and commit it with Enter, the focus kept in the field. */
async function typeEnter(h: PropHub, key: string, text: string) {
    const field = valueOf(h, key);
    field.focus();
    field.type(text);
    field.enter();
    await h.settle();
    return field;
}

const text = (s: string) => ({ type: 'text', text: s, spelling: s });
const item = (s: string): PropertyScalar => ({ type: 'text', text: s, spelling: s });

describe.each(HOSTS)('a property\'s row once its value is committed with Enter, on %s', (_name, open) => {
    it('emptied: shows no value at once, the field kept with the focus, and its menu offers no conversion', async () => {
        const h = await open([]);
        await addOwn(h);
        const field = await typeEnter(h, 'k', '');
        expect(valuesOf(h.properties())).toEqual({ k: { type: 'null', spelling: '' } });
        expect(valueOf(h, 'k')).toBe(field);
        expect(focused(h)).toBe(field);
        expect(field.placeholder).toBe(t('modal.hub.noValue'));
        h.name().focus();
        await h.settle();
        expect(menuOf(h, 'k')).toEqual([t('modal.hub.deleteKey')]);
    });

    it('a no value spelled (`null`, `~`) typed: written as typed, over the row\'s own value, over an inherited one and hiding it, and over nothing', async () => {
        const own = await open([]);
        await addOwn(own);
        await typeEnter(own, 'k', 'null');
        expect(valuesOf(own.properties())).toEqual({ k: { type: 'null', spelling: 'null' } });
        const over = await open(['- k:: s']);
        await typeEnter(over, 'k', 'o');
        await typeEnter(over, 'k', 'null');
        expect(valuesOf(over.properties())).toEqual({ k: { type: 'null', spelling: 'null' } });
        expect(struckOf(over, 'k')).toBe('s');
        const given = await open(['- k:: s']);
        await typeEnter(given, 'k', '~');
        expect(valuesOf(given.properties())).toEqual({ k: { type: 'null', spelling: '~' } });
    });

    it('typed over: the menu, opened once the field is left, converts the value typed', async () => {
        const h = await open([]);
        await addOwn(h);
        await typeEnter(h, 'k', 'b');
        h.name().focus();
        await h.settle();
        pick(h, 'k', t('modal.hub.toList'));
        await h.settle();
        expect(valuesOf(h.properties())).toEqual({ k: { type: 'list', items: [text('b')] } });
    });

    it('emptied, then left: the menu converts nothing and writes no earlier value', async () => {
        const h = await open([]);
        await addOwn(h);
        await typeEnter(h, 'k', '');
        h.name().focus();
        await h.settle();
        expect(menuOf(h, 'k')).not.toContain(t('modal.hub.toList'));
        expect(valuesOf(h.properties())).toEqual({ k: { type: 'null', spelling: '' } });
    });

    it('an inherited value typed over: drawn as the row\'s own at once, and its menu follows the inherited value again', async () => {
        const h = await open(['- k:: s']);
        expect([valueOf(h, 'k').value, valueOf(h, 'k').placeholder, dashed(h, 'k')]).toEqual(['', 's', true]);
        const field = await typeEnter(h, 'k', 'o');
        expect(valuesOf(h.properties())).toEqual({ k: text('o') });
        expect(focused(h)).toBe(field);
        expect([field.value, field.placeholder, dashed(h, 'k')]).toEqual(['o', 's', false]);
        h.name().focus();
        await h.settle();
        expect(menuOf(h, 'k')).toContain(t('modal.hub.clearToInherited'));
        pick(h, 'k', t('modal.hub.clearToInherited'));
        await h.settle();
        expect(valuesOf(h.properties())).toEqual({});
        expect([valueOf(h, 'k').value, valueOf(h, 'k').placeholder, dashed(h, 'k')]).toEqual(['', 's', true]);
    });

    it('an inherited value emptied: nothing is written, the field kept with the focus, the inherited value its faint text', async () => {
        const h = await open(['- k:: s']);
        const field = await typeEnter(h, 'k', '');
        expect(valuesOf(h.properties())).toEqual({});
        expect(focused(h)).toBe(field);
        expect([field.value, field.placeholder, dashed(h, 'k')]).toEqual(['', 's', true]);
    });

    it('an own value over an inherited one emptied: the own line is taken out at once, the inherited value shown in a dashed box', async () => {
        const h = await open(['- k:: s']);
        await typeEnter(h, 'k', 'o');
        const field = await typeEnter(h, 'k', '');
        expect(valuesOf(h.properties())).toEqual({});
        expect(focused(h)).toBe(field);
        expect([field.value, field.placeholder, dashed(h, 'k')]).toEqual(['', 's', true]);
    });

    it('an inherited value set to no value from the menu: drawn hiding it at once, struck through', async () => {
        const h = await open(['- k:: s']);
        pick(h, 'k', t('modal.hub.setNoValue'));
        await h.settle();
        expect(valuesOf(h.properties())).toEqual({ k: { type: 'null', spelling: '' } });
        expect([valueOf(h, 'k').placeholder, struckOf(h, 'k'), dashed(h, 'k')]).toEqual(['s', 's', false]);
    });

    it('an inherited value written to the task from the menu: the row\'s own, spelled as it was', async () => {
        const h = await open(['- k:: s']);
        pick(h, 'k', t('modal.hub.writeInherited'));
        await h.settle();
        expect(valuesOf(h.properties())).toEqual({ k: text('s') });
        expect([valueOf(h, 'k').value, dashed(h, 'k')]).toEqual(['s', false]);
    });
});

describe('a row the plugin writes elsewhere while the focus is in the hub\'s rows', () => {
    const note = ['# Tasks', '- [ ] Row', '    - k:: a', '    - m:: x', '# Done', ''];
    const written = ['# Tasks', '- [ ] Row', '    - k::', '        - p', '        - q', '    - m:: y', '# Done', ''];

    it.each(['touched and left', 'the hub closed'])('keeps the list written elsewhere over the text field its row was built as: %s', async (then) => {
        const h = await openMoveHub(s => { lives.push(s); }, note);
        const hub = asHub(h);
        await typeEnter(hub, 'm', 'y');
        // Another view writes the row, as the hub's own writes go: the hub follows it.
        await h.session.ops.updateTask(h.host.task().id, { properties: byKey({ k: { type: 'list', items: [item('p'), item('q')] }, m: item('y') }) });
        await hub.settle();
        expect([h.lines(), h.host.shut()]).toEqual([written, null]);
        if (then === 'the hub closed') h.form.beforeClose();
        else {
            valueOf(hub, 'k').focus();
            hub.name().focus();
        }
        await hub.settle();
        expect(h.lines()).toEqual(written);
    });
});
