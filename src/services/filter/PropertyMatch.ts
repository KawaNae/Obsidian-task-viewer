import type { PropertyScalar, PropertyValue } from '../../types';
import { PropertyValues } from '../parsing/utils/PropertyValues';

/** A condition's value, typed: a scalar, or no value; a line writes no list. */
export type PropertyQuery = ReturnType<typeof PropertyValues.fromText>;

/**
 * How a property condition (`key:: value`) compares a task's value with the
 * value the condition gives, by the value's type.
 *
 * The condition's value is read as a property line reads its value
 * (`PropertyValues.fromText`), so it has a type too: `123` is a number,
 * `true` a boolean, `"123"` (in quotes) the text `123`.
 *
 * - `equals`: two numbers, or two booleans, are compared as values (`1` is
 *   `1.0`, `True` is `true`). A text is compared as text, without the
 *   quotes it was written in and its case aside. A number or a boolean the
 *   condition gives unquoted names the text of its spelling too, so `123`
 *   finds the number 123 and the text `"123"`; quoted, it is text only and
 *   finds the text alone.
 * - `contains`: the text, its case aside, is in the value as it is shown: a
 *   text without its quotes, a number or a boolean as spelled (`contains 1`
 *   finds `10` and `0x1F`). A value quoted in the condition looks in texts
 *   only.
 * - A list is compared item by item: it equals, or contains, when one of
 *   its items does. An empty list has no item to.
 * - No value (`null`) equals and contains nothing: it is what `isSet` is
 *   not. A condition's value that reads as no value (empty, `null`, `~`)
 *   is the text of its spelling, so `equals null` finds the text `"null"`.
 */
export const PropertyMatch = {
    /** The condition's value, typed as a line types it. */
    query(text: string): PropertyQuery {
        return PropertyValues.fromText(text);
    },

    /** Whether the property has a value: it is there, and is not `null` (`""` and an empty list are values). */
    isSet(value: PropertyValue | undefined): boolean {
        return value !== undefined && value.type !== 'null';
    },

    /** Whether the value, or one of its items, equals `query`. */
    equals(value: PropertyValue | undefined, query: PropertyQuery): boolean {
        return itemsOf(value).some(item => equalsItem(item, query));
    },

    /** Whether the value, or one of its items, contains `query`. */
    contains(value: PropertyValue | undefined, query: PropertyQuery): boolean {
        return itemsOf(value).some(item => containsItem(item, query));
    },
};

/** The scalars a value is compared by: a list's items, a scalar itself, nothing for no value. */
function itemsOf(value: PropertyValue | undefined): readonly PropertyScalar[] {
    if (value === undefined || value.type === 'null') return [];
    return value.type === 'list' ? value.items : [value];
}

/** Whether the condition's value was quoted, which makes it text and nothing else. */
function isQuotedText(query: PropertyQuery): boolean {
    return query.type === 'text' && query.spelling !== query.text;
}

/** The condition's value as text: a quoted text without its quotes, anything else as spelled. */
function textOf(query: PropertyQuery): string {
    return query.type === 'text' ? query.text : query.spelling;
}

const fold = (text: string): string => text.toLowerCase();

function equalsItem(item: PropertyScalar, query: PropertyQuery): boolean {
    switch (item.type) {
        case 'text':
            return fold(item.text) === fold(textOf(query));
        case 'number':
            return query.type === 'number' && sameNumber(item.number, query.number);
        case 'boolean':
            return query.type === 'boolean' && item.boolean === query.boolean;
    }
}

function containsItem(item: PropertyScalar, query: PropertyQuery): boolean {
    if (item.type !== 'text' && isQuotedText(query)) return false;
    return fold(PropertyValues.display(item)).includes(fold(textOf(query)));
}

/** Two numbers as values: `.nan` is `.nan`, as YAML writes them alike. */
function sameNumber(a: number, b: number): boolean {
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
}
