import { moment } from 'obsidian';

const WEEK_LOCALE_PREFIX = 'tv-week-';

function localeName(weekStartDay: 0 | 1): string {
    return `${WEEK_LOCALE_PREFIX}${weekStartDay}`;
}

/**
 * Registers tv-week-0 / tv-week-1 locales that inherit everything from the
 * current Obsidian moment locale except `week.dow` / `week.doy`. Idempotent —
 * safe to call on every plugin onload. The implementation has to call
 * `moment.locale(prev)` after defineLocale because moment.defineLocale
 * switches the global locale as a side effect.
 *
 * Must be called once at plugin onload before any view renders, so that
 * `withWeekStartDay` can resolve the registered locale.
 */
export function registerWeekStartLocales(): void {
    const prev = moment.locale();
    const registered = moment.locales();
    if (!registered.includes(localeName(0))) {
        moment.defineLocale(localeName(0), {
            parentLocale: prev,
            week: { dow: 0, doy: 6 },
        });
    }
    if (!registered.includes(localeName(1))) {
        moment.defineLocale(localeName(1), {
            parentLocale: prev,
            week: { dow: 1, doy: 4 },
        });
    }
    moment.locale(prev);
}

/**
 * Returns a Moment instance bound to the locale whose week boundary matches
 * `weekStartDay`. All other locale aspects (month names, weekday names, time
 * format) are inherited from the user's Obsidian locale via parentLocale.
 *
 * Single entry point for any `format(...)` or `.week()` call that may emit
 * week-relevant output (filename, label, week number). For non-week tokens
 * (YYYY/MM/DD/HH:mm/...) the result is identical to plain `moment(date)`, so
 * routing everything through it is harmless and gives a uniform contract.
 */
export function withWeekStartDay(date: Date, weekStartDay: 0 | 1): moment.Moment {
    return moment(date).locale(localeName(weekStartDay));
}
