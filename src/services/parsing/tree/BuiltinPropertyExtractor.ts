import type { Properties, PropertyValue, ScopeKeys } from '../../../types';
import { TagExtractor } from '../utils/TagExtractor';
import { builtinKey, builtinsByKey, readBuiltin, type Builtin } from '../utils/BuiltinValues';
import { PropertyValues } from '../utils/PropertyValues';
import { reservedPropertyKeys } from '../utils/FrontmatterPolicy';
import type { ScalarField } from './Sections';

/**
 * One layer's built-in values. A built-in's field is undefined where the
 * layer says nothing of it (no key, or a value it cannot read), and null
 * where it says it has none (`- tv-color::`), which hides the value above
 * it.
 */
export interface ExtractedBuiltins {
    color?: string | null;
    linestyle?: string | null;
    mask?: string | null;
    tags?: string[];
    startDate?: string | null;
    startTime?: string | null;
    endDate?: string | null;
    endTime?: string | null;
    due?: string | null;
}

/** One layer's properties, the built-ins put apart (`ExtractedBuiltins`). */
export interface ExtractedProperties extends ExtractedBuiltins {
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
 * and the rest as custom properties: a section's and a task's alike, so a
 * key means one thing on every layer. Which key is which built-in, a key's
 * case aside, and how its value reads (no value, a value, or one not read)
 * is `BuiltinValues`'s: `TV-COLOR::` is the color, `Tags::` the tags. The
 * frontmatter gives its built-ins alone
 * ({@link BuiltinPropertyExtractor.fromFrontmatter}): its other keys are
 * the note's own, which no task inherits.
 */
export class BuiltinPropertyExtractor {
    /**
     * The built-ins of a note's frontmatter, as its YAML gave it, read as a
     * section's are. A key written twice, its case aside (`TV-COLOR` and
     * `tv-color`), is read on neither (`PropertyValues.fromFrontmatter`).
     * Its tags are Obsidian's (`TagExtractor.fromFrontmatter`): the first
     * key that is `tags` whatever its case, `Tags` beside it or not, and of
     * its items those YAML read as text (`tags: [true, a]` holds `a`),
     * which the values made text no longer tell apart.
     *
     * Its other keys are no task's: the frontmatter is the note's own
     * metadata, which other plugins and scripts write and read as they
     * mean them (a daily note's `体重[kg]:`). A value every task of the note
     * inherits is a property line above the note's first heading.
     */
    static fromFrontmatter(
        frontmatter: Record<string, unknown> | undefined,
        keys: ScopeKeys
    ): ExtractedBuiltins {
        const result: ExtractedBuiltins = {};
        const builtinOf = builtinsByKey(keys);
        for (const [key, property] of Object.entries(PropertyValues.fromFrontmatter(frontmatter))) {
            const builtin = builtinOf.get(key);
            if (builtin && builtin !== 'tags') this.readBuiltin(builtin, property.value, result);
        }
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

    private static readBuiltin(builtin: Builtin, pv: PropertyValue, result: ExtractedBuiltins): void {
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
