import { DateUtils } from '../../../utils/DateUtils';

/**
 * Shared date/time field parsing utilities — the single implementation of
 * "what counts as a date/time fragment" for BOTH notation surfaces
 * (@block via TVInlineParser and frontmatter/section/builtin-property via
 * TVFileBuilder / FilePropertyResolver / BuiltinPropertyExtractor).
 */

/**
 * Normalize a raw YAML value into a string that `parseDateTimeField` can
 * consume.  Handles `Date` objects (Obsidian YAML parser output),
 * numbers 0–1439 (sexagesimal minutes → `HH:MM`), and plain strings.
 */
export function normalizeYamlDate(value: unknown): string | null {
    if (value === null || value === undefined) return null;

    if (value instanceof Date) {
        const y = value.getFullYear();
        const m = (value.getMonth() + 1).toString().padStart(2, '0');
        const d = value.getDate().toString().padStart(2, '0');
        const h = value.getHours();
        const min = value.getMinutes();
        if (h === 0 && min === 0) {
            return `${y}-${m}-${d}`;
        }
        return `${y}-${m}-${d}T${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
    }

    if (typeof value === 'number') {
        if (value >= 0 && value < 1440) {
            const hours = Math.floor(value / 60);
            const minutes = value % 60;
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
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
    const dateMatch = normalized.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (dateMatch) {
        const month = Number(dateMatch[2]), day = Number(dateMatch[3]);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            date = dateMatch[0];
        }
    }

    let time: string | undefined;
    const timeMatch = normalized.match(/(\d{2}:\d{2})/);
    if (timeMatch && DateUtils.isValidTimeString(timeMatch[1])) {
        time = timeMatch[1];
    }

    return { date, time };
}
