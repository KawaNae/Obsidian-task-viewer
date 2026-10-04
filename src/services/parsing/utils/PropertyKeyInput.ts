import type { ScopeKeys } from '../../../types';
import type { FieldCodec, Read } from '../../../utils/values/Read';
import { readFail, readOk } from '../../../utils/values/Read';
import { reservedPropertyKeys } from './FrontmatterPolicy';

/**
 * The characters a property's key cannot hold: the property line
 * (`- key:: value`, `ChildLineClassifier.PROPERTY_LINE`) reads a key up to
 * its first `:`, and none with `[` or `]`.
 */
const NOT_IN_KEY = /[:[\]]/g;

/**
 * A property's key typed in a field (the hub's new property): the space
 * around it taken off, and refused when the property line would not read it
 * as the key (`:`, `[`, `]`), or when the plugin keeps it for itself
 * (`reservedPropertyKeys`: the scope keys, `tags`).
 */
export const PropertyKeyInput = {
    of(scopeKeys: ScopeKeys): FieldCodec<string> {
        const reserved = reservedPropertyKeys(scopeKeys);
        return {
            read(text: string): Read<string> {
                const key = text.trim();
                if (key === '') return readFail({ code: 'empty' });
                const bad = [...new Set(key.match(NOT_IN_KEY) ?? [])];
                if (bad.length > 0) return readFail({ code: 'chars', chars: bad.join(' ') });
                return reserved.has(key) ? readFail({ code: 'reserved' }) : readOk(key);
            },
            show: (key) => key,
        };
    },
};
