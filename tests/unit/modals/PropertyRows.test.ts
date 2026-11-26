import { describe, it, expect } from 'vitest';
import { PropertyRows, type PropertyRowsInput } from '../../../src/modals/hub/fields/PropertyRows';
import type { HubFinding } from '../../../src/modals/hub/HubFindings';
import { PropertyValues } from '../../../src/services/parsing/utils/PropertyValues';
import type { PropertyScalar, PropertyValue, Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';
import { byKey } from '../helpers/properties';

/**
 * The hub's custom property rows: which rows there are, in which order, what
 * each holds of the row's own lines and of the layers above, and what each
 * draws and offers in its menu. A row's own value and the value it inherits are kept on two sides,
 * so a row that overrides or hides an inherited value holds both.
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
    return PropertyRows.of({ task, drafts: new Map(), findings: [], locked: () => false, ...opts });
}

function only(task: Task, opts: Partial<Omit<PropertyRowsInput, 'task'>> = {}) {
    const rows = rowsOf(task, opts);
    expect(rows).toHaveLength(1);
    return { row: rows[0], form: PropertyRows.formOf(rows[0]) };
}

describe('PropertyRows.of, formOf and menuOf: what each row is, draws and offers', () => {
    const plain = { inheritedLook: false, mark: null };
    const inheritedLook = { inheritedLook: true, mark: 'inherited' };
    const textField = (shown: PropertyValue, editsOwn: boolean, placeholder = '', struck = false) => ({ kind: 'text', shown, editsOwn, placeholder, struck });
    /** Items of `actions`, none greyed. */
    const items = (...actions: string[]) => actions.map(action => ({ action, disabled: false }));
    const toList = (writes: PropertyValue) => ({ action: 'toList', disabled: false, writes });
    const toText = (writes: PropertyValue) => ({ action: 'toText', disabled: false, writes });
    const type = (t: string) => ({ kind: 'type', type: t });
    const section = { kind: 'source', source: 'section' };

    it.each([
        {
            name: 'its own text value: converted to a list of it alone',
            task: taskOf({ memo: text('a') }),
            own: { kind: 'value', value: text('a') }, inherited: { kind: 'none' },
            form: { ...plain, field: textField(text('a'), true) },
            menu: { attributes: [type('text')], items: [toList(list('a')), ...items('remove')] },
        },
        {
            name: 'its own list of two items: no conversion to a text',
            task: taskOf({ memo: list('a', 'b') }),
            own: { kind: 'list', items: [text('a'), text('b')] }, inherited: { kind: 'none' },
            form: { ...plain, field: { kind: 'list', items: [text('a'), text('b')], editsOwn: true } },
            menu: { attributes: [type('list')], items: items('noValue', 'remove') },
        },
        {
            name: 'its own list of one item: converted to the item as its value',
            task: taskOf({ memo: list('a') }),
            own: { kind: 'list', items: [text('a')] }, inherited: { kind: 'none' },
            form: { ...plain, field: { kind: 'list', items: [text('a')], editsOwn: true } },
            menu: { attributes: [type('list')], items: [toText(text('a')), ...items('noValue', 'remove')] },
        },
        {
            name: 'its own no value, nothing inherited: "no value", no mark, no attribute and no conversion',
            task: taskOf({ memo: none }),
            own: { kind: 'null', value: none }, inherited: { kind: 'none' },
            form: { ...plain, field: textField(none, true, 'No value') },
            menu: { attributes: [], items: items('remove') },
        },
        {
            name: 'an inherited text value alone: no conversion',
            task: taskOf({}, { memo: text('a') }),
            own: { kind: 'none' }, inherited: { kind: 'value', value: text('a'), source: 'section' },
            form: { ...inheritedLook, field: textField(text('a'), false) },
            menu: { attributes: [type('text'), section], items: items('openSource') },
        },
        {
            name: 'an inherited list of one item alone: no conversion',
            task: taskOf({}, { memo: list('a') }),
            own: { kind: 'none' }, inherited: { kind: 'value', value: list('a'), source: 'section' },
            form: { ...inheritedLook, field: { kind: 'list', items: [text('a')], editsOwn: false } },
            menu: { attributes: [type('list'), section], items: items('openSource', 'makeOwn', 'noValue') },
        },
        {
            name: 'an inherited no value alone: drawn as an inherited text value, with no type',
            task: taskOf({}, { memo: none }),
            own: { kind: 'none' }, inherited: { kind: 'value', value: none, source: 'section' },
            form: { ...inheritedLook, field: textField(none, false, 'No value') },
            menu: { attributes: [section], items: items('openSource') },
        },
        {
            name: 'its own text value over an inherited list: its own type, converted as its own text is',
            task: taskOf({ memo: text('b') }, { memo: list('a') }),
            own: { kind: 'value', value: text('b') }, inherited: { kind: 'value', value: list('a'), source: 'section' },
            form: { ...plain, field: textField(text('b'), true) },
            menu: { attributes: [type('text'), section], items: [...items('openSource'), toList(list('b')), ...items('revert')] },
        },
        {
            name: 'its own list over an inherited text value: converted as its own list is',
            task: taskOf({ memo: list('b') }, { memo: text('a') }),
            own: { kind: 'list', items: [text('b')] }, inherited: { kind: 'value', value: text('a'), source: 'section' },
            form: { ...plain, field: { kind: 'list', items: [text('b')], editsOwn: true } },
            menu: { attributes: [type('list'), section], items: [...items('openSource'), toText(text('b')), ...items('noValue', 'revert')] },
        },
        {
            name: 'its own no value hiding an inherited text value: the value struck through, no type',
            task: taskOf({ memo: none }, { memo: text('a') }),
            own: { kind: 'null', value: none }, inherited: { kind: 'value', value: text('a'), source: 'section' },
            form: { inheritedLook: false, mark: 'hiding', field: textField(none, true, 'a', true) },
            menu: { attributes: [section], items: items('openSource', 'revert') },
        },
        {
            name: 'its own no value hiding an inherited list: the items joined, struck through',
            task: taskOf({ memo: none }, { memo: list('a', 'b') }),
            own: { kind: 'null', value: none }, inherited: { kind: 'value', value: list('a', 'b'), source: 'section' },
            form: { inheritedLook: false, mark: 'hiding', field: textField(none, true, 'a, b', true) },
            menu: { attributes: [section], items: items('openSource', 'revert') },
        },
        {
            name: 'its own no value hiding an inherited no value: "no value", not struck',
            task: taskOf({ memo: none }, { memo: none }),
            own: { kind: 'null', value: none }, inherited: { kind: 'value', value: none, source: 'section' },
            form: { inheritedLook: false, mark: 'hiding', field: textField(none, true, 'No value') },
            menu: { attributes: [section], items: items('openSource', 'revert') },
        },
    ])('$name', ({ task, own, inherited, form, menu }) => {
        const got = only(task);
        expect(got.row).toEqual({ folded: 'memo', key: 'memo', own, inherited, locked: false });
        expect(got.form).toEqual(form);
        expect(PropertyRows.menuOf(got.row, { opensSource: true })).toEqual(menu);
    });

    it('an inherited list copied as a draft: edited as its own, as an own list over it is, the draft thrown away by revert', () => {
        const got = only(taskOf({}, { memo: list('a', 'b') }), { drafts: new Map([['memo', [text('a'), text('b')]]]) });
        expect(got.row.own).toEqual({ kind: 'draft', items: [text('a'), text('b')] });
        expect(got.row.inherited).toEqual({ kind: 'value', value: list('a', 'b'), source: 'section' });
        expect(got.form).toEqual({ ...plain, field: { kind: 'list', items: [text('a'), text('b')], editsOwn: true } });
        expect(PropertyRows.menuOf(got.row, { opensSource: true })).toEqual({ attributes: [type('list'), section], items: items('openSource', 'noValue', 'revert') });
    });

    it('a draft of one item converts to the item as its value, as an own list of one does', () => {
        const { row } = only(taskOf({}, { memo: list('a') }), { drafts: new Map([['memo', [text('a')]]]) });
        expect(PropertyRows.menuOf(row, { opensSource: true }).items).toEqual([...items('openSource'), toText(text('a')), ...items('noValue', 'revert')]);
    });

    it('converts a number or a boolean to a list of the item it reads as, and says its type', () => {
        for (const [spelling, kind] of [['12', 'number'], ['true', 'boolean'], ['"12"', 'text']] as const) {
            const value = PropertyValues.fromText(spelling);
            const { row } = only(taskOf({ memo: value }));
            const menu = PropertyRows.menuOf(row, { opensSource: true });
            expect(menu.attributes, spelling).toEqual([type(kind)]);
            expect(menu.items[0], spelling).toEqual(toList({ type: 'list', items: [value as PropertyScalar] }));
        }
    });

    it('offers no list of a value no item spells, as a line holding it would not read back as that one item', () => {
        for (const spelling of ['[ ] x', 'a:: b']) {
            const { row } = only(taskOf({ memo: PropertyValues.fromText(spelling) }));
            expect(PropertyRows.menuOf(row, { opensSource: true }).items, spelling).toEqual(items('remove'));
        }
    });

    it('greys the inherited line\'s item where the hub has no line to open, the menu keeping its shape', () => {
        for (const inherited of [text('a'), list('a'), none]) {
            for (const own of [{}, { memo: text('b') }, { memo: none }] as Record<string, PropertyValue>[]) {
                const { row } = only(taskOf(own, { memo: inherited }));
                const opens = PropertyRows.menuOf(row, { opensSource: true });
                const greyed = PropertyRows.menuOf(row, { opensSource: false });
                expect(greyed).toEqual({ ...opens, items: [{ action: 'openSource', disabled: true }, ...opens.items.slice(1)] });
            }
        }
        expect(PropertyRows.menuOf(only(taskOf({ memo: text('a') })).row, { opensSource: false }).items).toEqual([toList(list('a')), ...items('remove')]);
    });

    it('a draft is no row\'s once the row has a value of its own', () => {
        const got = only(taskOf({ memo: list('b') }, { memo: list('a') }), { drafts: new Map([['memo', [text('a')]]]) });
        expect(got.row.own).toEqual({ kind: 'list', items: [text('b')] });
    });

    it('a row with a value a finding locks: what it is stays, and it is locked', () => {
        const got = only(taskOf({ memo: text('a') }), { locked: (field) => field === 'prop:memo', findings: [finding('memo')] });
        expect(got.row).toMatchObject({ own: { kind: 'value' }, locked: true });
        expect(got.form.field).toEqual({ kind: 'text', shown: text('a'), editsOwn: true, placeholder: '', struck: false });
        expect(PropertyRows.menuOf(got.row, { opensSource: true })).toEqual({ attributes: [], items: [] });
    });

    it('a property a finding names with no value: one locked row with a blank field, under the key the finding names', () => {
        const rows = rowsOf(taskOf({}), { locked: () => true, findings: [finding('Dup'), finding('dup'), finding('Color', 'color')] });
        expect(rows).toEqual([{ folded: 'dup', key: 'Dup', own: { kind: 'none' }, inherited: { kind: 'none' }, locked: true }]);
        expect(PropertyRows.formOf(rows[0])).toEqual({ ...plain, field: { kind: 'blank' } });
        expect(PropertyRows.menuOf(rows[0], { opensSource: true })).toEqual({ attributes: [], items: [] });
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
        const { row } = only(task);
        expect(row.inherited).toEqual({ kind: 'value', value: text('a'), source: 'file' });
        expect(PropertyRows.menuOf(row, { opensSource: true }).attributes).toEqual([type('text'), { kind: 'source', source: 'file' }]);
    });
});

describe('PropertyRows.takenBy: whether a property already has a row', () => {
    const rows = rowsOf(taskOf({ Memo: text('a') }, { area: list('x') }), {
        drafts: new Map([['area', [text('x')]]]),
        findings: [finding('Dup')],
        locked: (field) => field === 'prop:dup',
    });

    it('answers a key its case aside', () => {
        expect(PropertyRows.takenBy(rows, 'MEMO')?.key).toBe('Memo');
        expect(PropertyRows.takenBy(rows, 'memo')?.key).toBe('Memo');
    });

    it('answers a key a finding locks, and a draft\'s', () => {
        expect(PropertyRows.takenBy(rows, 'dup')?.locked).toBe(true);
        expect(PropertyRows.takenBy(rows, 'Area')?.own.kind).toBe('draft');
    });

    it('answers none for a key with no row', () => {
        expect(PropertyRows.takenBy(rows, 'other')).toBeUndefined();
    });
});
