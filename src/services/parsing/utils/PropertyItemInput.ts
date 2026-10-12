import type { PropertyScalar } from '../../../types';
import type { FieldCodec, Read } from '../../../utils/values/Read';
import { readFail, readOk } from '../../../utils/values/Read';
import { PropertyLines } from './PropertyLines';

/**
 * An item of a property's list typed in a field (the hub's list): the space
 * around it taken off, and read as the item a line holding it is read as
 * (`PropertyLines.itemOf`), spelled as typed. Refused when it is empty, or
 * when a line holding it would not read back as that one item: no value
 * (`null`), a checkbox (`[ ] x`), a property line's shape (`a:: b`).
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
