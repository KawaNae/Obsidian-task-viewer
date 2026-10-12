import type { PropertyValue, ScopeKeys } from '../../../types';
import { VALID_LINE_STYLES } from '../../../constants/style';
import { normalizeColor } from '../../../utils/ColorUtils';
import { DateUtils } from '../../../utils/DateUtils';
import { parseDateTimeField } from './DateTimeFieldParser';
import { PropertyKey } from './PropertyKey';
import { PropertyValues } from './PropertyValues';
import { TagExtractor } from './TagExtractor';

/** A built-in property, one per key: a date's time is read with its date. */
export type Builtin = 'color' | 'linestyle' | 'mask' | 'tags' | 'start' | 'end' | 'due';

const BUILTINS: readonly Builtin[] = ['color', 'linestyle', 'mask', 'tags', 'start', 'end', 'due'];

/** The key a built-in is written under, on any layer (the settings' `scopeKeys`, and `tags`). */
export function builtinKey(builtin: Builtin, keys: ScopeKeys): string {
    switch (builtin) {
        case 'tags': return 'tags';
        default: return keys[builtin];
    }
}

/** The built-in each key names, by key folded (`PropertyKey`): `TV-COLOR` is the color. */
export function builtinsByKey(keys: ScopeKeys): ReadonlyMap<string, Builtin> {
    const out = new Map<string, Builtin>();
    for (const builtin of BUILTINS) {
        const key = PropertyKey.fold(builtinKey(builtin, keys));
        if (!out.has(key)) out.set(key, builtin);
    }
    return out;
}

/** What a built-in's value says, read. */
export type BuiltinValue =
    | { builtin: 'color' | 'linestyle' | 'mask'; text: string }
    | { builtin: 'start' | 'end'; date?: string; time?: string }
    | { builtin: 'due'; due: string }
    | { builtin: 'tags'; tags: string[] };

/**
 * One layer's value of a built-in, read: the one reading of a built-in's
 * value, for the frontmatter, a section and a task alike, and for the
 * property lines' findings (`PropertyLines.read`).
 *
 * - No value (`- tv-color::`, `tv-color:`, `null`) is null: the layer says
 *   it has none, which hides the value above it. A date key's no value has
 *   neither a date nor a time.
 * - A value the built-in cannot read is undefined: the layer is read as
 *   saying nothing, and the value above comes through. That is a list (but
 *   for tags), an empty text, a line style not known, and for a date key a
 *   text naming neither a date nor a time, or a day or a time that does not
 *   exist (`parseDateTimeField`; one part not read reads neither), and a
 *   due with no date.
 * - Tags read every value: a line's are the `#tag`s its text holds, or each
 *   item of its list holds (`- #a` is the tag a, `- b` none). No value adds
 *   none, as no tags does; tags are a union, and nothing hides them.
 *
 * Any other value is read as its text shown (`PropertyValues.display`),
 * whatever its type: a quoted `"red"` is `red`, and a number is its
 * spelling (`tv-color: 336699`; a date key's `630` names no date).
 */
export function readBuiltin(builtin: Builtin, value: PropertyValue): BuiltinValue | null | undefined {
    if (builtin === 'tags') {
        const texts = value.type === 'list' ? value.items.map(item => PropertyValues.display(item))
            : value.type === 'null' ? [] : [PropertyValues.display(value)];
        return { builtin, tags: TagExtractor.merge(...texts.map(text => TagExtractor.fromContent(text))) };
    }
    if (value.type === 'null') return null;
    if (value.type === 'list') return undefined;
    const text = PropertyValues.display(value).trim();
    if (text === '') return undefined;
    switch (builtin) {
        case 'color': return { builtin, text: normalizeColor(text) };
        case 'linestyle': {
            const style = text.toLowerCase();
            return VALID_LINE_STYLES.has(style) ? { builtin, text: style } : undefined;
        }
        case 'mask': return { builtin, text };
        case 'start':
        case 'end': {
            const parsed = parseDateTimeField(text);
            if (!parsed || (!parsed.date && !parsed.time)) return undefined;
            return { builtin, date: parsed.date, time: parsed.time };
        }
        case 'due': {
            const parsed = parseDateTimeField(text);
            return parsed?.date ? { builtin, due: DateUtils.joinDateTime(parsed.date, parsed.time)! } : undefined;
        }
    }
}
