import type { DateFilterValue, RelativeDatePreset } from '../services/filter/FilterTypes';

const PRESET_MAP: Record<string, RelativeDatePreset> = {
    today: 'today',
    thisweek: 'thisWeek',
    pastweek: 'pastWeek',
    nextweek: 'nextWeek',
    thismonth: 'thisMonth',
    thisyear: 'thisYear',
};

/**
 * Parse a date flag value into a DateFilterValue.
 * Accepts absolute dates (YYYY-MM-DD) and preset names (today, thisWeek, next7days, etc.).
 * Returns null if the input doesn't match any valid format or preset.
 */
export function parseDatePreset(input: string): DateFilterValue | null {
    const normalized = input.trim().toLowerCase();

    // Absolute date: YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        return normalized;
    }

    // nextNdays pattern (e.g., next7days)
    const nextNMatch = normalized.match(/^next(\d+)days$/);
    if (nextNMatch) {
        return { preset: 'nextNDays', n: parseInt(nextNMatch[1], 10) };
    }

    // Named presets
    const preset = PRESET_MAP[normalized];
    if (preset) {
        return { preset };
    }

    return null;
}
