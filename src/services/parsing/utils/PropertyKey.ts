import type { Properties, Property } from '../../../types';

/**
 * The characters a property line's key cannot hold, as the body of a regex
 * character class: `:`, as the key runs up to the first `::`; `[` and `]`,
 * so that a checkbox line and a wikilink line are never property lines; and
 * the backquote, so that a line of text quoting a property line in inline
 * code (`` - write `- key:: value` under it ``) is none either.
 */
const NOT_IN_KEY_CLASS = ':\\[\\]`';

/**
 * A property line's key as a regex fragment (no group): what stands between
 * the gap after the bullet and the first `::`, holding none of the
 * characters above and something besides space (`\s`, what `trim` takes
 * off). A line whose key is empty, or space alone, is no property line.
 */
export const PROPERTY_KEY_SOURCE = `(?=[^${NOT_IN_KEY_CLASS}]*[^\\s${NOT_IN_KEY_CLASS}])[^${NOT_IN_KEY_CLASS}]+?`;

const NOT_IN_KEY = new RegExp(`[${NOT_IN_KEY_CLASS}]`, 'g');

/**
 * How a property's key is compared, on every layer and by every reader: its
 * case aside, as Obsidian compares keys (its types, the Properties view,
 * search, the built-in keys). The key is folded by `toLowerCase` alone, and
 * the width of its characters is kept: `ａｒｅａ` is no `area`, `担当１` no
 * `担当1`, as Obsidian keeps them apart too.
 */
export const PropertyKey = {
    /**
     * The characters of `key` a property line's key cannot hold
     * (`PROPERTY_KEY_SOURCE`), each once, in the order they first stand.
     */
    charsNotIn(key: string): string[] {
        return [...new Set(key.match(NOT_IN_KEY) ?? [])];
    },

    /** The key folded: what two keys naming one property share. */
    fold(key: string): string {
        return key.toLowerCase();
    },

    /** Whether two keys name the same property. */
    same(a: string, b: string): boolean {
        return PropertyKey.fold(a) === PropertyKey.fold(b);
    },

    /** The property `key` names, whatever its case; none when there is none. */
    get(properties: Properties | undefined, key: string): Property | undefined {
        if (!properties) return undefined;
        const folded = PropertyKey.fold(key);
        return Object.prototype.hasOwnProperty.call(properties, folded) ? properties[folded] : undefined;
    },

    /**
     * The keys of one mapping (a note's frontmatter), by key folded, each
     * with the key as written. A key the mapping writes twice, its case
     * aside (`Area` and `area`), is in neither: YAML reads both, but a
     * property holds one value, and which one the note means is not said.
     */
    ofMapping<T>(mapping: Readonly<Record<string, T>>): Map<string, { key: string; value: T }> {
        const out = new Map<string, { key: string; value: T }>();
        const twice = new Set<string>();
        for (const [key, value] of Object.entries(mapping)) {
            const folded = PropertyKey.fold(key);
            if (out.has(folded) || twice.has(folded)) {
                out.delete(folded);
                twice.add(folded);
                continue;
            }
            out.set(folded, { key, value });
        }
        return out;
    },
};
