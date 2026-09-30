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
 * normalized string.  Returns only the components that are present AND
 * valid: month 1-12 / day 1-31, hour 0-23 / minute 0-59. Shape-matching
 * but out-of-range tokens (`2026-13-40`, `99:99`) are rejected the same
 * way on every parse surface.
 */
export function parseDateTimeField(normalized: string | null): { date?: string; time?: string } {
    if (!normalized) return {};

    let date: string | undefined;
    const dateMatch = normalized.match(DATE_IN_TEXT_RE);
    if (dateMatch) {
        const month = Number(dateMatch[0].slice(5, 7)), day = Number(dateMatch[0].slice(8, 10));
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            date = dateMatch[0];
        }
    }

    let time: string | undefined;
    const timeMatch = normalized.match(TIME_IN_TEXT_RE);
    if (timeMatch && DateUtils.isValidTimeString(timeMatch[1])) {
        time = timeMatch[1];
    }

    return { date, time };
}
