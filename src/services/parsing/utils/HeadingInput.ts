import type { FieldCodec, Read } from '../../../utils/values/Read';
import { readFail, readOk } from '../../../utils/values/Read';

/**
 * A heading's name typed in a field (the settings' task heading): the space
 * around it taken off, not empty, and without the heading's mark (`#`)
 * before it. The mark is the line's, written at the level the heading is
 * made at; and the name is looked up as a link to it is (`headingKey`), by
 * the name alone.
 */
export const HeadingInput: FieldCodec<string> = {
    read(text: string): Read<string> {
        const name = text.trim();
        if (name === '') return readFail({ code: 'empty' });
        if (name.startsWith('#')) return readFail({ code: 'notation', kind: 'headingMark' });
        return readOk(name);
    },
    show: (name) => name,
};
