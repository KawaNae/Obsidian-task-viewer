import type { Properties, PropertyValue, ScopeKeys } from '../../../types';
import { TagExtractor } from '../utils/TagExtractor';
import { TagRule } from '../utils/TagRule';
import { builtinKey, builtinsByKey, readBuiltin, type Builtin } from '../utils/BuiltinValues';
import { PropertyValues } from '../utils/PropertyValues';
import { reservedPropertyKeys } from '../utils/FrontmatterPolicy';
import type { ScalarField } from './Sections';

/**
 * One layer's properties, the built-ins put apart. A built-in's field is
 * undefined where the layer says nothing of it (no key, or a value it
 * cannot read), and null where it says it has none (`- tv-color::`), which
 * hides the value above it.
 */
export interface ExtractedProperties {
    color?: string | null;
    linestyle?: string | null;
    mask?: string | null;
    tags?: string[];
    startDate?: string | null;
    startTime?: string | null;
    endDate?: string | null;
    endTime?: string | null;
    due?: string | null;
    /** Custom properties by key folded, each with its key as this layer writes it. */
    properties: Properties;
}

/**
 * The key a built-in value is written under, on any layer: the one
 * {@link BuiltinPropertyExtractor.extract} reads it from. A date and its time
 * share their key.
 */
export function fieldKey(field: ScalarField | 'tags', keys: ScopeKeys): string {
    switch (field) {
        case 'startDate': case 'startTime': return builtinKey('start', keys);
        case 'endDate': case 'endTime': return builtinKey('end', keys);
        default: return builtinKey(field, keys);
    }
}

/**
 * The built-in values of one layer's properties, put into their own fields,
 * and the rest as custom properties: the frontmatter's
 * ({@link BuiltinPropertyExtractor.fromFrontmatter}), a section's and a
 * task's alike, so a key means one thing on every layer. Which key is which
 * built-in, a key's case aside, and how its value reads (no value, a value,
 * or one not read) is `BuiltinValues`'s: `TV-COLOR::` is the color,
 * `Tags::` the tags. The frontmatter's tags are Obsidian's `tags` key, read
 * off the YAML before its values are made text
 * ({@link BuiltinPropertyExtractor.fromFrontmatter}).
 */
export class BuiltinPropertyExtractor {
    /**
     * The built-ins and custom properties of a note's frontmatter, as its
     * YAML gave it. A key written twice, its case aside (`Area` and
     * `area`), is read on neither (`PropertyValues.fromFrontmatter`). Its
     * tags are Obsidian's (`TagExtractor.fromFrontmatter`): the first key
     * that is `tags` whatever its case, `Tags` beside it or not, and of its
     * items those YAML read as text (`tags: [true, a]` holds `a`), which the
     * values made text no longer tell apart. Every key Obsidian could read
     * tags from is the tags' and no custom property, as `tags` is on any
     * layer.
     */
    static fromFrontmatter(
        frontmatter: Record<string, unknown> | undefined,
        keys: ScopeKeys
    ): ExtractedProperties {
        const values = PropertyValues.fromFrontmatter(frontmatter);
        for (const [folded, { key }] of Object.entries(values)) if (TagRule.isFrontmatterKey(key)) delete values[folded];
        const result = this.extract(values, keys);
        const tags = TagExtractor.fromFrontmatter(frontmatter);
        if (tags.length > 0) result.tags = tags;
        return result;
    }

    /** The built-ins and custom properties of one layer's properties (a section's, a task's), by key folded. */
    static extract(
        rawProperties: Properties,
        keys: ScopeKeys
    ): ExtractedProperties {
        const result: ExtractedProperties = { properties: {} };
        const reserved = reservedPropertyKeys(keys);
        const builtinOf = builtinsByKey(keys);

        for (const [key, property] of Object.entries(rawProperties)) {
            const builtin = builtinOf.get(key);
            if (builtin) {
                this.readBuiltin(builtin, property.value, result);
            } else if (!reserved.has(key)) {
                // A reserved key with no field (tv-ignore, the file task's
                // legacy tv-content / tv-status / tv-timer-target-id, and
                // Obsidian's `position`) is not a custom property.
                result.properties[key] = property;
            }
        }

        return result;
    }

    private static readBuiltin(builtin: Builtin, pv: PropertyValue, result: ExtractedProperties): void {
        const read = readBuiltin(builtin, pv);
        if (read === undefined) return;
        if (read === null) {
            // No value: the layer has none, of a date's time too.
            switch (builtin) {
                case 'start': result.startDate = result.startTime = null; return;
                case 'end': result.endDate = result.endTime = null; return;
                case 'tags': return;
                default: result[builtin] = null; return;
            }
        }
        switch (read.builtin) {
            case 'color': case 'linestyle': case 'mask':
                result[read.builtin] = read.text;
                return;
            case 'tags':
                if (read.tags.length > 0) result.tags = read.tags;
                return;
            // A date and its time each go on their own: a value with a time
            // alone lets the date above come through.
            case 'start':
                if (read.date) result.startDate = read.date;
                if (read.time) result.startTime = read.time;
                return;
            case 'end':
                if (read.date) result.endDate = read.date;
                if (read.time) result.endTime = read.time;
                return;
            case 'due':
                result.due = read.due;
                return;
        }
    }
}
