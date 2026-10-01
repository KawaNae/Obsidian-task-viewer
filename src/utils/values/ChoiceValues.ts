import { typed } from './Normalize';
import { readFail, readOk, type Read } from './Read';

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

/** One word out of a fixed set, matched as written. */
export const ChoiceInput = {
    of<const S extends string>(allowed: readonly S[]) {
        const set = new Set<string>(allowed);
        return {
            read(text: string): Read<S> {
                const t = typed(text);
                if (t === '') return readFail({ code: 'empty' });
                return set.has(t) ? readOk(t as S) : readFail({ code: 'oneOf', allowed });
            },
        };
    },
};
