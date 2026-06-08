import SunCalc from 'suncalc';
import type { AstronomyDisplay, AstronomySettings } from '../../types';

/**
 * Pure wrappers around SunCalc + a moon-phase SVG generator. No DOM, no I/O.
 *
 * lat/lon are required for sun calculations; moon illumination is observer-
 * independent in practice (< sub-minute jitter) so it ignores location.
 *
 * Polar / extreme inputs produce `null` (SunCalc returns Invalid Date in those
 * cases). Callers are expected to skip rendering when null.
 */

export interface SunTimes {
    sunrise: Date | null;
    sunset: Date | null;
}

export interface MoonIllumination {
    /** 0..1, fraction of disk illuminated */
    fraction: number;
    /** 0..1: 0=new, 0.25=first quarter, 0.5=full, 0.75=last quarter */
    phase: number;
    /** Bright-limb angle in radians (SunCalc semantics, unused by SVG) */
    angle: number;
}

export type MoonPhaseName =
    | 'newMoon'
    | 'waxingCrescent'
    | 'firstQuarter'
    | 'waxingGibbous'
    | 'fullMoon'
    | 'waningGibbous'
    | 'lastQuarter'
    | 'waningCrescent';

const isValidDate = (d: Date | undefined | null): d is Date =>
    d instanceof Date && !isNaN(d.getTime());

/**
 * Compose the effective astronomy display flags for a view by overlaying a
 * per-instance partial override on top of the global settings. The single
 * resolution point for every view: each renderer calls this and never reads
 * `settings.astronomy.display` directly, so adding a new overlay flag only
 * touches the `AstronomyDisplay` interface and the renderer consuming it.
 */
export function getEffectiveAstronomyDisplay(
    instance: Partial<AstronomyDisplay> | undefined,
    settings: AstronomySettings,
): AstronomyDisplay {
    return {
        sunTimes:  instance?.sunTimes  ?? settings.display.sunTimes,
        moonPhase: instance?.moonPhase ?? settings.display.moonPhase,
    };
}

export function getSunTimes(date: Date, lat: number, lon: number): SunTimes {
    const t = SunCalc.getTimes(date, lat, lon);
    return {
        sunrise: isValidDate(t.sunrise) ? t.sunrise : null,
        sunset: isValidDate(t.sunset) ? t.sunset : null,
    };
}

export function getMoonIllumination(date: Date): MoonIllumination {
    return SunCalc.getMoonIllumination(date);
}

/**
 * Map SunCalc phase value (0..1) to a discrete name. Quarter points use a
 * small tolerance so e.g. fraction 0.49/0.51 still register as "near full".
 */
export function getMoonPhaseName(phase: number): MoonPhaseName {
    const TOL = 0.02;
    const p = ((phase % 1) + 1) % 1; // normalize negative / overflow
    if (p < TOL || p > 1 - TOL) return 'newMoon';
    if (Math.abs(p - 0.25) < TOL) return 'firstQuarter';
    if (Math.abs(p - 0.5) < TOL) return 'fullMoon';
    if (Math.abs(p - 0.75) < TOL) return 'lastQuarter';
    if (p < 0.25) return 'waxingCrescent';
    if (p < 0.5) return 'waxingGibbous';
    if (p < 0.75) return 'waningGibbous';
    return 'waningCrescent';
}

export interface MoonPhaseSvgOptions {
    size?: number;
    darkColor?: string;
    strokeColor?: string;
}

/**
 * Build an inline SVG string showing the illuminated portion of the moon.
 *
 * Construction: a dark stroked disk + a `<path>` for the lit region. The lit
 * region is bounded by two arcs that meet at the top and bottom of the disk:
 * one half of the disk's outline (outer) and one half of an ellipse whose
 * horizontal radius shrinks from r (new/full) to 0 (quarter) and back. Sweep
 * flags pick the curve direction so the path traces either a crescent or a
 * gibbous shape, mirrored for waxing vs. waning.
 *
 * `fraction` near 0 / 1 is special-cased to avoid degenerate (full-disk) paths.
 */
export function buildMoonPhaseSvg(
    illumination: { fraction: number; phase: number },
    options: MoonPhaseSvgOptions = {},
): string {
    const size = options.size ?? 16;
    const darkColor = options.darkColor ?? 'transparent';
    const strokeColor = options.strokeColor ?? 'currentColor';

    const r = size / 2 - 1;
    const cx = size / 2;
    const cy = size / 2;

    const fraction = Math.max(0, Math.min(1, illumination.fraction));
    const phase = illumination.phase;
    const waxing = phase < 0.5;

    let litPath = '';
    if (fraction < 0.02) {
        litPath = '';
    } else if (fraction > 0.98) {
        litPath = `M ${cx},${cy - r} A ${r},${r} 0 1 1 ${cx},${cy + r} A ${r},${r} 0 1 1 ${cx},${cy - r} Z`;
    } else {
        const innerR = Math.abs(2 * fraction - 1) * r;
        const isCrescent = fraction < 0.5;
        const outerSweep = waxing ? 1 : 0;
        // Sweep flags pick which side of the inner ellipse half to traverse.
        // Derivation by case:
        //   waxing crescent → terminator bulges into the right lit side
        //                     (inner arc traces the *right* half of the ellipse;
        //                      sweep=0 from bottom-to-top on screen)
        //   waxing gibbous  → inner arc traces the *left* half  (sweep=1)
        //   waning crescent → inner arc traces the *left* half  (sweep=1)
        //   waning gibbous  → inner arc traces the *right* half (sweep=0)
        const innerSweep = waxing
            ? (isCrescent ? 0 : 1)
            : (isCrescent ? 1 : 0);
        litPath = `M ${cx},${cy - r} A ${r},${r} 0 0 ${outerSweep} ${cx},${cy + r} A ${innerR.toFixed(3)},${r} 0 0 ${innerSweep} ${cx},${cy - r} Z`;
    }

    const stroke = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${darkColor}" stroke="${strokeColor}" stroke-width="0.5"/>`;
    // Lit-region fill is driven by CSS (.moon-phase__lit → --tv-astro-moon-lit)
    // so the moon tracks the theme like the sun lines, rather than a baked hex.
    const lit = litPath ? `<path d="${litPath}" class="moon-phase__lit"/>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${stroke}${lit}</svg>`;
}
