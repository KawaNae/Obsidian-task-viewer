import { t } from '../../../i18n';
import type { PropertyScalar, PropertyValue, Task } from '../../../types';
import { getEffectiveProperties } from '../../../services/data/EffectiveProperties';
import { PropertyKey } from '../../../services/parsing/utils/PropertyKey';
import { PropertyItemInput } from '../../../services/parsing/utils/PropertyItemInput';
import { CascadeSource } from '../CascadeSource';
import type { FindingField, HubFinding } from '../HubFindings';
import {
    FieldKinds,
    FieldStates,
    type Emptied,
    type FieldLook,
    type FieldMenuModel,
    type FieldState,
    type InheritedSide,
    type OwnSide,
} from './FieldState';

/**
 * A custom property's row in the hub: its field's state, the row's own
 * side and what the layers above give it kept apart (`FieldState`). A row
 * that overrides an inherited value, or hides it with no value, is one
 * whose two sides both hold something. A list is a value.
 *
 * A row with neither is a property a finding locks and that has no value to
 * show (a key written twice, nothing inherited): it stands so that what is
 * wrong is said where the property would be.
 */
export interface PropertyRow {
    /** The key folded: what the row is looked up by. */
    readonly folded: string;
    /** The key as the row shows it: as the layer whose value wins writes it, or as a finding names it. */
    readonly key: string;
    readonly state: FieldState<PropertyValue>;
    /** A finding locks the property: nothing in the row is edited. */
    readonly locked: boolean;
}

/** What the rows are built from: no DOM, nothing of the form but what it read. */
export interface PropertyRowsInput {
    task: Task;
    /** The findings of the row's own property lines, as the form last read them. */
    findings: readonly HubFinding[];
    /** Whether a finding locks the field. */
    locked: (field: FindingField) => boolean;
}

/**
 * The field a row is edited or shown by.
 * - `text`: one text field, holding the row's own value as a line spells it
 *   (none for no value of its own: what it is given shows faintly)
 * - `list`: an item a line (`PropertyListField`): the row's own items,
 *   edited, or the inherited ones, shown (`editsOwn` false)
 * - `blank`: an empty field that takes nothing, for a locked row with no value
 */
export type PropertyRowField =
    | { readonly kind: 'text'; readonly value: PropertyValue | undefined }
    | { readonly kind: 'list'; readonly items: readonly PropertyScalar[]; readonly editsOwn: boolean }
    | { readonly kind: 'blank' };

/**
 * A conversion of the row's own value, an item of its menu besides those
 * of every field (`FieldStates.menu`), with the value it writes.
 * - `toList`: the row's own value as a list of it alone
 * - `toSingleValue`: the one item of the row's own list as its value
 */
export interface PropertyConversion {
    readonly action: 'toList' | 'toSingleValue';
    readonly writes: PropertyValue;
}

/** A row's menu: the type of the value it shows (a greyed line at its head; none for no value), and what every field's menu holds. */
export interface PropertyMenu {
    readonly type: Exclude<PropertyValue['type'], 'null'> | null;
    readonly menu: FieldMenuModel<PropertyConversion>;
}

/** What a row's menu is built from besides the row. */
export interface PropertyMenuInput {
    /** Whether the hub has a line of the note to open (none while the task is moved, or for a task to make). */
    readonly opensSource: boolean;
}

const NONE = { kind: 'none' } as const;

/**
 * The hub's custom property rows: which there are, in which order, and what
 * each is. One place decides it, from the task and its findings; the
 * group draws what it is given.
 */
export const PropertyRows = {
    /**
     * The rows, in the order of the values in effect (what is inherited
     * first, as the layers above give it, overridden in place; then the
     * row's own), then a locked row for each property a finding names that
     * has none.
     */
    of(input: PropertyRowsInput): PropertyRow[] {
        const { task, findings, locked } = input;
        const inherited = task.cascadeContext?.properties;
        const rows: PropertyRow[] = [];
        for (const [folded, { key }] of Object.entries(getEffectiveProperties(task))) {
            const above = PropertyKey.get(inherited, folded)?.value;
            rows.push({
                folded,
                key,
                state: { own: ownSide(PropertyKey.get(task.properties, folded)?.value), inherited: inheritedSide(task, key, above) },
                locked: locked(`prop:${folded}`),
            });
        }
        for (const finding of findings) {
            if (!finding.field.startsWith('prop:')) continue;
            const folded = finding.field.slice('prop:'.length);
            if (rows.some(row => row.folded === folded)) continue;
            rows.push({ folded, key: finding.key, state: { own: NONE, inherited: NONE }, locked: true });
        }
        return rows;
    },

    /** The field the row is edited or shown by. */
    fieldOf(row: PropertyRow): PropertyRowField {
        const { own, inherited } = row.state;
        if (own.kind === 'value') {
            return own.value.type === 'list' ? { kind: 'list', items: own.value.items, editsOwn: true } : { kind: 'text', value: own.value };
        }
        if (own.kind === 'none' && inherited.kind === 'value' && inherited.value.type === 'list') {
            return { kind: 'list', items: inherited.value.items, editsOwn: false };
        }
        if (own.kind === 'none' && inherited.kind === 'none') return { kind: 'blank' };
        return { kind: 'text', value: undefined };
    },

    /** The row's look (`FieldStates.look`): a value hidden, or inherited, spelled as a line spells it, a list's items joined. */
    lookOf(row: PropertyRow): FieldLook {
        return FieldStates.look(row.state, FieldKinds.property, spellingOf);
    },

    /**
     * The row's menu: the type of the value shown at its head, then every
     * field's menu (`FieldStates.menu`), the row's conversions after the
     * inherited value's line. A locked row has none, and draws no menu button.
     */
    menuOf(row: PropertyRow, input: PropertyMenuInput): PropertyMenu {
        if (row.locked) return { type: null, menu: { source: null, items: [] } };
        const { own } = row.state;
        const conversions: PropertyConversion[] = [];
        // A value converts to a list of it alone only where a line holding
        // it reads back as that one item: a value no item spells (`[ ] x`,
        // `a:: b`) is left out.
        if (own.kind === 'value' && own.value.type !== 'list') {
            const item = PropertyItemInput.read(own.value.spelling);
            if (item.ok) conversions.push({ action: 'toList', writes: { type: 'list', items: [item.value] } });
        }
        if (own.kind === 'value' && own.value.type === 'list' && own.value.items.length === 1) {
            conversions.push({ action: 'toSingleValue', writes: own.value.items[0] });
        }
        return {
            type: typeShown(row),
            menu: FieldStates.menu(row.state, FieldKinds.property, { opensSource: input.opensSource, kindItems: conversions }),
        };
    },

    /** What emptying the row's field writes (taking the last item of its list out included). */
    emptiedOf(row: PropertyRow): Emptied {
        return FieldStates.emptied(row.state, FieldKinds.property);
    },

    /**
     * The row that already stands for the property `key`, its case aside:
     * one with a value of its own, an inherited one, or no value, or one a
     * finding locks. None when a row may be added for it.
     */
    takenBy(rows: readonly PropertyRow[], key: string): PropertyRow | undefined {
        const folded = PropertyKey.fold(key);
        return rows.find(row => row.folded === folded);
    },
};

/** The type of the value the row shows: its own, else the inherited one. None for no value, its own or an inherited one, or none at all. */
function typeShown(row: PropertyRow): Exclude<PropertyValue['type'], 'null'> | null {
    const { own, inherited } = row.state;
    if (own.kind === 'value') return own.value.type === 'null' ? null : own.value.type;
    if (own.kind === 'noValue') return null;
    return inherited.kind === 'value' && inherited.value.type !== 'null' ? inherited.value.type : null;
}

/** A value hidden, or inherited, as the field's faint text shows it: as a line spells it, a list's items joined. */
function spellingOf(value: PropertyValue): string {
    if (value.type === 'list') return value.items.map(item => item.spelling).join(t('modal.hub.itemJoin'));
    return value.spelling;
}

/** What the row's own line says: no value for `- key::`, and for one spelled `- key:: null`. */
function ownSide(value: PropertyValue | undefined): OwnSide<PropertyValue> {
    if (value === undefined) return NONE;
    return value.type === 'null' ? { kind: 'noValue' } : { kind: 'value', value };
}

/** What the layers above give the row: a value, or no value (a layer above hiding the one above it). */
function inheritedSide(task: Task, key: string, above: PropertyValue | undefined): InheritedSide<PropertyValue> {
    if (above === undefined) return NONE;
    const source = CascadeSource.forProperty(task, key);
    return above.type === 'null' ? { kind: 'noValue', source } : { kind: 'value', value: above, source };
}
