import { DateUtils } from '../../../utils/DateUtils';

const DATE_IN_TEXT_RE = new RegExp(DateUtils.DATE_PATTERN);
const TIME_IN_TEXT_RE = new RegExp(`(${DateUtils.TIME_PATTERN})`);

/**
 * Shared date/time field parsing utilities — the single implementation of
 * "what counts as a date/time fragment" for BOTH notation surfaces
 * (@block via TVInlineParser and frontmatter/section/builtin-property via
 * BuiltinPropertyExtractor, for the frontmatter, a section and a task alike).
 */

/**
 * Normalize a raw YAML value into a string that `parseDateTimeField` can
 * consume.  Handles `Date` objects (Obsidian YAML parser output),
 * numbers 0–1439 (sexagesimal minutes → `HH:MM`), and plain strings.
 */
export function normalizeYamlDate(value: unknown): string | null {
    if (value === null || value === undefined) return null;

    if (value instanceof Date) {
        const date = DateUtils.getLocalDateString(value);
        const h = value.getHours();
        const min = value.getMinutes();
        return h === 0 && min === 0 ? date : `${date}T${DateUtils.formatHHMM(h, min)}`;
    }

    if (typeof value === 'number') {
        if (value >= 0 && value < 1440) {
            const hours = Math.floor(value / 60);
            const minutes = value % 60;
            return DateUtils.formatHHMM(hours, minutes);
        }
        return null;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    return String(value).trim() || null;
}

/**
 * Extract date (`YYYY-MM-DD`) and/or time (`HH:mm`) fragments from a
 * normalized string: the components that are present.
 *
 * Null when the value names a day or a time that does not exist: a fragment
 * of a date's shape that `DateUtils.readDate` refuses (`2026-02-30`,
 * `2026-13-45`), or one of a time's shape out of range (`25:00`). Such a value
 * is not read at all, its other component included, since reading half of
 * it would guess at what was meant. The input fields read a day with the
 * same predicate (`DateInput`), so the notation and the inputs name the same
 * days.
 */
export function parseDateTimeField(normalized: string | null): { date?: string; time?: string } | null {
    if (!normalized) return {};

    let date: string | undefined;
    const dateMatch = normalized.match(DATE_IN_TEXT_RE);
    if (dateMatch) {
        if (DateUtils.readDate(dateMatch[0]) === null) return null;
        date = dateMatch[0];
    }

    let time: string | undefined;
    const timeMatch = normalized.match(TIME_IN_TEXT_RE);
    if (timeMatch) {
        if (!DateUtils.isValidTimeString(timeMatch[1])) return null;
        time = timeMatch[1];
    }

    return { date, time };
}
