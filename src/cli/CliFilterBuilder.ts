/**
 * Parse a date/datetime string into separate date and time components.
 * Accepts: "YYYY-MM-DD", "YYYY-MM-DD HH:mm", "YYYY-MM-DDTHH:mm", "HH:mm"
 * Returns null if the input doesn't match any valid format.
 */
export function parseDateTimeFlag(value: string): { date: string; time?: string } | null {
    const trimmed = value.trim();
    // YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/);
    if (match) {
        return { date: match[1], time: match[2] };
    }
    // YYYY-MM-DD only
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return { date: trimmed };
    }
    // HH:mm only (time-only)
    if (/^\d{2}:\d{2}$/.test(trimmed)) {
        return { date: '', time: trimmed };
    }
    return null;
}
