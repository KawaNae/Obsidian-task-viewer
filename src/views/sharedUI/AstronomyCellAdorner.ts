import { setTooltip } from 'obsidian';
import {
    buildMoonPhaseSvg,
    getMoonIllumination,
    getMoonPhaseName,
    getSunTimes,
    type SunTimes,
} from '../../services/astronomy/AstronomyService';
import { t } from '../../i18n';

/**
 * Cell-level decorators for astronomy overlays. Pure DOM attach helpers — the
 * caller owns the cell, the adorner only inserts visual elements and binds the
 * tooltip via Obsidian's official API (no `title` attribute, so browser-native
 * tooltips never compete with Obsidian's).
 *
 * This module is the single attach point used by Calendar / Schedule / Timeline
 * for the moon phase icon. When a new astronomy overlay is added (e.g. tide,
 * meteor shower) the new attach function goes here so the wiring stays
 * centralized.
 */

export interface AttachMoonPhaseOptions {
    /** SVG side length in px. Default 16. */
    size?: number;
    /** Extra class added to the wrapper for view-specific positioning. */
    modifier?: string;
}

/**
 * Insert a moon-phase SVG span into `cell`, with tooltip describing the phase
 * name and illumination percent. Returns the created wrapper element so the
 * caller can apply layout-specific styling if needed.
 */
export function attachMoonPhase(
    cell: HTMLElement,
    date: string,
    options: AttachMoonPhaseOptions = {},
): HTMLElement {
    const { size = 16, modifier } = options;
    const illum = getMoonIllumination(new Date(`${date}T12:00:00`));
    const phaseName = getMoonPhaseName(illum.phase);
    const pct = Math.round(illum.fraction * 100);

    const wrap = cell.createSpan({ cls: 'moon-phase-inline' });
    if (modifier) wrap.addClass(modifier);
    wrap.innerHTML = buildMoonPhaseSvg(illum, { size });
    setTooltip(wrap, `${t(`moonPhase.${phaseName}`)} ${pct}%`);
    return wrap;
}

export interface AttachSunIndicatorsOptions {
    /** Local clock hour at which the visual day starts (matches plugin's
     *  `startHour` setting). Used to convert sunrise/sunset clock time into a
     *  minutes-from-start offset for absolute positioning. */
    startHour: number;
    /** Observer latitude / longitude in degrees. */
    latitude: number;
    longitude: number;
    /**
     * Optional absolute-pixel positioning callback. Used by views with
     * non-linear time grids (e.g. Schedule's adaptive grid). Receives the
     * minutes-from-startHour value and returns the desired `top` in px (or
     * `null` to skip rendering that line — useful when the event falls
     * outside the visible window). When omitted, the helper sets the
     * `--indicator-minutes` CSS variable instead (Timeline's linear grid).
     */
    minutesToTopPx?: (minutesFromStart: number) => number | null;
}

/**
 * Today's and the next calendar day's sun times for a visual-day column. The
 * next day is needed because an event before `startHour` belongs to the
 * column's early-morning band (the next calendar date) and should use that
 * day's actual sun time, not today's (they drift a few minutes day-to-day).
 */
function sunTimesForWrap(date: string, latitude: number, longitude: number): [SunTimes, SunTimes] {
    const today = new Date(`${date}T12:00:00`);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return [getSunTimes(today, latitude, longitude), getSunTimes(tomorrow, latitude, longitude)];
}

/**
 * Resolve a sun event's minutes-from-startHour offset. Events at/after
 * startHour use today's time; an event before startHour wraps into the next
 * calendar day's early-morning band and uses *that* day's sun time.
 */
function resolveSunPosition(
    variant: 'sunrise' | 'sunset',
    today: SunTimes,
    tomorrow: SunTimes,
    startHour: number,
): { minutesFromStart: number; sunDate: Date } | null {
    const todaySun = today[variant];
    if (!todaySun) return null;
    const todayMinutes = todaySun.getHours() * 60 + todaySun.getMinutes() - startHour * 60;
    if (todayMinutes >= 0) {
        return { minutesFromStart: todayMinutes, sunDate: todaySun };
    }
    const tomorrowSun = tomorrow[variant];
    if (!tomorrowSun) return null;
    const tomorrowMinutes = tomorrowSun.getHours() * 60 + tomorrowSun.getMinutes() - startHour * 60 + 24 * 60;
    return { minutesFromStart: tomorrowMinutes, sunDate: tomorrowSun };
}

/**
 * Append sunrise and sunset horizontal indicator <div>s to a time-axis
 * container (Timeline's day-column or Schedule's time-grid). The container is
 * expected to have a CSS rule that maps `--indicator-minutes` to a vertical
 * offset within a 24h grid (see `.sun-indicator` in `_timeline-grid.css`).
 *
 * Returns the count of attached lines (0, 1, or 2) — useful for tests / DOM
 * sanity checks. Polar latitudes that yield Invalid Date are skipped silently.
 *
 * Edge case (documented): when a sun event clock time falls before startHour
 * (e.g. sunrise 04:30 with startHour=5), we wrap by +24h so the indicator
 * lands at the bottom of the same column. This is consistent with how the
 * `current-time-indicator` handles the same wrap.
 */
export function attachSunIndicators(
    container: HTMLElement,
    date: string,
    options: AttachSunIndicatorsOptions,
): number {
    const { startHour, latitude, longitude, minutesToTopPx } = options;
    const [today, tomorrow] = sunTimesForWrap(date, latitude, longitude);

    const append = (variant: 'sunrise' | 'sunset'): boolean => {
        const resolved = resolveSunPosition(variant, today, tomorrow, startHour);
        if (!resolved) return false;
        const { minutesFromStart } = resolved;

        let absoluteTopPx: number | null = null;
        if (minutesToTopPx) {
            absoluteTopPx = minutesToTopPx(minutesFromStart);
            if (absoluteTopPx === null) return false;
        }

        const el = container.createDiv(`sun-indicator sun-indicator--${variant}`);
        if (absoluteTopPx !== null) {
            el.style.top = `${absoluteTopPx}px`;
        } else {
            el.style.setProperty('--indicator-minutes', String(minutesFromStart));
        }
        el.setAttribute('aria-hidden', 'true');
        return true;
    };

    let count = 0;
    if (append('sunrise')) count++;
    if (append('sunset')) count++;
    return count;
}

/**
 * Attach short vertical arrow marks at the intersection of the sun line and
 * the time-axis right border. The arrow points in the "night direction":
 * sunrise → upward (the time *before* sunrise is night), sunset → downward
 * (the time *after* sunset is night). The arrow sits on top of the column
 * border, giving the sun line a clear anchor without consuming axis width.
 *
 * Positioning contract is identical to `attachSunIndicators`: `minutesToTopPx`
 * is honored when provided (Schedule's adaptive grid); otherwise the
 * `--indicator-minutes` CSS variable drives the vertical position via the
 * stylesheet's `top: calc(... * --hour-height / 60)`.
 *
 * Returns the count of attached arrows. Polar latitudes that yield Invalid
 * Date are skipped silently.
 */
export function attachSunAxisArrows(
    container: HTMLElement,
    date: string,
    options: AttachSunIndicatorsOptions,
): number {
    const { startHour, latitude, longitude, minutesToTopPx } = options;
    const [today, tomorrow] = sunTimesForWrap(date, latitude, longitude);

    const append = (variant: 'sunrise' | 'sunset'): boolean => {
        const resolved = resolveSunPosition(variant, today, tomorrow, startHour);
        if (!resolved) return false;
        const { minutesFromStart, sunDate } = resolved;

        let absoluteTopPx: number | null = null;
        if (minutesToTopPx) {
            absoluteTopPx = minutesToTopPx(minutesFromStart);
            if (absoluteTopPx === null) return false;
        }

        const el = container.createDiv(`sun-axis-arrow sun-axis-arrow--${variant}`);
        el.innerHTML = buildArrowSvg(variant);
        if (absoluteTopPx !== null) {
            el.style.top = `${absoluteTopPx}px`;
        } else {
            el.style.setProperty('--indicator-minutes', String(minutesFromStart));
        }

        const timeLabel = `${String(sunDate.getHours()).padStart(2, '0')}:${String(sunDate.getMinutes()).padStart(2, '0')}`;
        setTooltip(el, `${t(`astronomy.${variant}`)} ${timeLabel}`);
        return true;
    };

    let count = 0;
    if (append('sunrise')) count++;
    if (append('sunset')) count++;
    return count;
}

/**
 * Inline SVG for the night-direction arrow. 8px wide × 24px tall: a vertical
 * shaft + a triangular head at one end. `currentColor` lets the parent
 * element drive the tint (sunrise gold vs sunset rose).
 */
function buildArrowSvg(variant: 'sunrise' | 'sunset'): string {
    if (variant === 'sunrise') {
        // Head at top, shaft extending downward toward the intersection.
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 24" width="8" height="24" aria-hidden="true">`
             + `<line x1="4" y1="7" x2="4" y2="24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`
             + `<polygon points="4,0 0,7 8,7" fill="currentColor"/>`
             + `</svg>`;
    }
    // sunset: head at bottom, shaft extending upward from the intersection.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 24" width="8" height="24" aria-hidden="true">`
         + `<line x1="4" y1="0" x2="4" y2="17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`
         + `<polygon points="4,24 0,17 8,17" fill="currentColor"/>`
         + `</svg>`;
}
