import { DateUtils } from '../../../utils/DateUtils';
import type { ScopeKeys, PropertyValue } from '../../../types';
import { VALID_LINE_STYLES } from '../../../constants/style';
import { normalizeColor } from '../../../utils/ColorUtils';
import { TagExtractor } from '../utils/TagExtractor';
import { parseDateTimeField } from '../utils/DateTimeFieldParser';
import { reservedPropertyKeys } from '../utils/FrontmatterPolicy';
import type { ScalarField } from './Sections';

export interface ExtractedProperties {
    color?: string;
    linestyle?: string;
    mask?: string;
    tags?: string[];
    startDate?: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    due?: string;
    properties: Record<string, PropertyValue>;
}

/**
 * The key a built-in value is written under, on any layer: the one
 * {@link BuiltinPropertyExtractor.extract} reads it from. A date and its time
 * share their key.
 */
export function fieldKey(field: ScalarField | 'tags', keys: ScopeKeys): string {
    switch (field) {
        case 'color': return keys.color;
        case 'linestyle': return keys.linestyle;
        case 'mask': return keys.mask;
        case 'startDate': case 'startTime': return keys.start;
        case 'endDate': case 'endTime': return keys.end;
        case 'due': return keys.due;
        case 'tags': return 'tags';
    }
}

/** The built-ins a key can hold, one per key (a date's time is read with it). */
type Builtin = 'color' | 'linestyle' | 'mask' | 'tags' | 'startDate' | 'endDate' | 'due';
const BUILTINS: readonly Builtin[] = ['color', 'linestyle', 'mask', 'tags', 'startDate', 'endDate', 'due'];

/**
 * The built-in values of one layer's properties, put into their own fields,
 * and the rest as custom properties: the frontmatter's
 * (`PropertyValues.fromFrontmatter`), a section's and a task's alike, so a
 * key means one thing on every layer. Which key is which built-in is
 * {@link fieldKey}'s table.
 *
 * A built-in reads the value as written (`value`), whatever its type, but
 * tags: a list's items (`tags: [a, b]` in the frontmatter, `tags:: a, b` on a
 * line) are the tags, and a text is read as `#tag`s or else as a `,` list
 * (`TagExtractor.fromPropertyValue`).
 */
export class BuiltinPropertyExtractor {
    static extract(
        rawProperties: Record<string, PropertyValue>,
        keys: ScopeKeys
    ): ExtractedProperties {
        const result: ExtractedProperties = { properties: {} };
        const reserved = reservedPropertyKeys(keys);
        const builtinOf = new Map<string, Builtin>();
        for (const field of BUILTINS) {
            const key = fieldKey(field, keys);
            if (!builtinOf.has(key)) builtinOf.set(key, field);
        }

        for (const [key, pv] of Object.entries(rawProperties)) {
            const field = builtinOf.get(key);
            if (field) {
                this.readBuiltin(field, pv, result);
            } else if (!reserved.has(key)) {
                // A reserved key with no field (tv-ignore, the file task's
                // legacy tv-content / tv-status / tv-timer-target-id, and
                // Obsidian's `position`) is not a custom property.
                result.properties[key] = pv;
            }
        }

        return result;
    }

    private static readBuiltin(field: Builtin, pv: PropertyValue, result: ExtractedProperties): void {
        const text = pv.value.trim();
        switch (field) {
            case 'color':
                if (text) result.color = normalizeColor(text);
                return;
            case 'linestyle': {
                const style = text.toLowerCase();
                if (VALID_LINE_STYLES.has(style)) result.linestyle = style;
                return;
            }
            case 'mask':
                if (text) result.mask = text;
                return;
            case 'tags': {
                const tags = pv.type === 'array'
                    ? TagExtractor.fromFrontmatter(pv.items)
                    : TagExtractor.fromPropertyValue(pv.value);
                if (tags.length > 0) result.tags = tags;
                return;
            }
            // A value naming a day or a time that does not exist is not read
            // (`parseDateTimeField`): this layer says no date, and the cascade
            // gives the one above it, as for a task's block that does not read.
            case 'startDate': {
                const parsed = parseDateTimeField(text);
                if (parsed?.date) result.startDate = parsed.date;
                if (parsed?.time) result.startTime = parsed.time;
                return;
            }
            case 'endDate': {
                const parsed = parseDateTimeField(text);
                if (parsed?.date) result.endDate = parsed.date;
                if (parsed?.time) result.endTime = parsed.time;
                return;
            }
            case 'due': {
                const parsed = parseDateTimeField(text);
                if (parsed?.date) result.due = DateUtils.joinDateTime(parsed.date, parsed.time);
                return;
            }
        }
    }
}
