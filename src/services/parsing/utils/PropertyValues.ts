import type { PropertyScalar, PropertyValue } from '../../../types';

/**
 * The spellings that are not text, as YAML 1.2's core schema reads a plain
 * scalar (Obsidian reads the frontmatter so). A property line reads its value
 * by the same spellings, so `- key:: 0x1F` and `key: 0x1F` are one number.
 * `1_000`, `1,000`, `10:30`, `yes` and `on` are YAML 1.1's, and text here.
 */
const NULL_SPELLING = /^(?:~|[Nn]ull|NULL)?$/;
const BOOLEAN_SPELLINGS: ReadonlyMap<string, boolean> = new Map([
    ['true', true], ['True', true], ['TRUE', true],
    ['false', false], ['False', false], ['FALSE', false],
]);
const OCTAL = /^0o[0-7]+$/;
const HEX = /^0x[0-9a-fA-F]+$/;
const DECIMAL = /^[-+]?(?:[0-9]+|\.[0-9]+|[0-9]+\.[0-9]*)(?:[eE][-+]?[0-9]+)?$/;
const INFINITY = /^[-+]?\.(?:inf|Inf|INF)$/;
const NAN = /^\.(?:nan|NaN|NAN)$/;

/** The number a spelling of the core schema's names; null for text. */
function numberOf(spelling: string): number | null {
    if (OCTAL.test(spelling)) return parseInt(spelling.slice(2), 8);
    if (HEX.test(spelling)) return parseInt(spelling.slice(2), 16);
    if (DECIMAL.test(spelling)) return Number(spelling);
    if (INFINITY.test(spelling)) return spelling.startsWith('-') ? -Infinity : Infinity;
    if (NAN.test(spelling)) return NaN;
    return null;
}

/** Whether `spelling` is the whole of a value in `"` or `'`, which makes it text. */
function isQuoted(spelling: string): boolean {
    if (spelling.length < 2) return false;
    const quote = spelling[0];
    return (quote === '"' || quote === '\'') && spelling[spelling.length - 1] === quote;
}

/**
 * The one reading of a property's value (`PropertyValue`), on a line and in
 * the frontmatter, and the one way to show it and to write it on a line.
 * Every reader of a property's truth, number or items asks the value read
 * here.
 */
export const PropertyValues = {
    /**
     * A value written as text: a property line's (`- key:: value`, already
     * trimmed), or one typed into the hub. Its type is the one YAML gives the
     * same spelling unquoted: nothing, `null` or `~` is no value; `true` and
     * `false` (also `True`, `TRUE`, ...) a boolean; the core schema's numbers
     * (`-5`, `.5`, `1e3`, `0x1F`, `0o17`, `.inf`, `.nan`) a number. The
     * whole value in `"` or `'` is the text inside, as written (no escape is
     * read). Anything else is text, `[a, b]` and `[[x]]` included: a line
     * writes no list in brackets.
     */
    fromText(spelling: string): PropertyValue {
        if (isQuoted(spelling)) return { type: 'text', text: spelling.slice(1, -1), spelling };
        if (NULL_SPELLING.test(spelling)) return { type: 'null', spelling };
        const boolean = BOOLEAN_SPELLINGS.get(spelling);
        if (boolean !== undefined) return { type: 'boolean', boolean, spelling };
        const number = numberOf(spelling);
        if (number !== null) return { type: 'number', number, spelling };
        return { type: 'text', text: spelling, spelling };
    },

    /**
     * A value the frontmatter's YAML gave: its type is the one YAML read (so
     * a quoted `"true"` is text). A list holds its scalar items, a text one
     * trimmed and dropped when empty; an item that is no value, a list or a
     * mapping is not one of them. Null for a value no property holds (a
     * mapping).
     */
    fromYaml(value: unknown): PropertyValue | null {
        if (value === null || value === undefined) return { type: 'null', spelling: '' };
        if (Array.isArray(value)) {
            const items: PropertyScalar[] = [];
            for (const item of value) {
                const scalar = scalarOfYaml(typeof item === 'string' ? item.trim() : item);
                if (scalar && !(scalar.type === 'text' && scalar.text === '')) items.push(scalar);
            }
            return { type: 'list', items };
        }
        return scalarOfYaml(value);
    },

    /**
     * The frontmatter as property values, key by key, before any key is told
     * apart as a built-in (`BuiltinPropertyExtractor` does that, for every
     * layer). A key with no value (`key:`, `key: null`) is left out, as is
     * one whose value no property holds (`fromYaml`).
     */
    fromFrontmatter(frontmatter: Record<string, unknown> | undefined): Record<string, PropertyValue> {
        const out: Record<string, PropertyValue> = {};
        if (!frontmatter) return out;
        for (const [key, raw] of Object.entries(frontmatter)) {
            const value = this.fromYaml(raw);
            if (value && value.type !== 'null') out[key] = value;
        }
        return out;
    },

    /**
     * The value as a card, the hub and a list of candidates show it: a text
     * without the quotes it was written in, a number and a boolean as spelled
     * (`0x1F`, `True`), no value as spelled (empty for `- key::`), and a
     * list's items shown so, joined by `, `. A filter compares this text.
     */
    display(value: PropertyValue): string {
        switch (value.type) {
            case 'text': return value.text;
            case 'list': return value.items.map(item => this.display(item)).join(', ');
            default: return value.spelling;
        }
    },

    /**
     * The value as a property line writes it, which reads back as the same
     * value (`fromText`). A line holds no list yet: a list is its items'
     * spellings joined by `, `, which a line reads as one text.
     */
    spelling(value: PropertyValue): string {
        if (value.type === 'list') return value.items.map(item => item.spelling).join(', ');
        return value.spelling;
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

/**
 * A YAML scalar as a property's scalar, its spelling the line text that
 * reads back as it: a number as YAML writes it (`.inf`, `.nan`), a text
 * quoted when a line would read it as something else (`"123"`). Null for a
 * value that is no scalar (no value, a list, a mapping).
 */
function scalarOfYaml(value: unknown): PropertyScalar | null {
    if (typeof value === 'boolean') return { type: 'boolean', boolean: value, spelling: String(value) };
    if (typeof value === 'number') return { type: 'number', number: value, spelling: numberSpelling(value) };
    if (typeof value === 'string') {
        const asLine = PropertyValues.fromText(value);
        const readsBack = asLine.type === 'text' && asLine.text === value;
        return { type: 'text', text: value, spelling: readsBack ? value : `"${value}"` };
    }
    return null;
}

function numberSpelling(value: number): string {
    if (Number.isNaN(value)) return '.nan';
    if (value === Infinity) return '.inf';
    if (value === -Infinity) return '-.inf';
    return String(value);
}
