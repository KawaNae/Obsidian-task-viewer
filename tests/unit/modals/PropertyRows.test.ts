import { describe, it, expect } from 'vitest';
import { PropertyRows, type PropertyRowsInput } from '../../../src/modals/hub/fields/PropertyRows';
import type { FieldAction } from '../../../src/modals/hub/fields/FieldState';
import type { HubFinding } from '../../../src/modals/hub/HubFindings';
import type { PropertyScalar, PropertyValue, Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';
import { byKey } from '../helpers/properties';

/**
 * The hub's custom property rows: which rows there are, in which order, what
 * each holds of the row's own lines and of the layers above, and what each
 * draws and offers in its menu. A row's own value and the value it inherits
 * are kept on the two sides of its field's state, so a row that overrides or
 * hides an inherited value holds both. The look and the items every field
 * has are the field table's (`FieldState.test.ts`); here, what a property
 * adds to it.
 */

const text = (s: string): PropertyScalar => ({ type: 'text', text: s, spelling: s });
const list = (...items: string[]): PropertyValue => ({ type: 'list', items: items.map(text) });
const none: PropertyValue = { type: 'null', spelling: '' };

function taskOf(own: Record<string, PropertyValue>, inherited: Record<string, PropertyValue> = {}, extra: Partial<Task> = {}): Task {
    const cascade = Object.keys(inherited).length > 0 ? { cascadeContext: { properties: byKey(inherited) } } : {};
    return makeTask({ properties: byKey(own), ...cascade, ...extra });
}

function finding(key: string, field: HubFinding['field'] = `prop:${key.toLowerCase()}`): HubFinding {
    return { kind: 'duplicate-key', field, tone: 'error', text: '', key, line: 1 };
}

function rowsOf(task: Task, opts: Partial<Omit<PropertyRowsInput, 'task'>> = {}) {
    return PropertyRows.of({ task, findings: [], locked: () => false, ...opts });
}

function only(task: Task) {
    const rows = rowsOf(task);
    expect(rows).toHaveLength(1);
    return rows[0];
}

/** The menu's items as words: an action, a drop's name, a conversion with what it writes spelled. */
function itemsOf(task: Task, opensSource = true): string[] {
    return PropertyRows.menuOf(only(task), { opensSource }).menu.items.map((item) => {
        if ('writes' in item) return `${item.action}:${JSON.stringify(item.writes.type === 'list' ? item.writes.items.map(i => i.spelling) : item.writes.spelling)}`;
        const action = item as FieldAction;
        return action.action === 'dropOwn' ? action.name : action.action;
    });
}

describe('PropertyRows.of, fieldOf and menuOf: what each row is, draws and offers', () => {
    it.each([
        { name: 'its own text', task: taskOf({ memo: text('a') }), field: { kind: 'text', value: text('a') }, type: 'text', items: ['toList:["a"]', 'deleteKey'] },
        { name: 'its own list of one item', task: taskOf({ memo: list('a') }), field: { kind: 'list', items: [text('a')], editsOwn: true }, type: 'list', items: ['toSingleValue:"a"', 'deleteKey'] },
        { name: 'its own list of two items', task: taskOf({ memo: list('a', 'b') }), field: { kind: 'list', items: [text('a'), text('b')], editsOwn: true }, type: 'list', items: ['deleteKey'] },
        { name: 'its own text over an inherited one', task: taskOf({ memo: text('b') }, { memo: text('a') }), field: { kind: 'text', value: text('b') }, type: 'text', items: ['openSource', 'toList:["b"]', 'noValue', 'clearToInherited'] },
        { name: 'its own list over an inherited text', task: taskOf({ memo: list('a', 'b') }, { memo: text('a') }), field: { kind: 'list', items: [text('a'), text('b')], editsOwn: true }, type: 'list', items: ['openSource', 'noValue', 'clearToInherited'] },
        { name: 'an inherited text alone', task: taskOf({}, { memo: text('a') }), field: { kind: 'text', value: undefined }, type: 'text', items: ['openSource', 'writeInherited', 'noValue'] },
        { name: 'an inherited list alone', task: taskOf({}, { memo: list('a') }), field: { kind: 'list', items: [text('a')], editsOwn: false }, type: 'list', items: ['openSource', 'writeInherited', 'noValue'] },
        { name: 'its own no value hiding an inherited value', task: taskOf({ memo: none }, { memo: text('a') }), field: { kind: 'text', value: undefined }, type: null, items: ['openSource', 'followInherited'] },
        { name: 'its own no value, nothing inherited', task: taskOf({ memo: none }), field: { kind: 'text', value: undefined }, type: null, items: ['deleteKey'] },
        { name: 'an inherited no value alone', task: taskOf({}, { memo: none }), field: { kind: 'text', value: undefined }, type: null, items: ['openSource'] },
    ])('$name', ({ task, field, type, items }) => {
        const row = only(task);
        expect(PropertyRows.fieldOf(row)).toEqual(field);
        expect(PropertyRows.menuOf(row, { opensSource: true }).type).toBe(type);
        expect(itemsOf(task)).toEqual(items);
    });

    it('reads a layer above\'s no value as no value given, and the row\'s own as its own no value', () => {
        expect(only(taskOf({ memo: none }, { memo: none })).state).toEqual({ own: { kind: 'noValue' }, inherited: { kind: 'noValue', source: 'section' } });
    });

    it('shows an inherited list\'s items joined, struck through where the row\'s own no value hides them', () => {
        expect(PropertyRows.lookOf(only(taskOf({ memo: none }, { memo: list('a', 'b') })))).toEqual({ frame: 'own', faint: { kind: 'struck', text: 'a, b' } });
        expect(PropertyRows.lookOf(only(taskOf({}, { memo: text('a') })))).toEqual({ frame: 'inherited', faint: { kind: 'value', text: 'a' } });
    });

    it('converts a number or a boolean to a list of the item it reads as, and says its type', () => {
        const num: PropertyScalar = { type: 'number', number: 3, spelling: '3' };
        const row = only(taskOf({ n: num }));
        expect(PropertyRows.menuOf(row, { opensSource: true }).type).toBe('number');
        expect(PropertyRows.menuOf(row, { opensSource: true }).menu.items[0]).toEqual({ action: 'toList', writes: { type: 'list', items: [num] } });
    });

    it('offers no list of a value no item spells, as a line holding it would not read back as that one item', () => {
        expect(itemsOf(taskOf({ memo: text('[ ] x') }))).toEqual(['deleteKey']);
        expect(itemsOf(taskOf({ memo: text('a:: b') }))).toEqual(['deleteKey']);
    });

    it('greys the inherited line\'s item where the hub has no line to open, the menu keeping its shape', () => {
        const { items } = PropertyRows.menuOf(only(taskOf({}, { memo: text('a') })), { opensSource: false }).menu;
        expect(items[0]).toEqual({ action: 'openSource', disabled: true });
        expect(items).toHaveLength(3);
    });

    it('empties a row by its state: its own line out over a key given, no value with none, nothing for none of its own', () => {
        expect(PropertyRows.emptiedOf(only(taskOf({ memo: text('b') }, { memo: text('a') })))).toBe('dropOwn');
        expect(PropertyRows.emptiedOf(only(taskOf({ memo: text('b') }, { memo: none })))).toBe('dropOwn');
        expect(PropertyRows.emptiedOf(only(taskOf({ memo: text('b') })))).toBe('noValue');
        expect(PropertyRows.emptiedOf(only(taskOf({}, { memo: text('a') })))).toBe('nothing');
    });

    it('a property a finding names with no value: one locked row with a blank field, under the key the finding names', () => {
        const rows = rowsOf(taskOf({}), { locked: () => true, findings: [finding('Dup'), finding('dup'), finding('Color', 'color')] });
        expect(rows).toEqual([{ folded: 'dup', key: 'Dup', state: { own: { kind: 'none' }, inherited: { kind: 'none' } }, locked: true }]);
        expect(PropertyRows.fieldOf(rows[0])).toEqual({ kind: 'blank' });
        expect(PropertyRows.menuOf(rows[0], { opensSource: true })).toEqual({ type: null, menu: { head: null, items: [] } });
    });

    it('a row with a value a finding locks: what it is stays, and it has no menu', () => {
        const [row] = rowsOf(taskOf({ memo: text('a') }), { locked: () => true, findings: [finding('memo')] });
        expect(row.locked).toBe(true);
        expect(PropertyRows.fieldOf(row)).toEqual({ kind: 'text', value: text('a') });
        expect(PropertyRows.menuOf(row, { opensSource: true }).menu.items).toEqual([]);
    });

    it('rows in the order of the values in effect, the key as the winning layer writes it, then the findings\' rows', () => {
        const task = taskOf({ C: text('c'), B: text('b2') }, { a: text('a'), b: text('b') });
        const rows = rowsOf(task, { findings: [finding('Dup'), finding('a')] });
        expect(rows.map(row => [row.folded, row.key])).toEqual([['a', 'a'], ['b', 'B'], ['c', 'C'], ['dup', 'Dup']]);
    });

    it('says where an inherited value is written, in the row and in its menu', () => {
        const task = taskOf({}, { memo: text('a') }, {
            inheritedFrom: { fields: {}, tags: [], properties: { memo: { kind: 'frontmatter', line: 1 } } },
        });
        const row = only(task);
        expect(row.state.inherited).toEqual({ kind: 'value', value: text('a'), source: 'file' });
        expect(PropertyRows.menuOf(row, { opensSource: true }).menu.head).toEqual({ source: 'file', inherited: { kind: 'value', text: 'a' }, overridden: false });
    });
});

describe('PropertyRows.takenBy: whether a property already has a row', () => {
    const rows = rowsOf(taskOf({ Memo: text('a') }, { area: list('x') }), {
        findings: [finding('Dup')],
        locked: (field) => field === 'prop:dup',
    });

    it('answers a key its case aside', () => {
        expect(PropertyRows.takenBy(rows, 'MEMO')?.key).toBe('Memo');
        expect(PropertyRows.takenBy(rows, 'memo')?.key).toBe('Memo');
    });

    it('answers a key a finding locks, and an inherited one\'s', () => {
        expect(PropertyRows.takenBy(rows, 'dup')?.locked).toBe(true);
        expect(PropertyRows.takenBy(rows, 'Area')?.state.inherited.kind).toBe('value');
    });

    it('answers none for a key with no row', () => {
        expect(PropertyRows.takenBy(rows, 'other')).toBeUndefined();
    });
});
