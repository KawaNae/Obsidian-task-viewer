import type { ScopeKeys } from '../../../types';
import type { FieldCodec, Read } from '../../../utils/values/Read';
import { readFail, readOk } from '../../../utils/values/Read';
import { builtinsByKey } from './BuiltinValues';
import { KEYS_NOT_SCOPE, reservedPropertyKeys } from './FrontmatterPolicy';
import { LIST_BULLET_SOURCE, SPACE_OR_TAB_SOURCE } from './ListMarker';
import { Outline } from './Outline';
import { PropertyKey } from './PropertyKey';

/**
 * A key that starts as a list item's marker does (`- x`, `* x`, `+ x`,
 * `1. x`, `1) x`: the marker and a space or a tab), with a `#`, or with a
 * `>`. The plugin's own reading takes `- - x:: v` as the key `- x`, but
 * written after a property line's bullet, Markdown and Obsidian read the
 * line as a list nested in the item, a heading in it (`# x`), a tag
 * (`#x`), or a quote (`> x`, and `>x` too: a quote's `>` needs no space
 * after it). A list marker with no gap after it (`-x`, `1.x`) opens no
 * list, and is taken.
 */
const LIST_MARK = new RegExp(`^(?:${LIST_BULLET_SOURCE}${SPACE_OR_TAB_SOURCE}|[#>])`);

/**
 * Whether the property line of `key` opens a fenced code block in its item
 * (a key of three tildes or more, `~~~x`), as the note's one reading of its
 * blocks reads it (`Outline`): the plugin reads no property line there, so
 * the key would be written and read as none. A fence of backquotes holds a
 * backquote, which `readKey` refuses already.
 */
function opensFence(key: string): boolean {
    return Outline.read([`- ${key}:: v`]).kindOf(0) === 'item-fence';
}

/**
 * A property's key typed in a field (the hub's new property): the space
 * around it taken off, and refused when
 * - the property line would not read it as the key
 *   (`PROPERTY_KEY_SOURCE`: empty, `:`, `[`, `]`, a backquote)
 * - it starts as a list item's marker, a `#` or a quote's `>` does
 *   ({@link LIST_MARK}), or opens a code fence ({@link opensFence})
 * - the plugin keeps it for itself (`reservedPropertyKeys`: the scope keys,
 *   `tags`), said with the built-in's field when one edits it
 *   (`builtinsByKey`; the scope keys as the settings name them)
 * - a row stands for it already (`rowOf`, the key as that row shows it),
 *   whose value is edited there
 *
 * Keys are compared their case aside (`PropertyKey`): `Tags` and `TV-COLOR`
 * are refused as `tags` is.
 */
export const PropertyKeyInput = {
    of(scopeKeys: ScopeKeys, rowOf: (key: string) => string | null): FieldCodec<string> {
        const reserved = reservedPropertyKeys(scopeKeys);
        const builtins = builtinsByKey(scopeKeys);
        return {
            read(text: string): Read<string> {
                const key = readKey(text);
                if (!key.ok) return key;
                if (LIST_MARK.test(key.value) || opensFence(key.value)) return readFail({ code: 'listMark' });
                const folded = PropertyKey.fold(key.value);
                if (reserved.has(folded)) {
                    const builtin = builtins.get(folded);
                    return readFail(builtin ? { code: 'reserved', field: { key: key.value, builtin } } : { code: 'reserved' });
                }
                const row = rowOf(key.value);
                return row === null ? key : readFail({ code: 'hasRow', key: row });
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
 * Keys are compared their case aside (`PropertyKey`): `Tags`, and `TV-END`
 * beside `tv-end`, are refused.
 */
export const ScopeKeyInput = {
    read(text: string, others: Iterable<string>): Read<string> {
        const key = readKey(text);
        if (!key.ok) return key;
        if (KEYS_NOT_SCOPE.has(PropertyKey.fold(key.value))) return readFail({ code: 'reserved' });
        for (const other of others) {
            if (PropertyKey.same(other, key.value)) return readFail({ code: 'duplicate' });
        }
        return key;
    },
    /** The reading of a field of one scope key; `others` answers the other keys as they are when it reads. */
    codec(others: () => Iterable<string>): FieldCodec<string> {
        return { read: (text) => ScopeKeyInput.read(text, others()), show: (key) => key };
    },
};

/**
 * A key a property line reads (`PROPERTY_KEY_SOURCE`): the space around it
 * taken off, not empty, none of `:`, `[`, `]` or a backquote.
 */
function readKey(text: string): Read<string> {
    const key = text.trim();
    if (key === '') return readFail({ code: 'empty' });
    const bad = PropertyKey.charsNotIn(key);
    return bad.length > 0 ? readFail({ code: 'chars', chars: bad.join(' ') }) : readOk(key);
}
