import type { ScopeKeys } from '../../../types';
import type { FieldCodec, Read } from '../../../utils/values/Read';
import { readFail, readOk } from '../../../utils/values/Read';
import { KEYS_NOT_SCOPE, reservedPropertyKeys } from './FrontmatterPolicy';

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
                const key = readKey(text);
                if (!key.ok) return key;
                return reserved.has(key.value) ? readFail({ code: 'reserved' }) : key;
            },
            show: (key) => key,
        };
    },
};

/**
 * One scope key typed in the settings (`ScopeKeys`): a key a property line
 * reads (as {@link PropertyKeyInput}), none of the keys reserved apart from
 * the scope keys (`KEYS_NOT_SCOPE`: `tags`, `position`, the file task's), and
 * none of the other scope keys (`others`), which it would stand for too.
 */
export const ScopeKeyInput = {
    read(text: string, others: Iterable<string>): Read<string> {
        const key = readKey(text);
        if (!key.ok) return key;
        if (KEYS_NOT_SCOPE.has(key.value)) return readFail({ code: 'reserved' });
        for (const other of others) {
            if (other === key.value) return readFail({ code: 'duplicate' });
        }
        return key;
    },
    /** The reading of a field of one scope key; `others` answers the other keys as they are when it reads. */
    codec(others: () => Iterable<string>): FieldCodec<string> {
        return { read: (text) => ScopeKeyInput.read(text, others()), show: (key) => key };
    },
};

/** A key a property line reads: the space around it taken off, not empty, none of `:`, `[`, `]`. */
function readKey(text: string): Read<string> {
    const key = text.trim();
    if (key === '') return readFail({ code: 'empty' });
    const bad = [...new Set(key.match(NOT_IN_KEY) ?? [])];
    return bad.length > 0 ? readFail({ code: 'chars', chars: bad.join(' ') }) : readOk(key);
}
