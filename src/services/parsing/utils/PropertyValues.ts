import type { PropertyValue, ScopeKeys } from '../../../types';
import { IN_LINE } from '../../../utils/LineBreak';
import { normalizeYamlDate } from './DateTimeFieldParser';
import { WIKILINK_SOURCE } from './InlineNotation';

/**
 * The spellings of a boolean, and what each means: YAML's (as Obsidian reads
 * frontmatter), so that a property line and the frontmatter say `true` the
 * same way. `yes`, `on`, `1` and `tRue` are text.
 */
const BOOLEAN_SPELLINGS: ReadonlyMap<string, boolean> = new Map([
    ['true', true], ['True', true], ['TRUE', true],
    ['false', false], ['False', false], ['FALSE', false],
]);

const NUMBER_TEXT = /^\d+(\.\d+)?$/;
const BRACKET_LIST_TEXT = new RegExp(`^\\[${IN_LINE}*\\]$`);

/** A wikilink or embed, which an array value holds as one item. */
const ARRAY_ITEM_LINK = new RegExp(`!?${WIKILINK_SOURCE}`, 'g');

/**
 * The one reading of a property's value (`PropertyValue`), on a line and in
 * the frontmatter. Every reader of a property's truth, number or items asks
 * the value read here.
 */
export const PropertyValues = {
    /**
     * A value written as text: a property line's (`- key:: value`, already
     * trimmed), or one typed into the hub. A number is digits with an
     * optional fraction; a boolean is one of YAML's six spellings; an array
     * is a list in `[` `]` or a list `,` separates ({@link arrayItems}).
     * Anything else is a string.
     */
    fromText(text: string): PropertyValue {
        if (NUMBER_TEXT.test(text)) return { type: 'number', value: text, number: Number(text) };
        const boolean = BOOLEAN_SPELLINGS.get(text);
        if (boolean !== undefined) return { type: 'boolean', value: text, boolean };
        if (BRACKET_LIST_TEXT.test(text) || text.includes(',')) {
            return { type: 'array', value: text, items: arrayItems(text) };
        }
        return { type: 'string', value: text };
    },

    /**
     * A value the frontmatter's YAML gave: its type is the one YAML read
     * (so a quoted `"true"` is a string), and `value` is its text. A list is
     * its items, joined by `, ` for the text. A date YAML read as a `Date`
     * is its date text. Null for a key with no value.
     */
    fromYaml(value: unknown): PropertyValue | null {
        if (value === null || value === undefined) return null;
        if (typeof value === 'boolean') return { type: 'boolean', value: String(value), boolean: value };
        if (typeof value === 'number') return { type: 'number', value: String(value), number: value };
        if (Array.isArray(value)) {
            const texts = value.map(yamlText);
            return {
                type: 'array',
                value: texts.join(', '),
                items: texts.map(item => item.trim()).filter(item => item !== ''),
            };
        }
        return { type: 'string', value: yamlText(value) };
    },

    /**
     * The frontmatter as property values, key by key, before any key is told
     * apart as a built-in (`BuiltinPropertyExtractor` does that, for every
     * layer). A date key's value is read as a date here, where the YAML is
     * still at hand: a `Date` is its date text, and a number is minutes of
     * the day (YAML 1.1 reads `10:30` as 630). Keys with no value are left out.
     */
    fromFrontmatter(frontmatter: Record<string, unknown> | undefined, keys: ScopeKeys): Record<string, PropertyValue> {
        const out: Record<string, PropertyValue> = {};
        if (!frontmatter) return out;
        const dateKeys = new Set([keys.start, keys.end, keys.due]);
        for (const [key, raw] of Object.entries(frontmatter)) {
            if (dateKeys.has(key)) {
                const text = normalizeYamlDate(raw);
                if (text !== null) out[key] = { type: 'string', value: text };
                continue;
            }
            const value = this.fromYaml(raw);
            if (value) out[key] = value;
        }
        return out;
    },

    /**
     * Whether the value is the boolean true: YAML's `true`, or a line's
     * `true`/`True`/`TRUE`. The one answer to "is this set", for `tv-ignore`
     * as for any reader.
     */
    isTrue(value: PropertyValue | null | undefined): boolean {
        return value?.type === 'boolean' && value.boolean;
    },
};

/** A YAML scalar as text: a `Date` as its date text, anything else as `String` says it. */
function yamlText(value: unknown): string {
    if (value instanceof Date) return normalizeYamlDate(value) ?? '';
    if (value === null || value === undefined) return '';
    return String(value);
}

/**
 * The items of a list written as text: the two forms {@link PropertyValues.fromText}
 * reads as an array, a list in `[` `]` and a list `,` separates. A wikilink
 * is one item whatever brackets and commas it holds (`[[x]]`,
 * `[[a|b, c]]`), so the brackets `[` `]` strips are a list's only when a
 * link's are not all there is. Items are trimmed and an empty one is none.
 */
function arrayItems(raw: string): string[] {
    // Links masked to same-length filler, so the list's brackets and
    // commas are found by position in `masked` and cut out of `raw`.
    const masked = raw.replace(ARRAY_ITEM_LINK, link => '_'.repeat(link.length));
    let from = 0;
    let to = raw.length;
    if (masked.startsWith('[') && masked.endsWith(']') && masked.length >= 2) {
        from = 1;
        to = raw.length - 1;
    }
    const items: string[] = [];
    let start = from;
    for (let i = from; i <= to; i++) {
        if (i < to && masked[i] !== ',') continue;
        const item = raw.slice(start, i).trim();
        if (item !== '') items.push(item);
        start = i + 1;
    }
    return items;
}
