import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PropertiesFieldGroup } from '../../../src/modals/hub/fields/PropertiesFieldGroup';
import type { FieldGroupContext } from '../../../src/modals/hub/fields/FieldGroupContext';
import type { Properties, PropertyScalar, Task } from '../../../src/types';
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

/** A hub's properties on a task, its writes taken (or refused) as the hub's queue answers them. */
function setUp(properties: Properties = {}, opts: { refuse?: boolean } = {}) {
    const doc = new FocusDoc();
    let task: Task = makeTask({ properties });
    const writes: Properties[] = [];
    const ctx = {
        getTask: () => task,
        isShut: () => false,
        queue: (updates: Partial<Task> | null) => {
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
        findings: () => [],
        locked: () => false,
        issues: { set: () => { }, redraw: () => { } },
    } as unknown as FieldGroupContext;
    const root = doc.root();
    const group = new PropertiesFieldGroup(asEl(root), ctx);
    const addRow = () => root.find('task-hub__prop-add')!;
    return {
        doc,
        root,
        group,
        writes,
        task: () => task,
        addKey: () => addRow().find('tv-form__label')!.children.find(c => c.placeholder !== '')!,
        addValue: () => addRow().find('tv-form__control')!,
        listAdd: () => root.find('task-hub__list-add')!,
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
