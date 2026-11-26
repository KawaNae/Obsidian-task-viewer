import type { PropertyScalar, PropertyValue, Task } from '../../../types';
import { getEffectiveProperties } from '../../../services/data/EffectiveProperties';
import { PropertyKey } from '../../../services/parsing/utils/PropertyKey';
import { CascadeSource, type CascadeSourceKind } from '../CascadeSource';
import type { FindingField, HubFinding } from '../HubFindings';

/**
 * What the row's own lines say of a property.
 * - `none`: no line of its own
 * - `value`: one value (a text, a number, a boolean)
 * - `list`: a list, item by item
 * - `null`: no value (`- key::`, or one spelled, `- key:: null`)
 * - `draft`: no line yet, and an inherited list copied to be made its own,
 *   written by its first edit
 */
export type OwnSide =
    | { readonly kind: 'none' }
    | { readonly kind: 'value'; readonly value: PropertyScalar }
    | { readonly kind: 'list'; readonly items: readonly PropertyScalar[] }
    | { readonly kind: 'null'; readonly value: PropertyValue & { type: 'null' } }
    | { readonly kind: 'draft'; readonly items: readonly PropertyScalar[] };

/**
 * What the layers above give the row of a property (`cascadeContext`),
 * whether or not the row's own line wins over it: none, or the value
 * (no value included, which a layer above hides the one above it with)
 * and where it is written.
 */
export type InheritedSide =
    | { readonly kind: 'none' }
    | { readonly kind: 'value'; readonly value: PropertyValue; readonly source: CascadeSourceKind };

/**
 * A custom property's row in the hub. The two sides are kept apart: a row
 * that overrides an inherited value, or hides it with no value, is one
 * whose own side and inherited side both hold something.
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
    readonly own: OwnSide;
    readonly inherited: InheritedSide;
    /** A finding locks the property: nothing in the row is edited. */
    readonly locked: boolean;
}

/** What the rows are built from: no DOM, nothing of the form but what it read. */
export interface PropertyRowsInput {
    task: Task;
    /** Inherited lists made the row's own and not written yet, by key folded. */
    drafts: ReadonlyMap<string, readonly PropertyScalar[]>;
    /** The findings of the row's own property lines, as the form last read them. */
    findings: readonly HubFinding[];
    /** Whether a finding locks the field. */
    locked: (field: FindingField) => boolean;
}

/**
 * The field a row is edited or shown by.
 * - `text`: one text field showing `shown` as a line spells it. With
 *   `editsOwn` it edits the row's own value; else it shows the inherited
 *   one, which typed again is made the row's own
 * - `list`: an item a line (`PropertyListField`), edited when `editsOwn`
 * - `blank`: an empty field that takes nothing, for a locked row with no value
 */
export type PropertyRowField =
    | { readonly kind: 'text'; readonly shown: PropertyValue; readonly editsOwn: boolean }
    | { readonly kind: 'list'; readonly items: readonly PropertyScalar[]; readonly editsOwn: boolean }
    | { readonly kind: 'blank' };

/** What a row draws, besides its key. */
export interface PropertyRowForm {
    readonly field: PropertyRowField;
    /** Drawn as a value the row inherits and does not say itself. */
    readonly inheritedLook: boolean;
    /** Where the inherited value is written, said by a label that opens its line; null for none. */
    readonly source: CascadeSourceKind | null;
    /** The button that hides the inherited value with the row's own no value. */
    readonly hide: boolean;
    /** The button that copies the inherited list into a draft of the row's own. */
    readonly makeOwn: boolean;
    /**
     * The row's ×: `line` takes the row's own line out, `draft` throws the
     * draft away. An own list has none: it would stand beside the items' ×s
     * and look as theirs do.
     */
    readonly remove: 'line' | 'draft' | null;
}

const NONE = { kind: 'none' } as const;

/**
 * The hub's custom property rows: which there are, in which order, and what
 * each is. One place decides it, from the task, its drafts and its
 * findings; the group draws what it is given.
 */
export const PropertyRows = {
    /**
     * The rows, in the order of the values in effect (what is inherited
     * first, as the layers above give it, overridden in place; then the
     * row's own), then a locked row for each property a finding names that
     * has none.
     */
    of(input: PropertyRowsInput): PropertyRow[] {
        const { task, drafts, findings, locked } = input;
        const inherited = task.cascadeContext?.properties;
        const rows: PropertyRow[] = [];
        for (const [folded, { key }] of Object.entries(getEffectiveProperties(task))) {
            const above = PropertyKey.get(inherited, folded)?.value;
            rows.push({
                folded,
                key,
                own: ownSide(PropertyKey.get(task.properties, folded)?.value, drafts.get(folded)),
                inherited: above === undefined ? NONE : { kind: 'value', value: above, source: CascadeSource.forProperty(task, key) },
                locked: locked(`prop:${folded}`),
            });
        }
        for (const finding of findings) {
            if (!finding.field.startsWith('prop:')) continue;
            const folded = finding.field.slice('prop:'.length);
            if (rows.some(row => row.folded === folded)) continue;
            rows.push({ folded, key: finding.key, own: NONE, inherited: NONE, locked: true });
        }
        return rows;
    },

    /** What the row draws. */
    formOf(row: PropertyRow): PropertyRowForm {
        const { own, inherited } = row;
        const plain = { inheritedLook: false, source: null, hide: false, makeOwn: false } as const;
        switch (own.kind) {
            case 'value':
            case 'null':
                return { ...plain, field: { kind: 'text', shown: own.value, editsOwn: true }, remove: 'line' };
            case 'list':
                return { ...plain, field: { kind: 'list', items: own.items, editsOwn: true }, remove: null };
            case 'draft':
                return { ...plain, field: { kind: 'list', items: own.items, editsOwn: true }, remove: 'draft' };
            case 'none':
                break;
        }
        if (inherited.kind === 'none') return { ...plain, field: { kind: 'blank' }, remove: null };
        const shown = inherited.value;
        const from = { inheritedLook: true, source: inherited.source, remove: null } as const;
        if (shown.type === 'list') return { ...from, field: { kind: 'list', items: shown.items, editsOwn: false }, hide: true, makeOwn: true };
        // An inherited no value hides nothing more.
        return { ...from, field: { kind: 'text', shown, editsOwn: false }, hide: shown.type !== 'null', makeOwn: false };
    },

    /**
     * The row that already stands for the property `key`, its case aside:
     * one with a value of its own, an inherited one, no value, or a draft,
     * or one a finding locks. None when a row may be added for it.
     */
    takenBy(rows: readonly PropertyRow[], key: string): PropertyRow | undefined {
        const folded = PropertyKey.fold(key);
        return rows.find(row => row.folded === folded);
    },
};

function ownSide(value: PropertyValue | undefined, draft: readonly PropertyScalar[] | undefined): OwnSide {
    if (value === undefined) return draft ? { kind: 'draft', items: draft } : NONE;
    switch (value.type) {
        case 'list': return { kind: 'list', items: value.items };
        case 'null': return { kind: 'null', value };
        default: return { kind: 'value', value };
    }
}
