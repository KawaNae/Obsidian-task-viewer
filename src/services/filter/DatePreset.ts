import { DateUtils } from '../../utils/DateUtils';
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
 * Parse a date value into a DateFilterValue. Absolute dates are checked for
 * shape only. Returns null if the input matches neither a date nor a preset.
 */
export function parseDatePreset(input: string): DateFilterValue | null {
    const normalized = input.trim().toLowerCase();

    if (DateUtils.isDateShape(normalized)) {
        return normalized;
    }

    const nextNMatch = normalized.match(/^next(\d+)days$/);
    if (nextNMatch) {
        return { preset: 'nextNDays', n: parseInt(nextNMatch[1], 10) };
    }

    const preset = BY_LOWER_NAME.get(normalized);
    return preset ? { preset } : null;
}
