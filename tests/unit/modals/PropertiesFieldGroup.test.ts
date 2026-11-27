import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PropertiesFieldGroup } from '../../../src/modals/hub/fields/PropertiesFieldGroup';
import type { FieldGroupContext } from '../../../src/modals/hub/fields/FieldGroupContext';
import type { Properties, PropertyScalar, Task } from '../../../src/types';
import type { FormIssue } from '../../../src/modals/form/FormIssue';
import type { HubField } from '../../../src/modals/hub/fields/FieldGroupContext';
import type { HubFinding } from '../../../src/modals/hub/HubFindings';
import { DEFAULT_SETTINGS } from '../../../src/types/Settings';
import { makeTask } from '../helpers/makeTask';
import { byKey, valuesOf } from '../helpers/properties';
import { FocusDoc, FocusEl, asEl } from '../helpers/focusDom';
import { menuSpy } from '../helpers/menuSpy';
import { holdPresses } from '../../../src/views/sharedUI/PressCommit';

/**
 * The hub's custom properties built anew while one of their inputs holds the
 * focus: a write builds the rows anew, and taking out the focused input
 * sends it a blur at once, as Chromium does (`focusDom`). A listener of the
 * rows taken out does not run then: what was typed is written once, and the
 * rows are built once.
 */

// `PropertyListField` tells where the focus went by `relatedTarget instanceof Element`.
beforeAll(() => { vi.stubGlobal('Element', FocusEl); });
afterAll(() => { vi.unstubAllGlobals(); });

const text = (s: string): PropertyScalar => ({ type: 'text', text: s, spelling: s });

interface SetUpOptions {
    refuse?: boolean;
    /** What the layers above give the task. */
    inherited?: Properties;
    /** The task's findings, each locking its field. */
    findings?: HubFinding[];
    /** The hub's fields shut (`ctx.isShut`). */
    shut?: boolean;
    /** The hub has no line of the note to open (`ctx.openSource` null). */
    noSource?: boolean;
}

/** A hub's properties on a task, its writes taken (or refused) as the hub's host answers them. */
function setUp(properties: Properties = {}, opts: SetUpOptions = {}) {
    const doc = new FocusDoc();
    let task: Task = makeTask({ properties, ...(opts.inherited ? { cascadeContext: { properties: opts.inherited } as Task['cascadeContext'] } : {}) });
    const writes: Properties[] = [];
    const said = new Map<string, readonly FormIssue<HubField>[]>();
    const findings = opts.findings ?? [];
    const menus = menuSpy();
    const opened: unknown[] = [];
    const ctx = {
        task: () => task,
        isShut: () => opts.shut ?? false,
        put: (updates: Partial<Task> | null) => {
            if (updates?.properties) {
                writes.push(updates.properties);
                if (!opts.refuse) task = { ...task, properties: updates.properties };
            }
            return Promise.resolve(!opts.refuse);
        },
        app: { keymap: { pushScope: () => { }, popScope: () => { } } },
        plugin: { settings: DEFAULT_SETTINGS, menuPresenter: menus.presenter },
        index: { getTasks: () => [] },
        openSource: opts.noSource ? null : (locate: unknown) => { opened.push(locate); },
        findings: () => findings,
        locked: (field: string) => findings.some(f => f.field === field),
        issues: { set: (source: string, issues: readonly FormIssue<HubField>[]) => { said.set(source, issues); }, redraw: () => { } },
    } as unknown as FieldGroupContext;
    // The hub's panel, which holds the presses on its buttons.
    const root = doc.root();
    holdPresses(asEl(root));
    const group = new PropertiesFieldGroup(asEl(root), ctx);
    const addRow = () => root.find('task-hub__prop-add')!;
    const away = doc.body.createDiv();
    /** The row labelled `key`. */
    const rowOf = (key: string) => root.findAll('tv-form__row').find(row => row.find('tv-form__label')?.children.some(c => c.text === key));
    return {
        doc,
        root,
        group,
        writes,
        menus,
        opened,
        rowOf,
        task: () => task,
        addKey: () => addRow().find('tv-form__label')!.children.find(c => c.placeholder !== '')!,
        addValue: () => addRow().find('tv-form__control')!,
        listAdd: () => root.find('task-hub__list-add')!,
        /** The value field of the row labelled `key`. */
        valueOf: (key: string) => rowOf(key)!.find('task-hub__value')!,
        /** The items of the menu of the row labelled `key`, as its … shows them. */
        menuOf: (key: string) => {
            rowOf(key)!.find('tv-form__menu-button')!.dispatchEvent(new Event('click'));
            return menus.last()!.items;
        },
        /** Pick the item titled `title` from the menu of the row labelled `key`. */
        pick: (key: string, title: string) => {
            rowOf(key)!.find('tv-form__menu-button')!.dispatchEvent(new Event('click'));
            menus.last()!.items.find(item => item.title === title)!.click!();
        },
        /** What the add row's key says wrong. */
        keySays: () => (said.get('propKey') ?? []).map(issue => issue.text),
        /** Take the focus out of the properties, as a tap elsewhere does. */
        leave: () => away.focus(),
        /** The task's own properties written from outside, and the hub told, as an echo tells it. */
        outside: (next: Properties) => {
            task = { ...task, properties: next };
            group.refresh();
        },
    };
}

describe('PropertiesFieldGroup built anew while an input holds the focus', () => {
    it('adds the property typed in the add row on Enter: written once, the add row emptied, the focus in its key field', () => {
        const s = setUp();
        s.addKey().focus();
        s.addKey().type('memo2');
        expect(() => s.addKey().enter()).not.toThrow();
        expect(s.writes.map(valuesOf)).toEqual([{ memo2: { type: 'null', spelling: '' } }]);
        expect(s.addKey().value).toBe('');
        expect(s.root.findAll('task-hub__prop-add')).toHaveLength(1);
        expect(s.doc.activeElement).toBe(s.addKey());
    });

    it('puts the focus in the add row\'s key field once a property is added by the value field\'s Enter, and leaves it where it went once added by a blur', () => {
        const s = setUp();
        s.addKey().focus();
        s.addKey().type('memo2');
        s.addValue().focus();
        s.addValue().type('v');
        s.addValue().enter();
        expect(s.writes.map(valuesOf)).toEqual([{ memo2: { type: 'text', text: 'v', spelling: 'v' } }]);
        expect(s.doc.activeElement).toBe(s.addKey());
        s.addKey().type('memo3');
        s.leave();
        expect(s.writes).toHaveLength(2);
        expect(s.doc.activeElement).not.toBe(s.addKey());
    });

    it('saves the add row as the hub closes with the focus in it: written once, and the lists saved after it', () => {
        const s = setUp(byKey({ tags2: { type: 'list', items: [text('a')] } }));
        s.listAdd().type('b');
        s.addKey().focus();
        s.addKey().type('memo2');
        expect(() => s.group.save()).not.toThrow();
        expect(s.writes.map(valuesOf)).toEqual([
            { tags2: { type: 'list', items: [text('a')] }, memo2: { type: 'null', spelling: '' } },
            { tags2: { type: 'list', items: [text('a'), text('b')] }, memo2: { type: 'null', spelling: '' } },
        ]);
    });

    it('puts what was typed back in the add row when the write saving it as the hub closes is refused', async () => {
        const s = setUp({}, { refuse: true });
        s.addKey().focus();
        s.addKey().type('memo2');
        s.addValue().type('x');
        expect(() => s.group.save()).not.toThrow();
        expect(s.writes).toHaveLength(1);
        await Promise.resolve();
        await Promise.resolve();
        expect([s.addKey().value, s.addValue().value]).toEqual(['memo2', 'x']);
    });

    it('adds an item typed in a list on Enter: written once, the focus kept in the list\'s add field', () => {
        const s = setUp(byKey({ tags2: { type: 'list', items: [text('a')] } }));
        s.listAdd().focus();
        s.listAdd().type('b');
        expect(() => s.listAdd().enter()).not.toThrow();
        expect(s.writes.map(valuesOf)).toEqual([{ tags2: { type: 'list', items: [text('a'), text('b')] } }]);
        expect(s.doc.activeElement).toBe(s.listAdd());
        expect(s.listAdd().value).toBe('');
    });
});

describe('the add row takes only a key no row stands for', () => {
    const area = byKey({ Area: text('lab') });

    it('refuses a key with a value of its own, its case aside, on Enter and on a blur: nothing written, said under the key as the row names it', () => {
        const s = setUp(area);
        s.addKey().focus();
        s.addKey().type('AREA');
        s.addValue().type('x');
        expect(s.keySays()).toEqual(['The key Area already exists, so it cannot be added.']);
        s.addKey().enter();
        s.leave();
        expect(s.writes).toEqual([]);
        expect([s.addKey().value, s.addValue().value]).toEqual(['AREA', 'x']);
        expect(s.keySays()).toEqual(['The key Area already exists, so it cannot be added.']);
    });

    it('refuses a key as the hub closes: saved nothing, and listed as what cannot be saved', () => {
        const s = setUp(area);
        s.addKey().focus();
        s.addKey().type('area');
        s.group.save();
        expect(s.writes).toEqual([]);
        expect(s.group.unsaved().map(field => field.input)).toEqual([s.addKey()]);
        s.group.discardUnsaved();
        expect([s.addKey().value, s.group.unsaved()]).toEqual(['', []]);
    });

    it('refuses a key that is inherited, one with no value, and one a finding locks', () => {
        const findings: HubFinding[] = [{ kind: 'duplicate-key', field: 'prop:dup', tone: 'error', text: 'twice', key: 'dup', line: 1 }];
        const s = setUp(byKey({ none: { type: 'null', spelling: '' } }), { inherited: byKey({ Place: text('home') }), findings });
        for (const [typed, row] of [['place', 'Place'], ['NONE', 'none'], ['Dup', 'dup']]) {
            s.addKey().focus();
            s.addKey().type(typed);
            s.addKey().enter();
            expect(s.keySays(), typed).toEqual([`The key ${row} already exists, so it cannot be added.`]);
        }
        expect(s.writes).toEqual([]);
    });

    it('refuses a key starting as a list item, a # or a code fence does, and a reserved key naming the field that edits it', () => {
        const s = setUp();
        for (const [typed, says] of [
            ['- x', 'A key cannot start with a list or quote marker, #, or a code fence (~~~).'],
            ['1. x', 'A key cannot start with a list or quote marker, #, or a code fence (~~~).'],
            ['#x', 'A key cannot start with a list or quote marker, #, or a code fence (~~~).'],
            ['~~~x', 'A key cannot start with a list or quote marker, #, or a code fence (~~~).'],
            ['TV-COLOR', 'Enter TV-COLOR in the Color field.'],
            ['tags', 'Enter tags in the Tags field.'],
            ['position', 'This key is reserved.'],
        ]) {
            s.addKey().focus();
            s.addKey().type(typed);
            s.leave();
            expect(s.keySays(), typed).toEqual([says]);
        }
        expect(s.writes).toEqual([]);
    });

    it('adds a key no row stands for, its value with the space around it taken off', () => {
        const s = setUp(area);
        s.addKey().focus();
        s.addKey().type('place');
        s.addValue().type('  home  ');
        s.addKey().enter();
        expect(s.writes.map(valuesOf)).toEqual([{ Area: text('lab'), place: text('home') }]);
        expect(s.keySays()).toEqual([]);
    });
});

describe('a property\'s value field reads what is typed with the space around it taken off', () => {
    it('writes the value trimmed, and nothing when it reads as the value shown', () => {
        const s = setUp(byKey({ Area: text('lab') }));
        s.valueOf('Area').focus();
        s.valueOf('Area').type(' lab  ');
        s.leave();
        expect(s.writes).toEqual([]);
        s.valueOf('Area').focus();
        s.valueOf('Area').type('  home ');
        s.leave();
        expect(s.writes.map(valuesOf)).toEqual([{ Area: text('home') }]);
        expect(s.valueOf('Area').value).toBe('home');
    });
});

describe('a property\'s value emptied writes what its row\'s state says', () => {
    const NONE = { type: 'null', spelling: '' } as const;
    /** The × of the first item of a list that is the row's own. */
    const firstItemX = (s: ReturnType<typeof setUp>) => s.root.findAll('task-hub__list-item').find(item => !item.classes.has('task-hub__list-item--add'))!.find('tv-form__clear-button')!;
    /** Whether the box of the value field of the row `key` is drawn dashed, as what it is given. */
    const dashed = (s: ReturnType<typeof setUp>, key: string) => s.valueOf(key).parent!.classes.has('tv-form__control--inherited');

    it('writes no value for an own value emptied with nothing inherited, the row standing with no value', () => {
        const s = setUp(byKey({ Area: text('lab') }));
        s.valueOf('Area').focus();
        s.valueOf('Area').type('  ');
        s.leave();
        expect(s.writes.map(valuesOf)).toEqual([{ Area: NONE }]);
        expect(s.valueOf('Area').value).toBe('');
    });

    it('writes no value for the last item of an own list taken out with nothing inherited, the row standing', () => {
        const s = setUp(byKey({ tags2: { type: 'list', items: [text('a')] } }));
        firstItemX(s).dispatchEvent(new Event('click'));
        expect(s.writes.map(valuesOf)).toEqual([{ tags2: NONE }]);
        expect(s.valueOf('tags2').value).toBe('');
    });

    it('takes an item in focus out by its ×, typed over or not, written once and the focus put in no field', () => {
        for (const typed of [null, 'A']) {
            const s = setUp(byKey({ tags2: { type: 'list', items: [text('a'), text('b')] } }));
            const item = s.rowOf('tags2')!.findAll('task-hub__list-item').find(one => !one.classes.has('task-hub__list-item--add'))!;
            const field = item.find('tv-ctrl__text-input')!;
            field.focus();
            if (typed !== null) field.type(typed);
            item.find('tv-form__clear-button')!.press();
            expect(s.writes.map(valuesOf), String(typed)).toEqual([{ tags2: { type: 'list', items: [text('b')] } }]);
            expect(s.doc.activeElement, String(typed)).toBe(s.doc.body);
        }
    });

    it('takes the own line out for an own value over an inherited value emptied: the field is empty, the inherited value its faint text in a dashed box', () => {
        const s = setUp(byKey({ Place: text('mine') }), { inherited: byKey({ Place: text('home') }) });
        expect([s.valueOf('Place').value, s.valueOf('Place').placeholder, dashed(s, 'Place')]).toEqual(['mine', 'home', false]);
        s.valueOf('Place').focus();
        s.valueOf('Place').type('');
        s.leave();
        expect(s.writes.map(valuesOf)).toEqual([{}]);
        expect([s.valueOf('Place').value, s.valueOf('Place').placeholder, dashed(s, 'Place')]).toEqual(['', 'home', true]);
    });

    it('takes the own line out for an own value emptied where the layer above gives no value, the field then saying no value in a dashed box', () => {
        const s = setUp(byKey({ Place: text('mine') }), { inherited: byKey({ Place: NONE }) });
        s.valueOf('Place').focus();
        s.valueOf('Place').type('');
        s.leave();
        expect(s.writes.map(valuesOf)).toEqual([{}]);
        expect([s.valueOf('Place').value, s.valueOf('Place').placeholder, dashed(s, 'Place')]).toEqual(['', 'No value', true]);
    });

    it('writes nothing for an inherited-only value emptied and committed: it has no value of its own to empty', () => {
        const s = setUp({}, { inherited: byKey({ Place: text('home') }) });
        s.valueOf('Place').focus();
        s.valueOf('Place').type('');
        s.leave();
        s.valueOf('Place').focus();
        s.valueOf('Place').type('   ');
        s.valueOf('Place').enter();
        expect(s.writes).toEqual([]);
        expect([s.valueOf('Place').value, s.valueOf('Place').placeholder, dashed(s, 'Place')]).toEqual(['', 'home', true]);
    });

    it('writes the value typed into an inherited-only field as the row\'s own, though it is the inherited one', () => {
        const s = setUp({}, { inherited: byKey({ Place: text('home') }) });
        s.valueOf('Place').focus();
        s.valueOf('Place').type('home');
        s.leave();
        expect(s.writes.map(valuesOf)).toEqual([{ Place: text('home') }]);
        expect([s.valueOf('Place').value, dashed(s, 'Place')]).toEqual(['home', false]);
    });

    it('takes the own line out for the last item of an own list over an inherited list taken out, the inherited list then shown as chips', () => {
        const s = setUp(byKey({ tags2: { type: 'list', items: [text('b')] } }), { inherited: byKey({ tags2: { type: 'list', items: [text('a')] } }) });
        firstItemX(s).dispatchEvent(new Event('click'));
        expect(s.writes.map(valuesOf)).toEqual([{}]);
        expect(s.rowOf('tags2')!.findAll('task-hub__list-chip--cascade')).toHaveLength(1);
    });

    it('writes nothing for a field touched and left as it was: an own value, an inherited one, no value', () => {
        const s = setUp(byKey({ Area: text('lab'), none: NONE }), { inherited: byKey({ Place: text('home') }) });
        for (const key of ['Area', 'Place', 'none']) {
            s.valueOf(key).focus();
            s.leave();
        }
        expect(s.writes).toEqual([]);
    });
});

describe('a property\'s row: the key, the field, and the menu button over the field\'s end', () => {
    const NONE = { type: 'null', spelling: '' } as const;
    const list = (...items: string[]) => ({ type: 'list', items: items.map(text) }) as const;
    const buttonOf = (s: ReturnType<typeof setUp>, key: string) => s.rowOf(key)!.find('tv-form__menu-button');
    const shown = (el: FocusEl | null) => el !== null && el.style.display !== 'none';
    const dashed = (s: ReturnType<typeof setUp>, key: string) => s.valueOf(key).parent!.classes.has('tv-form__control--inherited');
    const struckOf = (s: ReturnType<typeof setUp>, key: string) => s.valueOf(key).parent!.find('tv-form__struck-text')?.text ?? null;

    it('draws no × in a text value\'s field, nor a column at the row\'s end, nor a mark beside the key', () => {
        const s = setUp(byKey({ Area: text('lab') }), { inherited: byKey({ Place: text('home') }) });
        for (const key of ['Area', 'Place']) {
            expect(s.rowOf(key)!.find('tv-form__clear-button'), key).toBeNull();
            expect(s.rowOf(key)!.find('task-hub__prop-more'), key).toBeNull();
            expect(s.rowOf(key)!.find('task-hub__prop-mark'), key).toBeNull();
        }
    });

    it('opens no field of a row a finding locks, an inherited text shown in it: the field takes no input, with no menu button', () => {
        const findings: HubFinding[] = [{ kind: 'duplicate-key', field: 'prop:dup', tone: 'error', text: 'twice', key: 'dup', line: 1 }];
        const s = setUp({}, { inherited: byKey({ dup: text('s') }), findings });
        expect([s.valueOf('dup').value, s.valueOf('dup').placeholder, s.valueOf('dup').disabled]).toEqual(['', 's', true]);
        expect(buttonOf(s, 'dup')).toBeNull();
    });

    it('draws a row written from outside as it is now while the focus is in another, which keeps what is typed; a row added is built once the focus leaves', async () => {
        const s = setUp(byKey({ m: text('1') }), { inherited: byKey({ k: text('s') }) });
        const field = s.valueOf('m');
        field.focus();
        field.type('2');
        s.outside(byKey({ m: text('1'), k: text('o'), n: text('x') }));
        expect(s.valueOf('m')).toBe(field);
        expect([s.doc.activeElement, field.value]).toEqual([field, '2']);
        expect([s.valueOf('k').value, s.valueOf('k').placeholder, dashed(s, 'k')]).toEqual(['o', 's', false]);
        expect(s.rowOf('n')).toBeUndefined();
        s.leave();
        await Promise.resolve();
        expect(s.valueOf('n').value).toBe('x');
        expect(valuesOf(s.writes.at(-1)!)).toEqual({ m: { type: 'number', number: 2, spelling: '2' }, k: text('o'), n: text('x') });
    });

    it('shows an inherited text in a dashed box as the faint text of an empty field, and an own value in a solid one', () => {
        const s = setUp(byKey({ Area: text('lab') }), { inherited: byKey({ Place: text('home') }) });
        expect([s.valueOf('Place').value, s.valueOf('Place').placeholder, dashed(s, 'Place')]).toEqual(['', 'home', true]);
        expect(s.rowOf('Place')!.classes.has('task-hub__row--inherited')).toBe(false);
        expect([s.valueOf('Area').value, s.valueOf('Area').placeholder, dashed(s, 'Area')]).toEqual(['lab', 'No value', false]);
    });

    it('draws a value hidden by the row\'s own no value as a struck span in the box, the placeholder the same value drawn clear; a no value hiding nothing as the faint text', () => {
        const s = setUp(byKey({ Place: NONE, crew: NONE, gone: NONE, empty: NONE }), { inherited: byKey({ Place: text('home'), crew: list('a', 'b'), gone: NONE }) });
        expect([s.valueOf('Place').placeholder, struckOf(s, 'Place'), dashed(s, 'Place')]).toEqual(['home', 'home', false]);
        expect([s.valueOf('crew').placeholder, struckOf(s, 'crew')]).toEqual(['a, b', 'a, b']);
        expect([s.valueOf('gone').placeholder, struckOf(s, 'gone'), dashed(s, 'gone')]).toEqual(['No value', null, false]);
        expect([s.valueOf('empty').placeholder, struckOf(s, 'empty')]).toEqual(['No value', null]);
    });

    it('draws the menu button over the end of the value field\'s box, and in the add field\'s box of an own list or at the end of the chips of an inherited one; none on a locked row', () => {
        const findings: HubFinding[] = [{ kind: 'duplicate-key', field: 'prop:dup', tone: 'error', text: 'twice', key: 'dup', line: 1 }];
        const s = setUp(byKey({ Area: text('lab'), tags2: list('a', 'b') }), { inherited: byKey({ crew: list('x') }), findings });
        for (const key of ['Area', 'tags2', 'crew']) {
            const button = buttonOf(s, key)!;
            expect(button.attrs.get('aria-label'), key).toBe(`Menu of ${key}`);
            expect(button.disabled, key).toBe(false);
            expect(shown(button), key).toBe(true);
        }
        expect(buttonOf(s, 'Area')!.parent!.classes.has('task-hub__value-box')).toBe(true);
        expect(buttonOf(s, 'tags2')!.parent!.classes.has('task-hub__list-item-box')).toBe(true);
        expect(buttonOf(s, 'tags2')!.parent!.find('task-hub__list-add')).not.toBeNull();
        expect(buttonOf(s, 'crew')!.classes.has('tv-form__menu-button--inline')).toBe(true);
        expect(buttonOf(s, 'Area')!.classes.has('tv-form__menu-button--inline')).toBe(false);
        expect(buttonOf(s, 'dup')).toBeNull();
        expect(s.rowOf('tags2')!.findAll('tv-form__clear-button').map(x => x.attrs.get('aria-label'))).toEqual(['Remove item a', 'Remove item b']);
        // The inherited list is shown as chips, with no ×.
        expect(s.rowOf('crew')!.findAll('task-hub__list-chip--cascade')).toHaveLength(1);
        expect(s.rowOf('crew')!.find('tv-form__clear-button')).toBeNull();
    });

    it('draws no menu button while the hub shuts the fields, and no ×', () => {
        const s = setUp(byKey({ Area: text('lab'), tags2: list('a') }), { shut: true });
        expect(s.root.findAll('tv-form__menu-button')).toEqual([]);
        expect(s.root.findAll('tv-form__clear-button')).toEqual([]);
        expect(s.menus.shown).toEqual([]);
    });

    it('shows the menu under its button: the attributes greyed, a separator, then the items titled and greyed as the row\'s menu says', () => {
        const s = setUp({}, { inherited: byKey({ crew: list('x') }), noSource: true });
        const items = s.menuOf('crew');
        expect(items.map(item => [item.title, item.icon, item.disabled])).toEqual([
            ['Type: list', 'list', true],
            ['Inherited from section', 'heading', true],
            ['Open inherited line', 'external-link', true],
            ['Write inherited value to this task', 'copy', false],
            ['Set to no value', 'ban', false],
        ]);
        expect(s.menus.last()!.separatorsAt).toEqual([2]);
        expect(items.slice(0, 3).map(item => item.click)).toEqual([null, null, null]);
        expect(s.menus.last()!.anchor).toMatchObject({ kind: 'belowRect' });
    });

    it('says each type of the value a row shows with its icon, and puts no separator in a menu with no attribute', () => {
        const s = setUp(byKey({ n: { type: 'number', number: 12, spelling: '12' }, b: { type: 'boolean', boolean: true, spelling: 'true' }, t: text('x'), empty: NONE }));
        const head = (key: string) => s.menuOf(key)[0];
        expect([head('n'), head('b'), head('t')].map(item => [item.title, item.icon, item.disabled])).toEqual([
            ['Type: number', 'hash', true],
            ['Type: boolean', 'toggle-left', true],
            ['Type: text', 'type', true],
        ]);
        expect(s.menuOf('empty').map(item => item.title)).toEqual(['Delete key']);
        expect(s.menus.last()!.separatorsAt).toEqual([]);
    });

    it('converts a text to a list of it and a list of one item to its single value, the rows built anew with the focus put in no field', () => {
        const s = setUp(byKey({ Area: text('lab'), one: list('a') }));
        s.pick('Area', 'Convert to list');
        expect(valuesOf(s.writes.at(-1)!)).toEqual({ Area: list('lab'), one: list('a') });
        expect(s.rowOf('Area')!.findAll('task-hub__list-item').length).toBeGreaterThan(0);
        s.pick('one', 'Convert to single value');
        expect(valuesOf(s.writes.at(-1)!)).toEqual({ Area: list('lab'), one: text('a') });
        expect(s.valueOf('one').value).toBe('a');
        expect(s.menuOf('one').map(item => item.title)).toContain('Convert to list');
        expect(s.doc.activeElement).toBe(s.doc.body);
    });

    it('does each item of the menu, the rows built anew with the focus put in no field', () => {
        const s = setUp(byKey({ Area: text('lab'), own: list('a') }), { inherited: byKey({ crew: list('x'), Area: text('top') }) });
        s.pick('crew', 'Open inherited line');
        expect(s.opened).toHaveLength(1);
        expect(s.writes).toEqual([]);

        s.pick('crew', 'Set to no value');
        s.pick('Area', 'Set to no value');
        s.pick('crew', 'Follow inherited value');
        s.pick('Area', 'Follow inherited value');
        expect(s.writes.map(valuesOf)).toEqual([
            { Area: text('lab'), own: list('a'), crew: NONE },
            { Area: NONE, own: list('a'), crew: NONE },
            { Area: NONE, own: list('a') },
            { own: list('a') },
        ]);
        expect(s.doc.activeElement).toBe(s.doc.body);
        s.pick('own', 'Delete key');
        expect(valuesOf(s.writes.at(-1)!)).toEqual({});
        expect(s.rowOf('own')).toBeUndefined();
        expect(s.doc.activeElement).toBe(s.doc.body);
    });

    it('takes an own value over an inherited one out from its menu, and writes an inherited value as the row\'s own, its list too', () => {
        const s = setUp(byKey({ Area: text('lab') }), { inherited: byKey({ Area: text('top'), crew: list('x', 'y') }) });
        s.pick('crew', 'Write inherited value to this task');
        expect(valuesOf(s.writes.at(-1)!)).toEqual({ Area: text('lab'), crew: list('x', 'y') });
        expect(s.rowOf('crew')!.find('task-hub__list-add')).not.toBeNull();
        s.pick('Area', 'Clear and follow inherited value');
        expect(valuesOf(s.writes.at(-1)!)).toEqual({ crew: list('x', 'y') });
        expect([s.valueOf('Area').value, s.valueOf('Area').placeholder]).toEqual(['', 'top']);
    });

    it('writes an inherited text at once as the layer above spells it: a text spelled with quotes stays a text', () => {
        const quoted: PropertyScalar = { type: 'text', text: '123', spelling: '"123"' };
        const s = setUp({}, { inherited: byKey({ code: quoted }) });
        expect(s.menuOf('code').map(item => item.title)).toEqual(['Type: text', 'Inherited from section', 'Open inherited line', 'Write inherited value to this task', 'Set to no value']);
        s.pick('code', 'Write inherited value to this task');
        expect(s.writes).toHaveLength(1);
        expect(s.writes[0].code.value).toEqual({ type: 'text', text: '123', spelling: '"123"' });
        expect([s.valueOf('code').value, s.valueOf('code').placeholder]).toEqual(['"123"', '"123"']);
        // Nothing of the menu left to write: the value is the row's own now.
        expect(s.menuOf('code').map(item => item.title)).not.toContain('Write inherited value to this task');
    });

    it('puts the focus in no field once an item of the menu is done, though another row\'s value held it as the … was pressed', () => {
        const s = setUp(byKey({ Area: text('lab'), one: list('a') }));
        s.valueOf('Area').focus();
        buttonOf(s, 'one')!.press();
        expect(s.doc.activeElement).toBe(s.valueOf('Area'));
        s.menus.last()!.items.find(item => item.title === 'Convert to single value')!.click!();
        expect(valuesOf(s.writes.at(-1)!)).toEqual({ Area: text('lab'), one: text('a') });
        expect(s.doc.activeElement).toBe(s.doc.body);
    });
});

describe('a row written from outside while the focus is in the rows', () => {
    const NONE = { type: 'null', spelling: '' } as const;
    const list = (...items: string[]) => ({ type: 'list', items: items.map(text) }) as const;
    const shown = (el: FocusEl | null) => el !== null && el.style.display !== 'none';

    /** The rows `k:: a` and `m:: x`, the focus kept in m once `y` is written with Enter. */
    function focusedInM() {
        const s = setUp(byKey({ k: text('a'), m: text('x') }));
        const m = s.valueOf('m');
        m.focus();
        m.type('y');
        m.enter();
        expect(s.writes).toHaveLength(1);
        return s;
    }

    const CHANGES: [string, Properties][] = [
        ['made a list', byKey({ k: list('p', 'q'), m: text('y') })],
        ['taken out', byKey({ m: text('y') })],
    ];

    it('keeps a row made a list as the text field it was built as while the focus is in the rows, and builds it as a list once the focus leaves them', async () => {
        const s = focusedInM();
        const field = s.valueOf('k');
        s.outside(byKey({ k: list('p', 'q'), m: text('y') }));
        expect(s.valueOf('k')).toBe(field);
        expect(field.value).toBe('a');
        s.leave();
        await Promise.resolve();
        expect(s.rowOf('k')!.find('task-hub__value')).toBeNull();
        expect(s.rowOf('k')!.findAll('task-hub__list-item').filter(item => !item.classes.has('task-hub__list-item--add')).map(item => item.find('tv-ctrl__text-input')!.value))
            .toEqual(['p', 'q']);
        expect(s.writes).toHaveLength(1);
    });

    it.each(CHANGES)('writes nothing from the field of a row %s: touched and left, typed over and left, or the focus kept as the hub closes', (_name, next) => {
        for (const then of ['touched', 'typed', 'close']) {
            const s = focusedInM();
            const field = s.valueOf('k');
            s.outside(next);
            if (then === 'close') s.group.save();
            else {
                field.focus();
                if (then === 'typed') field.type('b');
                if (then === 'typed') field.enter();
                s.leave();
            }
            expect(s.writes, then).toHaveLength(1);
        }
    });

    it('writes nothing from the field of a row a finding locks meanwhile, typed over and left', () => {
        const findings: HubFinding[] = [];
        const s = setUp(byKey({ k: text('a'), m: text('x') }), { findings });
        s.valueOf('m').focus();
        findings.push({ kind: 'duplicate-key', field: 'prop:k', tone: 'error', text: 'twice', key: 'k', line: 1 });
        s.outside(byKey({ k: text('a'), m: text('x') }));
        s.valueOf('k').focus();
        s.valueOf('k').type('b');
        s.leave();
        expect(s.writes).toEqual([]);
    });

    it('compares a field whose value was written from outside with the value as it is now: touched and left it writes nothing, and the value it was built with typed back is written', () => {
        const s = focusedInM();
        s.outside(byKey({ k: text('c'), m: text('y') }));
        expect(s.valueOf('k').value).toBe('c');
        s.valueOf('k').focus();
        s.leave();
        expect(s.writes).toHaveLength(1);
        s.valueOf('k').focus();
        s.valueOf('k').type('a');
        s.leave();
        expect(s.writes.slice(1).map(valuesOf)).toEqual([{ k: text('a'), m: text('y') }]);
    });

    it('puts each field\'s faint text, struck value and dashed box on it again as the rows written from outside are now', () => {
        const s = setUp(byKey({ k: text('a'), n: NONE, Place: NONE, m: text('x') }), { inherited: byKey({ Place: text('home') }) });
        const box = (key: string) => s.valueOf(key).parent!;
        s.valueOf('m').focus();
        expect([s.valueOf('n').placeholder, box('Place').find('tv-form__struck-text')?.text, box('Place').classes.has('tv-form__control--inherited')])
            .toEqual(['No value', 'home', false]);
        s.outside(byKey({ k: NONE, n: text('b'), m: text('x') }));
        expect(s.valueOf('m')).toBe(s.doc.activeElement);
        // A value has the faint text of what emptying it shows; the inherited value no longer hidden is the faint text of the empty field in a dashed box, not struck through.
        expect([s.valueOf('n').placeholder, box('Place').find('tv-form__struck-text'), box('Place').classes.has('tv-form__control--inherited')])
            .toEqual(['No value', null, true]);
        expect([s.valueOf('n').value, s.valueOf('Place').value, s.valueOf('Place').placeholder, s.valueOf('k').placeholder]).toEqual(['b', '', 'home', 'No value']);
    });
});

describe('a button pressed while another field of the properties holds what was typed', () => {
    const list = (...items: string[]) => ({ type: 'list', items: items.map(text) }) as const;
    const NONE = { type: 'null', spelling: '' } as const;
    /** The × of the item `item` of the list `key`. */
    const itemX = (s: ReturnType<typeof setUp>, key: string, item: string) => s.rowOf(key)!.findAll('task-hub__list-item')
        .find(one => one.find('tv-ctrl__text-input')?.value === item)!.find('tv-form__clear-button')!;
    const itemField = (s: ReturnType<typeof setUp>, key: string, item: string) => s.rowOf(key)!.findAll('task-hub__list-item')
        .find(one => one.find('tv-ctrl__text-input')?.value === item)!.find('tv-ctrl__text-input')!;

    it('commits the item typed in the add field as its Enter does, then takes the item out, the focus kept in the add field', () => {
        const s = setUp(byKey({ docs: list('企画書', '議事録') }));
        s.listAdd().focus();
        s.listAdd().type('zz');
        itemX(s, 'docs', '議事録').press();
        expect(s.writes.map(valuesOf)).toEqual([{ docs: list('企画書', '議事録', 'zz') }, { docs: list('企画書', 'zz') }]);
        expect(s.listAdd().value).toBe('');
        expect(s.doc.activeElement).toBe(s.listAdd());
    });

    it('adds the property typed in the add row, then opens the menu of the row whose … is pressed, the focus put in the add row\'s key', () => {
        const s = setUp(byKey({ Area: text('lab') }));
        s.addKey().focus();
        s.addKey().type('memo2');
        s.rowOf('Area')!.find('tv-form__menu-button')!.press();
        expect(s.writes.map(valuesOf)).toEqual([{ Area: text('lab'), memo2: NONE }]);
        expect(s.menus.shown.map(menu => menu.items[0].title)).toEqual(['Type: text']);
        expect(s.doc.activeElement).toBe(s.addKey());
    });

    it('takes out the item emptied in its field, then the item whose × is pressed at its place now', () => {
        const s = setUp(byKey({ docs: list('a', 'b', 'c') }));
        const a = itemField(s, 'docs', 'a');
        a.focus();
        a.type('');
        itemX(s, 'docs', 'c').press();
        expect(s.writes.map(valuesOf)).toEqual([{ docs: list('b', 'c') }, { docs: list('b') }]);
        expect(s.doc.activeElement).toBe(s.listAdd());
    });

    it('does nothing of the button while what was typed does not read: the field keeps the focus and says why', () => {
        const s = setUp(byKey({ docs: list('a', 'b') }));
        s.listAdd().focus();
        s.listAdd().type('x:: y');
        itemX(s, 'docs', 'b').press();
        expect(s.writes).toEqual([]);
        expect(s.doc.activeElement).toBe(s.listAdd());
        expect(s.listAdd().value).toBe('x:: y');
    });

    it('does nothing of the button while the key typed in the add row is refused: the key keeps the focus and says why', () => {
        const s = setUp(byKey({ Area: text('lab') }));
        s.addKey().focus();
        s.addKey().type('#x');
        s.rowOf('Area')!.find('tv-form__menu-button')!.press();
        expect(s.writes).toEqual([]);
        expect(s.menus.shown).toEqual([]);
        expect(s.valueOf('Area').value).toBe('lab');
        expect(s.doc.activeElement).toBe(s.addKey());
        expect(s.keySays()).toEqual(['A key cannot start with a list or quote marker, #, or a code fence (~~~).']);
    });

    it('opens the menu of another row as its … is pressed over an item typed in a list\'s add field: the item added, the rows built anew, the … built anew pressed', () => {
        const s = setUp(byKey({ Area: text('lab'), docs: list('a') }));
        const more = s.rowOf('Area')!.find('tv-form__menu-button')!;
        s.listAdd().focus();
        s.listAdd().type('zz');
        more.press();
        expect(s.writes.map(valuesOf)).toEqual([{ Area: text('lab'), docs: list('a', 'zz') }]);
        expect(s.rowOf('Area')!.find('tv-form__menu-button')).not.toBe(more);
        expect(s.menus.shown.map(menu => menu.items[0].title)).toEqual(['Type: text']);
        expect(s.doc.activeElement).toBe(s.listAdd());
    });

    it('leaves the focus in a field in focus with nothing typed: the button acts, the field keeps the focus', () => {
        const s = setUp(byKey({ docs: list('企画書', '議事録') }));
        s.listAdd().focus();
        itemX(s, 'docs', '議事録').press();
        expect(s.writes.map(valuesOf)).toEqual([{ docs: list('企画書') }]);
        expect(s.doc.activeElement).toBe(s.listAdd());
    });

    it('commits what the IME is converting as typed, then acts; the field built anew holds none of it, and nothing is written twice as the conversion ends', () => {
        const s = setUp(byKey({ docs: list('企画書', '議事録') }));
        const add = s.listAdd();
        add.focus();
        add.dispatchEvent(new Event('compositionstart'));
        add.value = 'かい';
        add.dispatchEvent(Object.assign(new Event('input', { bubbles: true }), { isComposing: true }));
        itemX(s, 'docs', '議事録').press();
        expect(s.writes.map(valuesOf)).toEqual([{ docs: list('企画書', '議事録', 'かい') }, { docs: list('企画書', 'かい') }]);
        add.dispatchEvent(new Event('compositionend'));
        expect(s.listAdd()).not.toBe(add);
        expect([s.listAdd().value, s.doc.activeElement]).toEqual(['', s.listAdd()]);
        s.listAdd().enter();
        s.leave();
        expect(s.writes).toHaveLength(2);
    });

    it('gives the focus back to another row\'s value as a list\'s item × builds the rows anew, nothing typed: the field built anew, its caret where it was', () => {
        const s = setUp(byKey({ Area: text('lab'), docs: list('a', 'b') }));
        const before = s.valueOf('Area');
        before.focus();
        before.setSelectionRange(1, 2);
        itemX(s, 'docs', 'b').press();
        expect(s.writes.map(valuesOf)).toEqual([{ Area: text('lab'), docs: list('a') }]);
        expect(s.valueOf('Area')).not.toBe(before);
        expect(s.doc.activeElement).toBe(s.valueOf('Area'));
        expect([s.valueOf('Area').selectionStart, s.valueOf('Area').selectionEnd]).toEqual([1, 2]);
    });

    it('writes another row\'s value typed, then the list, the focus back in that value, its caret at the end of what was typed', () => {
        const s = setUp(byKey({ Area: text('lab'), docs: list('a', 'b') }));
        s.valueOf('Area').focus();
        s.valueOf('Area').type('lab2');
        s.valueOf('Area').setSelectionRange(4, 4);
        itemX(s, 'docs', 'b').press();
        expect(s.writes.map(valuesOf)).toEqual([{ Area: text('lab2'), docs: list('a', 'b') }, { Area: text('lab2'), docs: list('a') }]);
        expect(s.doc.activeElement).toBe(s.valueOf('Area'));
        expect([s.valueOf('Area').value, s.valueOf('Area').selectionStart]).toEqual(['lab2', 4]);
    });

    it('gives the focus back to the add row\'s value, and to another list\'s add field, as a list\'s item × builds the rows anew', () => {
        const s = setUp(byKey({ docs: list('a', 'b'), crew: list('x') }));
        s.addValue().focus();
        itemX(s, 'docs', 'b').press();
        expect(s.doc.activeElement).toBe(s.addValue());
        const crewAdd = () => s.rowOf('crew')!.find('task-hub__list-add')!;
        crewAdd().focus();
        itemX(s, 'docs', 'a').press();
        expect(s.writes.map(valuesOf)).toEqual([{ docs: list('a'), crew: list('x') }, { docs: NONE, crew: list('x') }]);
        expect(s.doc.activeElement).toBe(crewAdd());
    });

    it('leaves the focus where it is in a text field of the surface out of the properties, as a list\'s item × builds them anew', () => {
        const s = setUp(byKey({ docs: list('a', 'b') }));
        const name = s.root.createEl('input', { type: 'text' });
        name.focus();
        itemX(s, 'docs', 'b').press();
        expect(s.writes.map(valuesOf)).toEqual([{ docs: list('a') }]);
        expect(s.doc.activeElement).toBe(name);
    });

    it('commits the value typed in a field as its own … is pressed, written once, then opens the menu of the value written', () => {
        const s = setUp(byKey({ Area: text('lab'), docs: list('a') }));
        const field = s.valueOf('Area');
        field.focus();
        field.type('typed');
        s.rowOf('Area')!.find('tv-form__menu-button')!.press();
        expect(s.writes.map(valuesOf)).toEqual([{ Area: text('typed'), docs: list('a') }]);
        expect(s.menus.shown).toHaveLength(1);
        expect(s.valueOf('Area').value).toBe('typed');
    });

});
