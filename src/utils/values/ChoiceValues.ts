import { typed } from './Normalize';
import { readFail, readOk, type FieldCodec, type Read } from './Read';

/** `true` or `false`, as written. */
export const BoolInput = {
    read(text: string): Read<boolean> {
        const t = typed(text);
        if (t === '') return readFail({ code: 'empty' });
        if (t === 'true') return readOk(true);
        if (t === 'false') return readOk(false);
        return readFail({ code: 'shape', kind: 'bool' });
    },
};

/**
 * One word out of a fixed set, matched as written; with `caseless`, matched
 * in any case and given back as the set spells it (`Dashed` is `dashed`).
 */
export const ChoiceInput = {
    of<const S extends string>(allowed: readonly S[], opts: { caseless?: boolean } = {}): FieldCodec<S> {
        const fold = (word: string) => (opts.caseless ? word.toLowerCase() : word);
        const byWord = new Map<string, S>(allowed.map(word => [fold(word), word]));
        return {
            read(text: string): Read<S> {
                const t = typed(text);
                if (t === '') return readFail({ code: 'empty' });
                const word = byWord.get(fold(t));
                return word !== undefined ? readOk(word) : readFail({ code: 'oneOf', allowed });
            },
            show: (word) => word,
        };
    },
};
