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
    const root = doc.root();
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
            rowOf(key)!.find('task-hub__prop-more')!.dispatchEvent(new Event('click'));
            return menus.last()!.items;
        },
        /** Pick the item titled `title` from the menu of the row labelled `key`. */
        pick: (key: string, title: string) => {
            rowOf(key)!.find('task-hub__prop-more')!.dispatchEvent(new Event('click'));
            menus.last()!.items.find(item => item.title === title)!.click!();
        },
        /** What the add row's key says wrong. */
        keySays: () => (said.get('propKey') ?? []).map(issue => issue.text),
        /** Take the focus out of the properties, as a tap elsewhere does. */
        leave: () => away.focus(),
    };
}

describe('PropertiesFieldGroup built anew while an input holds the focus', () => {
    it('adds the property typed in the add row on Enter: written once, the add row emptied', () => {
        const s = setUp();
        s.addKey().focus();
        s.addKey().type('memo2');
        expect(() => s.addKey().enter()).not.toThrow();
        expect(s.writes.map(valuesOf)).toEqual([{ memo2: { type: 'null', spelling: '' } }]);
        expect(s.addKey().value).toBe('');
        expect(s.root.findAll('task-hub__prop-add')).toHaveLength(1);
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
        expect(s.keySays()).toEqual(['Area already has a field. Edit it there.']);
        s.addKey().enter();
        s.leave();
        expect(s.writes).toEqual([]);
        expect([s.addKey().value, s.addValue().value]).toEqual(['AREA', 'x']);
        expect(s.keySays()).toEqual(['Area already has a field. Edit it there.']);
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
            expect(s.keySays(), typed).toEqual([`${row} already has a field. Edit it there.`]);
        }
        expect(s.writes).toEqual([]);
    });

    it('refuses the key of an inherited list made the row\'s own and not written yet', () => {
        const s = setUp({}, { inherited: byKey({ tags2: { type: 'list', items: [text('a')] } }) });
        s.pick('tags2', 'Make it this task\'s own');
        s.addKey().focus();
        s.addKey().type('Tags2');
        s.addKey().enter();
        expect(s.writes).toEqual([]);
        expect(s.keySays()).toEqual(['tags2 already has a field. Edit it there.']);
    });

    it('refuses a key starting as a list item or a # does, and a reserved key naming the field that edits it', () => {
        const s = setUp();
        for (const [typed, says] of [
            ['- x', 'A key cannot start with a list or quote marker, or #.'],
            ['1. x', 'A key cannot start with a list or quote marker, or #.'],
            ['#x', 'A key cannot start with a list or quote marker, or #.'],
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

describe('a property\'s value emptied keeps its row: no value is written', () => {
    const NONE = { type: 'null', spelling: '' } as const;
    /** The × of the first item of a list that is the row's own. */
    const firstItemX = (s: ReturnType<typeof setUp>) => s.root.findAll('task-hub__list-item').find(item => !item.classes.has('task-hub__list-item--add'))!.find('tv-form__clear-button')!;

    it('writes no value for an own value emptied, the row standing with no value', () => {
        const s = setUp(byKey({ Area: text('lab') }));
        s.valueOf('Area').focus();
        s.valueOf('Area').type('  ');
        s.leave();
        expect(s.writes.map(valuesOf)).toEqual([{ Area: NONE }]);
        expect(s.valueOf('Area').value).toBe('');
    });

    it('writes no value for the last item of an own list taken out, the row standing', () => {
        const s = setUp(byKey({ tags2: { type: 'list', items: [text('a')] } }));
        firstItemX(s).dispatchEvent(new Event('click'));
        expect(s.writes.map(valuesOf)).toEqual([{ tags2: NONE }]);
        expect(s.valueOf('tags2').value).toBe('');
    });

    it('writes no value over an inherited value emptied, which it hides', () => {
        const s = setUp({}, { inherited: byKey({ Place: text('home') }) });
        s.valueOf('Place').focus();
        s.valueOf('Place').type('');
        s.leave();
        expect(s.writes.map(valuesOf)).toEqual([{ Place: NONE }]);
    });

    it('writes no value for an inherited list made the row\'s own and emptied, which it hides', () => {
        const s = setUp({}, { inherited: byKey({ tags2: { type: 'list', items: [text('a')] } }) });
        s.pick('tags2', 'Make it this task\'s own');
        firstItemX(s).dispatchEvent(new Event('click'));
        expect(s.writes.map(valuesOf)).toEqual([{ tags2: NONE }]);
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

describe('a property\'s row: the key and its mark, the field with its ×, and the menu button', () => {
    const NONE = { type: 'null', spelling: '' } as const;
    const list = (...items: string[]) => ({ type: 'list', items: items.map(text) }) as const;
    const xOf = (s: ReturnType<typeof setUp>, key: string) => s.rowOf(key)!.find('tv-form__clear-button');
    const shown = (el: FocusEl | null) => el !== null && el.style.display !== 'none';
    const markOf = (s: ReturnType<typeof setUp>, key: string) => {
        const mark = s.rowOf(key)!.find('task-hub__prop-mark');
        return mark && [...mark.classes].find(c => c.startsWith('task-hub__prop-mark--')) + ' ' + mark.attrs.get('aria-label');
    };

    it('writes no value at once as the × in an own text\'s field is pressed, the focus not put in the field, and the row kept', () => {
        const s = setUp(byKey({ Area: text('lab') }));
        expect(shown(xOf(s, 'Area'))).toBe(true);
        xOf(s, 'Area')!.dispatchEvent(new Event('click'));
        expect(s.writes.map(valuesOf)).toEqual([{ Area: NONE }]);
        expect(s.doc.activeElement).not.toBe(s.valueOf('Area'));
        expect(s.valueOf('Area').value).toBe('');
        expect(s.valueOf('Area').placeholder).toBe('No value');
        // An empty field has no ×.
        expect(shown(xOf(s, 'Area'))).toBe(false);
    });

    it('hides an inherited text with no value as the × in its field is pressed, the value hidden shown struck through', () => {
        const s = setUp({}, { inherited: byKey({ Place: text('home') }) });
        expect(markOf(s, 'Place')).toBe('task-hub__prop-mark--inherited Inherited value');
        expect(s.rowOf('Place')!.classes.has('task-hub__row--inherited')).toBe(true);
        xOf(s, 'Place')!.dispatchEvent(new Event('click'));
        expect(s.writes.map(valuesOf)).toEqual([{ Place: NONE }]);
        expect(markOf(s, 'Place')).toBe('task-hub__prop-mark--hiding Hiding the inherited value');
        expect(s.rowOf('Place')!.classes.has('task-hub__row--inherited')).toBe(false);
        expect(s.valueOf('Place').placeholder).toBe('home');
        expect(s.valueOf('Place').classes.has('task-hub__value--struck')).toBe(true);
    });

    it('marks and fills each no value as what it hides says: the list\'s items joined, an inherited no value as no value, nothing inherited with no mark', () => {
        const s = setUp(byKey({ crew: NONE, gone: NONE, empty: NONE }), { inherited: byKey({ crew: list('a', 'b'), gone: NONE }) });
        expect([s.valueOf('crew').placeholder, s.valueOf('crew').classes.has('task-hub__value--struck'), markOf(s, 'crew')])
            .toEqual(['a, b', true, 'task-hub__prop-mark--hiding Hiding the inherited value']);
        expect([s.valueOf('gone').placeholder, s.valueOf('gone').classes.has('task-hub__value--struck'), markOf(s, 'gone')])
            .toEqual(['No value', false, 'task-hub__prop-mark--hiding Hiding the inherited value']);
        expect([s.valueOf('empty').placeholder, s.valueOf('empty').classes.has('task-hub__value--struck'), markOf(s, 'empty')])
            .toEqual(['No value', false, null]);
    });

    it('draws a menu button on each row but a locked one, which keeps its room; an item\'s × in each item of an own list', () => {
        const findings: HubFinding[] = [{ kind: 'duplicate-key', field: 'prop:dup', tone: 'error', text: 'twice', key: 'dup', line: 1 }];
        const s = setUp(byKey({ Area: text('lab'), tags2: list('a', 'b') }), { inherited: byKey({ crew: list('x') }), findings });
        for (const key of ['Area', 'tags2', 'crew']) {
            const more = s.rowOf(key)!.find('task-hub__prop-more')!;
            expect(more.attrs.get('aria-label'), key).toBe(`Menu of ${key}`);
            expect(more.disabled, key).toBe(false);
        }
        expect(s.rowOf('dup')!.find('task-hub__prop-more')).toBeNull();
        expect(s.rowOf('dup')!.find('task-hub__prop-more-room')).not.toBeNull();
        expect(s.rowOf('dup')!.find('tv-form__clear-button')).toBeNull();
        expect(s.rowOf('tags2')!.findAll('tv-form__clear-button').map(x => x.attrs.get('aria-label'))).toEqual(['Remove item a', 'Remove item b']);
        // The inherited list is shown as chips, with no ×.
        expect(s.rowOf('crew')!.findAll('task-hub__list-chip--cascade')).toHaveLength(1);
        expect(s.rowOf('crew')!.find('tv-form__clear-button')).toBeNull();
        expect(markOf(s, 'crew')).toBe('task-hub__prop-mark--inherited Inherited value');
    });

    it('takes no press on the menu button, and draws no ×, while the hub shuts the fields', () => {
        const s = setUp(byKey({ Area: text('lab'), tags2: list('a') }), { shut: true });
        expect(s.rowOf('Area')!.find('task-hub__prop-more')!.disabled).toBe(true);
        expect(s.root.findAll('tv-form__clear-button')).toEqual([]);
        s.rowOf('Area')!.find('task-hub__prop-more')!.dispatchEvent(new Event('click'));
        expect(s.menus.shown).toEqual([]);
    });

    it('shows the menu under its button: the attributes greyed, a separator, then the items titled and greyed as the row\'s menu says', () => {
        const s = setUp({}, { inherited: byKey({ crew: list('x') }), noSource: true });
        const items = s.menuOf('crew');
        expect(items.map(item => [item.title, item.icon, item.disabled])).toEqual([
            ['Type: list', 'list', true],
            ['Inherited from section', 'heading', true],
            ['Open inherited line', 'external-link', true],
            ['Make it this task\'s own', 'copy', false],
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
        expect(s.menuOf('empty').map(item => item.title)).toEqual(['Delete']);
        expect(s.menus.last()!.separatorsAt).toEqual([]);
    });

    it('converts a text to a list of it and a list of one item to its text, the rows built anew with the focus put in no field', () => {
        const s = setUp(byKey({ Area: text('lab'), one: list('a') }), { inherited: byKey({ crew: list('x') }) });
        s.pick('Area', 'Convert to list');
        expect(valuesOf(s.writes.at(-1)!)).toEqual({ Area: list('lab'), one: list('a') });
        expect(s.rowOf('Area')!.findAll('task-hub__list-item').length).toBeGreaterThan(0);
        s.pick('one', 'Convert to text');
        expect(valuesOf(s.writes.at(-1)!)).toEqual({ Area: list('lab'), one: text('a') });
        expect(s.valueOf('one').value).toBe('a');
        expect(s.doc.activeElement).toBe(s.doc.body);

        // A draft of the inherited list converted: the text written, the draft let go.
        s.pick('crew', 'Make it this task\'s own');
        s.pick('crew', 'Convert to text');
        expect(valuesOf(s.writes.at(-1)!)).toEqual({ Area: list('lab'), one: text('a'), crew: text('x') });
        expect(s.valueOf('crew').value).toBe('x');
        expect(s.menuOf('crew').map(item => item.title)).toContain('Convert to list');
        expect(s.doc.activeElement).toBe(s.doc.body);
    });

    it('does each item of the menu, the rows built anew with the focus put in no field', () => {
        const s = setUp(byKey({ Area: text('lab'), own: list('a') }), { inherited: byKey({ crew: list('x'), Area: text('top') }) });
        s.pick('crew', 'Open inherited line');
        expect(s.opened).toHaveLength(1);

        s.pick('crew', 'Make it this task\'s own');
        expect(s.writes).toEqual([]);
        expect(s.rowOf('crew')!.find('task-hub__list-add')).not.toBeNull();
        expect(s.doc.activeElement).toBe(s.doc.body);
        // The draft thrown away: nothing written, the inherited list shown again.
        s.pick('crew', 'Revert to inherited value');
        expect(s.writes).toEqual([]);
        expect(s.rowOf('crew')!.findAll('task-hub__list-chip--cascade')).toHaveLength(1);

        s.pick('crew', 'Set to no value');
        s.pick('own', 'Set to no value');
        s.pick('Area', 'Revert to inherited value');
        expect(s.writes.map(valuesOf)).toEqual([
            { Area: text('lab'), own: list('a'), crew: NONE },
            { Area: text('lab'), own: NONE, crew: NONE },
            { own: NONE, crew: NONE },
        ]);
        s.pick('own', 'Delete');
        expect(valuesOf(s.writes.at(-1)!)).toEqual({ crew: NONE });
        expect(s.rowOf('own')).toBeUndefined();
        expect(s.doc.activeElement).toBe(s.doc.body);
    });
});
