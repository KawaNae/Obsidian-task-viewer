import type { PropertyScalar, PropertyValue } from '../../../types';
import type { FieldCodec, Read } from '../../../utils/values/Read';
import { readFail, readOk } from '../../../utils/values/Read';
import { PropertyLines } from './PropertyLines';
import { PropertyValues } from './PropertyValues';

/** A property's value that a line holds itself: any but a list, which its items hold. */
export type PropertyLineValue = Exclude<PropertyValue, { type: 'list' }>;

/**
 * A property's value typed in a field (the hub's value field, and the value
 * of the property to add): the space around it taken off, as a property
 * line's value is read (`PropertyLines`), and read as that line reads it
 * (`PropertyValues.fromText`), spelled as typed. Any text is a value;
 * nothing typed is no value (`- key::`).
 */
export const PropertyValueInput: FieldCodec<PropertyLineValue> = {
    read: (text) => readOk(PropertyValues.fromText(text.trim())),
    show: (value) => PropertyValues.spelling(value),
};

/**
 * An item of a property's list typed in a field (the hub's list): the space
 * around it taken off, as {@link PropertyValueInput} takes it off, and read
 * as the item a line holding it is read as (`PropertyLines.itemOf`), spelled
 * as typed. Refused when it is empty, or when a line holding it would not
 * read back as that one item: no value (`null`), a checkbox (`[ ] x`), a
 * property line's shape (`a:: b`).
 */
export const PropertyItemInput: FieldCodec<PropertyScalar> = {
    read(text: string): Read<PropertyScalar> {
        const spelled = text.trim();
        if (spelled === '') return readFail({ code: 'empty' });
        const item = PropertyLines.itemOf(spelled);
        return item ? readOk(item) : readFail({ code: 'notation', kind: 'listItem' });
    },
    show: (item) => item.spelling,
};
