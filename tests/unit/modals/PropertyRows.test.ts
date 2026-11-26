import { describe, it, expect } from 'vitest';
import { PropertyRows, type PropertyRowsInput } from '../../../src/modals/hub/fields/PropertyRows';
import type { HubFinding } from '../../../src/modals/hub/HubFindings';
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
    /** A menu of `actions`, none greyed. */
    const menu = (...actions: string[]) => actions.map(action => ({ action, disabled: false }));

    it.each([
        {
            name: 'its own text value',
            task: taskOf({ memo: text('a') }),
            own: { kind: 'value', value: text('a') }, inherited: { kind: 'none' },
            form: { ...plain, field: textField(text('a'), true) },
            menu: menu('remove'),
        },
        {
            name: 'its own list',
            task: taskOf({ memo: list('a', 'b') }),
            own: { kind: 'list', items: [text('a'), text('b')] }, inherited: { kind: 'none' },
            form: { ...plain, field: { kind: 'list', items: [text('a'), text('b')], editsOwn: true } },
            menu: menu('noValue', 'remove'),
        },
        {
            name: 'its own no value, nothing inherited: "no value", no mark',
            task: taskOf({ memo: none }),
            own: { kind: 'null', value: none }, inherited: { kind: 'none' },
            form: { ...plain, field: textField(none, true, 'No value') },
            menu: menu('remove'),
        },
        {
            name: 'an inherited text value alone',
            task: taskOf({}, { memo: text('a') }),
            own: { kind: 'none' }, inherited: { kind: 'value', value: text('a'), source: 'section' },
            form: { ...inheritedLook, field: textField(text('a'), false) },
            menu: menu('openSource'),
        },
        {
            name: 'an inherited list alone',
            task: taskOf({}, { memo: list('a') }),
            own: { kind: 'none' }, inherited: { kind: 'value', value: list('a'), source: 'section' },
            form: { ...inheritedLook, field: { kind: 'list', items: [text('a')], editsOwn: false } },
            menu: menu('openSource', 'makeOwn', 'noValue'),
        },
        {
            name: 'an inherited no value alone: drawn as an inherited text value',
            task: taskOf({}, { memo: none }),
            own: { kind: 'none' }, inherited: { kind: 'value', value: none, source: 'section' },
            form: { ...inheritedLook, field: textField(none, false, 'No value') },
            menu: menu('openSource'),
        },
        {
            name: 'its own text value over an inherited list',
            task: taskOf({ memo: text('b') }, { memo: list('a') }),
            own: { kind: 'value', value: text('b') }, inherited: { kind: 'value', value: list('a'), source: 'section' },
            form: { ...plain, field: textField(text('b'), true) },
            menu: menu('openSource', 'revert'),
        },
        {
            name: 'its own list over an inherited text value',
            task: taskOf({ memo: list('b') }, { memo: text('a') }),
            own: { kind: 'list', items: [text('b')] }, inherited: { kind: 'value', value: text('a'), source: 'section' },
            form: { ...plain, field: { kind: 'list', items: [text('b')], editsOwn: true } },
            menu: menu('openSource', 'noValue', 'revert'),
        },
        {
            name: 'its own no value hiding an inherited text value: the value struck through',
            task: taskOf({ memo: none }, { memo: text('a') }),
            own: { kind: 'null', value: none }, inherited: { kind: 'value', value: text('a'), source: 'section' },
            form: { inheritedLook: false, mark: 'hiding', field: textField(none, true, 'a', true) },
            menu: menu('openSource', 'revert'),
        },
        {
            name: 'its own no value hiding an inherited list: the items joined, struck through',
            task: taskOf({ memo: none }, { memo: list('a', 'b') }),
            own: { kind: 'null', value: none }, inherited: { kind: 'value', value: list('a', 'b'), source: 'section' },
            form: { inheritedLook: false, mark: 'hiding', field: textField(none, true, 'a, b', true) },
            menu: menu('openSource', 'revert'),
        },
        {
            name: 'its own no value hiding an inherited no value: "no value", not struck',
            task: taskOf({ memo: none }, { memo: none }),
            own: { kind: 'null', value: none }, inherited: { kind: 'value', value: none, source: 'section' },
            form: { inheritedLook: false, mark: 'hiding', field: textField(none, true, 'No value') },
            menu: menu('openSource', 'revert'),
        },
    ])('$name', ({ task, own, inherited, form, menu: items }) => {
        const got = only(task);
        expect(got.row).toEqual({ folded: 'memo', key: 'memo', own, inherited, locked: false });
        expect(got.form).toEqual(form);
        expect(PropertyRows.menuOf(got.row, { opensSource: true })).toEqual(items);
    });

    it('an inherited list copied as a draft: edited as its own, as an own list over it is, the draft thrown away by revert', () => {
        const got = only(taskOf({}, { memo: list('a') }), { drafts: new Map([['memo', [text('a')]]]) });
        expect(got.row.own).toEqual({ kind: 'draft', items: [text('a')] });
        expect(got.row.inherited).toEqual({ kind: 'value', value: list('a'), source: 'section' });
        expect(got.form).toEqual({ ...plain, field: { kind: 'list', items: [text('a')], editsOwn: true } });
        expect(PropertyRows.menuOf(got.row, { opensSource: true })).toEqual(menu('openSource', 'noValue', 'revert'));
    });

    it('greys the inherited line\'s item where the hub has no line to open, the menu keeping its shape', () => {
        for (const inherited of [text('a'), list('a'), none]) {
            for (const own of [{}, { memo: text('b') }, { memo: none }] as Record<string, PropertyValue>[]) {
                const { row } = only(taskOf(own, { memo: inherited }));
                const opens = PropertyRows.menuOf(row, { opensSource: true });
                const greyed = PropertyRows.menuOf(row, { opensSource: false });
                expect(greyed).toEqual([{ action: 'openSource', disabled: true }, ...opens.slice(1)]);
            }
        }
        expect(PropertyRows.menuOf(only(taskOf({ memo: text('a') })).row, { opensSource: false })).toEqual(menu('remove'));
    });

    it('a draft is no row\'s once the row has a value of its own', () => {
        const got = only(taskOf({ memo: list('b') }, { memo: list('a') }), { drafts: new Map([['memo', [text('a')]]]) });
        expect(got.row.own).toEqual({ kind: 'list', items: [text('b')] });
    });

    it('a row with a value a finding locks: what it is stays, and it is locked', () => {
        const got = only(taskOf({ memo: text('a') }), { locked: (field) => field === 'prop:memo', findings: [finding('memo')] });
        expect(got.row).toMatchObject({ own: { kind: 'value' }, locked: true });
        expect(got.form.field).toEqual({ kind: 'text', shown: text('a'), editsOwn: true, placeholder: '', struck: false });
        expect(PropertyRows.menuOf(got.row, { opensSource: true })).toEqual([]);
    });

    it('a property a finding names with no value: one locked row with a blank field, under the key the finding names', () => {
        const rows = rowsOf(taskOf({}), { locked: () => true, findings: [finding('Dup'), finding('dup'), finding('Color', 'color')] });
        expect(rows).toEqual([{ folded: 'dup', key: 'Dup', own: { kind: 'none' }, inherited: { kind: 'none' }, locked: true }]);
        expect(PropertyRows.formOf(rows[0])).toEqual({ ...plain, field: { kind: 'blank' } });
        expect(PropertyRows.menuOf(rows[0], { opensSource: true })).toEqual([]);
    });

    it('rows in the order of the values in effect, the key as the winning layer writes it, then the findings\' rows', () => {
        const task = taskOf({ C: text('c'), B: text('b2') }, { a: text('a'), b: text('b') });
        const rows = rowsOf(task, { findings: [finding('Dup'), finding('a')] });
        expect(rows.map(row => [row.folded, row.key])).toEqual([['a', 'a'], ['b', 'B'], ['c', 'C'], ['dup', 'Dup']]);
    });

    it('says where an inherited value is written', () => {
        const task = taskOf({}, { memo: text('a') }, {
            inheritedFrom: { fields: {}, tags: [], properties: { memo: { kind: 'frontmatter', line: 1 } } },
        });
        expect(only(task).row.inherited).toEqual({ kind: 'value', value: text('a'), source: 'file' });
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
