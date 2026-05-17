import { setIcon, setTooltip } from 'obsidian';
import {
    buildMoonPhaseSvg,
    getMoonIllumination,
    getMoonPhaseName,
    getSunTimes,
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
    const referenceDate = new Date(`${date}T12:00:00`);
    const { sunrise, sunset } = getSunTimes(referenceDate, latitude, longitude);

    const append = (sunDate: Date | null, variant: 'sunrise' | 'sunset'): boolean => {
        if (!sunDate) return false;
        const clockMinutes = sunDate.getHours() * 60 + sunDate.getMinutes();
        let minutesFromStart = clockMinutes - startHour * 60;
        if (minutesFromStart < 0) minutesFromStart += 24 * 60;

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
    if (append(sunrise, 'sunrise')) count++;
    if (append(sunset, 'sunset')) count++;
    return count;
}

/**
 * Attach small sunrise/sunset Lucide icons to a time-axis container. The
 * icons land at the same vertical position as the horizontal sun lines and
 * give the lines a recognizable anchor in the axis column (which otherwise
 * shows only hour numbers).
 *
 * Positioning contract is identical to `attachSunIndicators`: `minutesToTopPx`
 * is honored when provided (for adaptive grids), otherwise the helper falls
 * back to setting the `--indicator-minutes` CSS variable and lets the stylesheet
 * compute `top: calc(... * --hour-height / 60)`.
 *
 * Returns the count of attached icons. Polar latitudes that yield Invalid
 * Date are skipped silently.
 */
export function attachSunAxisIcons(
    container: HTMLElement,
    date: string,
    options: AttachSunIndicatorsOptions,
): number {
    const { startHour, latitude, longitude, minutesToTopPx } = options;
    const referenceDate = new Date(`${date}T12:00:00`);
    const { sunrise, sunset } = getSunTimes(referenceDate, latitude, longitude);

    const append = (sunDate: Date | null, variant: 'sunrise' | 'sunset'): boolean => {
        if (!sunDate) return false;
        const clockMinutes = sunDate.getHours() * 60 + sunDate.getMinutes();
        let minutesFromStart = clockMinutes - startHour * 60;
        if (minutesFromStart < 0) minutesFromStart += 24 * 60;

        let absoluteTopPx: number | null = null;
        if (minutesToTopPx) {
            absoluteTopPx = minutesToTopPx(minutesFromStart);
            if (absoluteTopPx === null) return false;
        }

        const el = container.createDiv(`sun-axis-icon sun-axis-icon--${variant}`);
        setIcon(el, variant);
        if (absoluteTopPx !== null) {
            el.style.top = `${absoluteTopPx}px`;
        } else {
            el.style.setProperty('--indicator-minutes', String(minutesFromStart));
        }

        // Vertical offset: shift the icon away from the nearest hour-boundary
        // so it doesn't sit on top of the hour-number text. The line itself
        // stays at the exact event time; the icon hovers ~14px above or below
        // it depending on which half of the hour the event falls in.
        const minuteInHour = minutesFromStart % 60;
        const AXIS_ICON_SHIFT_PX = 14;
        const shiftPx = (minuteInHour < 30 ? +1 : -1) * AXIS_ICON_SHIFT_PX;
        el.style.setProperty('--axis-icon-shift', `${shiftPx}px`);

        const timeLabel = `${String(sunDate.getHours()).padStart(2, '0')}:${String(sunDate.getMinutes()).padStart(2, '0')}`;
        setTooltip(el, `${t(`astronomy.${variant}`)} ${timeLabel}`);
        return true;
    };

    let count = 0;
    if (append(sunrise, 'sunrise')) count++;
    if (append(sunset, 'sunset')) count++;
    return count;
}
