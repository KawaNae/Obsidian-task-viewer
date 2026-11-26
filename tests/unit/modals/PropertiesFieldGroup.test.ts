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
}

/** A hub's properties on a task, its writes taken (or refused) as the hub's host answers them. */
function setUp(properties: Properties = {}, opts: SetUpOptions = {}) {
    const doc = new FocusDoc();
    let task: Task = makeTask({ properties, ...(opts.inherited ? { cascadeContext: { properties: opts.inherited } as Task['cascadeContext'] } : {}) });
    const writes: Properties[] = [];
    const said = new Map<string, readonly FormIssue<HubField>[]>();
    const findings = opts.findings ?? [];
    const ctx = {
        task: () => task,
        isShut: () => false,
        put: (updates: Partial<Task> | null) => {
            if (updates?.properties) {
                writes.push(updates.properties);
                if (!opts.refuse) task = { ...task, properties: updates.properties };
            }
            return Promise.resolve(!opts.refuse);
        },
        app: { keymap: { pushScope: () => { }, popScope: () => { } } },
        plugin: { settings: DEFAULT_SETTINGS },
        index: { getTasks: () => [] },
        openSource: () => { },
        findings: () => findings,
        locked: (field: string) => findings.some(f => f.field === field),
        issues: { set: (source: string, issues: readonly FormIssue<HubField>[]) => { said.set(source, issues); }, redraw: () => { } },
    } as unknown as FieldGroupContext;
    const root = doc.root();
    const group = new PropertiesFieldGroup(asEl(root), ctx);
    const addRow = () => root.find('task-hub__prop-add')!;
    const away = doc.body.createDiv();
    return {
        doc,
        root,
        group,
        writes,
        task: () => task,
        addKey: () => addRow().find('tv-form__label')!.children.find(c => c.placeholder !== '')!,
        addValue: () => addRow().find('tv-form__control')!,
        listAdd: () => root.find('task-hub__list-add')!,
        /** The value field of the row labelled `key`. */
        valueOf: (key: string) => root.findAll('tv-form__row').find(row => row.find('tv-form__label')?.children.some(c => c.text === key))!.find('tv-form__control')!,
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
        s.root.find('task-hub__make-own')!.dispatchEvent(new Event('click'));
        s.addKey().focus();
        s.addKey().type('Tags2');
        s.addKey().enter();
        expect(s.writes).toEqual([]);
        expect(s.keySays()).toEqual(['tags2 already has a field. Edit it there.']);
    });

    it('refuses a key starting as a list item or a # does, and a reserved key naming the field that edits it', () => {
        const s = setUp();
        for (const [typed, says] of [
            ['- x', 'A key cannot start with a list marker or #.'],
            ['1. x', 'A key cannot start with a list marker or #.'],
            ['#x', 'A key cannot start with a list marker or #.'],
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
