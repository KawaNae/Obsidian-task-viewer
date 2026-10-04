import { readFail, readOk, type FieldCodec, type Read } from './Read';

/**
 * Text whose characters are the value: a name, a property's value. It is
 * not normalized (`typed` is for structured values); only the space around
 * it is taken off.
 */

/** A name that must be given: the space around it taken off, nothing left refused. */
export const TextInput: FieldCodec<string> = {
    read(text: string): Read<string> {
        const t = text.trim();
        return t === '' ? readFail({ code: 'empty' }) : readOk(t);
    },
    show: (text) => text,
};

/** Text as typed, empty or not: what a free field holds (a property's value, a mask). */
export const FreeText: FieldCodec<string> = {
    read: (text) => readOk(text),
    show: (text) => text,
};
