import { DateTimeInput } from '../../utils/values/DateValues';
import { typed } from '../../utils/values/Normalize';
import { IntInput } from '../../utils/values/NumberValues';
import { readOk, type Read } from '../../utils/values/Read';
import { NEXT_N_DAYS_RANGE, RELATIVE_DATE_PRESETS, type DateFilterValue, type RelativeDatePreset } from './FilterTypes';

/**
 * The text form of a date filter value, as the API and the CLI take it:
 * a date `YYYY-MM-DD`, a date and a time `YYYY-MM-DD HH:mm`, a preset name
 * in any case (`thisweek`), or `next<N>days` for `nextNDays`.
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
 * Read a date value into a DateFilterValue: a date and a time read by
 * `DateTimeInput` (`YYYY-MM-DD`, or with `HH:mm` after a `T` or a space,
 * given back as `YYYY-MM-DDTHH:mm`; a day that exists, full-width and
 * hyphen-like characters read), or a preset. A date-shaped value naming no
 * day is `noSuchDay`, a time alone `dateRequired`; anything that is neither
 * a date nor a preset is a date and time's `shape` issue.
 */
export function parseDatePreset(input: string): Read<DateFilterValue> {
    const read = DateTimeInput.read(input, { timeOnly: 'refuse' });
    if (read.ok) {
        const { date, time } = read.value;
        return readOk(time ? `${date}T${time}` : date ?? '');
    }
    if (read.issue.code !== 'shape') return read;

    const normalized = typed(input).toLowerCase();
    const nextNMatch = normalized.match(/^next(\d+)days$/);
    if (nextNMatch) {
        const n = IntInput.read(nextNMatch[1], NEXT_N_DAYS_RANGE);
        return n.ok ? readOk({ preset: 'nextNDays', n: n.value }) : n;
    }

    const preset = BY_LOWER_NAME.get(normalized);
    return preset ? readOk({ preset }) : read;
}
