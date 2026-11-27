import type { Task } from '../../../types';
import { CascadeSource, type CascadeSourceKind } from '../CascadeSource';

/**
 * What a field's own line says.
 * - `none`: no line of its own
 * - `value`: a value
 * - `noValue`: no value (`- tv-color::`, `- key::`), which hides what the layers above give
 */
export type OwnSide<V> =
    | { readonly kind: 'none' }
    | { readonly kind: 'value'; readonly value: V }
    | { readonly kind: 'noValue' };

/**
 * What the layers above give the field, whether or not its own line wins
 * over it: none, a value, or no value (a layer above hides the one above
 * it), and where that is written.
 */
export type InheritedSide<V> =
    | { readonly kind: 'none' }
    | { readonly kind: 'value'; readonly value: V; readonly source: CascadeSourceKind }
    | { readonly kind: 'noValue'; readonly source: CascadeSourceKind };

/**
 * A field of the hub, as its two sides are. What the field looks like, what
 * its menu offers and what emptying it writes are read of this alone, and of
 * the kind of the field ({@link FieldKind}), by {@link FieldStates}: every
 * field of a value (the dates and times, the due, the color, the line style,
 * the mask, the custom properties) goes by the one table.
 */
export interface FieldState<V> {
    readonly own: OwnSide<V>;
    readonly inherited: InheritedSide<V>;
}

/** What tells the kinds of field apart, of what the table decides. */
export interface FieldKind {
    /** Whether the field's own line may say no value. A date has no way of saying it. */
    readonly canHide: boolean;
    /**
     * Whether the field's key is always there: a built-in's is, written or
     * not, so that emptying it takes its line out; a custom property's is
     * there while a line says it.
     */
    readonly keyAlways: boolean;
    /**
     * For a field that is one part of a value another field shares (the
     * due's date, and its time): which part. Its items reach the whole value,
     * but for the time's `clearValue`, which empties the time alone, as the
     * start's time field does.
     */
    readonly part?: 'date' | 'time';
}

export const FieldKinds = {
    /** A start's or an end's date, or its time: each a value of its own. */
    date: { canHide: false, keyAlways: true },
    dueDate: { canHide: false, keyAlways: true, part: 'date' },
    dueTime: { canHide: false, keyAlways: true, part: 'time' },
    /** The color, the line style, the mask. */
    style: { canHide: true, keyAlways: true },
    /** A custom property, a list's included. */
    property: { canHide: true, keyAlways: false },
} as const satisfies Record<string, FieldKind>;

/**
 * What a field's faint text shows while nothing is typed in it.
 * - `value`: the inherited value
 * - `noValue`: no value: the field's own, or the layers above's
 * - `struck`: the inherited value the field's own no value hides, struck through
 * - null: what the kind shows of its own (a date the rules fill in, a format)
 */
export type FieldFaint =
    | { readonly kind: 'value'; readonly text: string }
    | { readonly kind: 'noValue' }
    | { readonly kind: 'struck'; readonly text: string }
    | null;

/** A field's look: its frame (solid for what the field says itself, dashed for what it is given), and its faint text. */
export interface FieldLook {
    readonly frame: 'own' | 'inherited';
    readonly faint: FieldFaint;
}

/**
 * The names of the one act of taking the field's own line out, told apart
 * by what is seen once it is out.
 * - `clearValue`: the value, nothing inherited coming through (a built-in's key stays)
 * - `deleteKey`: the key, a custom property's, with nothing inherited to come through
 * - `clearToInherited`: the value, what is inherited coming through
 * - `followInherited`: the own no value, the value it hid coming through
 */
export type DropName = 'clearValue' | 'clearToInherited' | 'followInherited' | 'deleteKey';

/**
 * An item of a field's menu.
 * - `openSource`: open the line the inherited value is written on; greyed
 *   (`disabled`) where the hub has no line of the note to open
 * - `dropOwn`: take the field's own line out. `reach` is what it takes out:
 *   the whole `value` the field is a part of, or the `field` alone
 * - `noValue`: write the field's own no value, which hides the inherited value
 * - `writeInherited`: write the inherited value as the field's own
 */
export type FieldAction =
    | { readonly action: 'openSource'; readonly disabled: boolean }
    | { readonly action: 'dropOwn'; readonly name: DropName; readonly reach: 'value' | 'field' }
    | { readonly action: 'noValue' }
    | { readonly action: 'writeInherited' };

/** A field's menu: where its inherited value is written (the greyed line at its head), then its items. */
export interface FieldMenuModel<X = never> {
    readonly source: CascadeSourceKind | null;
    readonly items: readonly (FieldAction | X)[];
}

/**
 * What emptying a field and committing it writes (taking the last item of a
 * list out included).
 * - `dropOwn`: take the field's own line out: the inherited value, if any, shows
 * - `noValue`: write no value, the key kept (a custom property with nothing inherited)
 * - `nothing`: nothing: the field has no value of its own to empty
 */
export type Emptied = 'dropOwn' | 'noValue' | 'nothing';

/** The hub's date fields: the start's, the end's, and the due's date and time. */
export type DateFieldKey = 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'dueDate' | 'dueTime';

export type StyleField = 'color' | 'linestyle' | 'mask';

const NONE = { kind: 'none' } as const;

export const FieldStates = {
    /**
     * The look of the field. A field with a value of its own shows it, framed
     * solid, its faint text what emptying it would show. One with none shows
     * what it inherits, framed dashed, or nothing. One whose own no value
     * hides an inherited value shows that value struck through.
     *
     * @param spell the value as the faint text writes it
     * @param fills whether the kind fills a value of its own in where none is
     *   stated (a date the rules fill from the others). Under a layer that
     *   says no value, that value shows as the kind's own, framed solid, in
     *   place of the inherited no value
     */
    look<V>(state: FieldState<V>, kind: FieldKind, spell: (value: V) => string, fills = false): FieldLook {
        const { own, inherited } = state;
        if (own.kind === 'value') {
            return { frame: 'own', faint: FieldStates.look(emptiedState(state, kind), kind, spell, fills).faint };
        }
        if (own.kind === 'noValue') {
            return { frame: 'own', faint: inherited.kind === 'value' ? { kind: 'struck', text: spell(inherited.value) } : { kind: 'noValue' } };
        }
        switch (inherited.kind) {
            case 'value': return { frame: 'inherited', faint: { kind: 'value', text: spell(inherited.value) } };
            case 'noValue': return fills ? { frame: 'own', faint: null } : { frame: 'inherited', faint: { kind: 'noValue' } };
            case 'none': return { frame: 'own', faint: null };
        }
    },

    /**
     * The field's menu. Its head says where the inherited value is written,
     * for a field the layers above give a value or no value, whether or not
     * its own line wins over it. Its items, in this order: the inherited
     * value's line, the kind's own items (`kindItems`: a custom property's
     * conversions), the inherited value written as the field's own, no value,
     * then the field's own line taken out. One state shows one name of
     * taking it out. A field with neither side has no item, and shows no
     * menu button.
     */
    menu<V, X = never>(state: FieldState<V>, kind: FieldKind, opts: { opensSource: boolean; kindItems?: readonly X[] }): FieldMenuModel<X> {
        const { own, inherited } = state;
        const items: (FieldAction | X)[] = [];
        const source = inherited.kind === 'none' ? null : inherited.source;
        if (source !== null) items.push({ action: 'openSource', disabled: !opts.opensSource });
        items.push(...(opts.kindItems ?? []));
        if (own.kind === 'none' && inherited.kind === 'value') items.push({ action: 'writeInherited' });
        // No value is offered only where there is an inherited value for it to hide.
        if (kind.canHide && own.kind !== 'noValue' && inherited.kind === 'value') items.push({ action: 'noValue' });
        const name = dropName(state, kind);
        if (name) items.push({ action: 'dropOwn', name, reach: kind.part === 'time' && name === 'clearValue' ? 'field' : 'value' });
        return { source, items };
    },

    /**
     * What emptying the field writes. A built-in's own line is taken out:
     * its key is always there. A custom property's is taken out where the
     * layers above give its key, a value or no value; with nothing above, the
     * key is kept with no value. A field with no value of its own writes
     * nothing: there is nothing in it to empty.
     */
    emptied<V>(state: FieldState<V>, kind: FieldKind): Emptied {
        if (state.own.kind !== 'value') return 'nothing';
        if (kind.keyAlways || state.inherited.kind !== 'none') return 'dropOwn';
        return 'noValue';
    },

    /**
     * A date field of the task. The start's and the end's dates and times
     * are each a value of their own; the due's date and time are one, `due`,
     * which both fields stand for. An own due with no time leaves its time
     * field with nothing of its own, and nothing it inherits comes through:
     * the field has nothing in it, as one of a task with no due.
     */
    ofDate(task: Task, key: DateFieldKey): FieldState<string> {
        const field = key === 'dueDate' || key === 'dueTime' ? 'due' : key;
        const ownValue = task[field] || undefined;
        const state: FieldState<string> = {
            own: ownValue === undefined ? NONE : { kind: 'value', value: ownValue },
            inherited: inheritedOf(task, field),
        };
        if (key === 'dueTime' && ownValue !== undefined && !ownValue.includes('T') && state.inherited.kind === 'none') {
            return { own: NONE, inherited: NONE };
        }
        return state;
    },

    /** The color, the line style or the mask of the task. */
    ofStyle(task: Task, field: StyleField): FieldState<string> {
        const ownValue = task[field];
        return {
            own: ownValue === undefined ? NONE : ownValue === null ? { kind: 'noValue' } : { kind: 'value', value: ownValue },
            inherited: inheritedOf(task, field),
        };
    },
};

/** The name of taking the field's own line out, by what is seen once it is out; none for a field with no line of its own. */
function dropName<V>(state: FieldState<V>, kind: FieldKind): DropName | null {
    const { own, inherited } = state;
    if (own.kind === 'none') return null;
    if (inherited.kind !== 'none') return own.kind === 'value' ? 'clearToInherited' : 'followInherited';
    return own.kind === 'value' && kind.keyAlways ? 'clearValue' : 'deleteKey';
}

/** The field as emptying it leaves it. */
function emptiedState<V>(state: FieldState<V>, kind: FieldKind): FieldState<V> {
    switch (FieldStates.emptied(state, kind)) {
        case 'dropOwn': return { own: NONE, inherited: state.inherited };
        case 'noValue': return { own: { kind: 'noValue' }, inherited: state.inherited };
        case 'nothing': return state;
    }
}

/**
 * What the layers above give a built-in: its value (`cascadeContext`), or,
 * with none there, no value where a layer is recorded for it
 * (`inheritedFrom`: a layer above hides it with `- tv-color::`).
 */
function inheritedOf(task: Task, field: StyleField | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'due'): InheritedSide<string> {
    const value = task.cascadeContext?.[field];
    const source = CascadeSource.forField(task, field);
    if (value) return { kind: 'value', value, source: source ?? 'section' };
    return source === null ? NONE : { kind: 'noValue', source };
}
