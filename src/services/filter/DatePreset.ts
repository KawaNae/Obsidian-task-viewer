import { DateInput } from '../../utils/values/DateValues';
import { typed } from '../../utils/values/Normalize';
import { readOk, type Read } from '../../utils/values/Read';
import { RELATIVE_DATE_PRESETS, type DateFilterValue, type RelativeDatePreset } from './FilterTypes';

/**
 * The text form of a date filter value, as the API and the CLI take it:
 * an absolute `YYYY-MM-DD`, a preset name in any case (`thisweek`), or
 * `next<N>days` for `nextNDays`.
 */

/** Preset names that are written as themselves (all but `nextNDays`). */
export const NAMED_DATE_PRESETS: readonly RelativeDatePreset[] =
    RELATIVE_DATE_PRESETS.filter(p => p !== 'nextNDays');

/** The accepted preset spellings, for error messages. */
export const DATE_PRESET_SYNTAX = RELATIVE_DATE_PRESETS
    .map(p => (p === 'nextNDays' ? 'nextNdays' : p))
    .join(', ');

const BY_LOWER_NAME: ReadonlyMap<string, RelativeDatePreset> =
    new Map(NAMED_DATE_PRESETS.map(p => [p.toLowerCase(), p]));

/**
 * Read a date value into a DateFilterValue: an absolute date read by
 * `DateInput` (a day that exists, full-width and hyphen-like characters
 * read), or a preset. A date-shaped value naming no day is `noSuchDay`;
 * anything that is neither a date nor a preset is a date's `shape` issue.
 */
export function parseDatePreset(input: string): Read<DateFilterValue> {
    const date = DateInput.read(input);
    if (date.ok || date.issue.code !== 'shape') return date;

    const normalized = typed(input).toLowerCase();
    const nextNMatch = normalized.match(/^next(\d+)days$/);
    if (nextNMatch) {
        return readOk({ preset: 'nextNDays', n: parseInt(nextNMatch[1], 10) });
    }

    const preset = BY_LOWER_NAME.get(normalized);
    return preset ? readOk({ preset }) : date;
}
