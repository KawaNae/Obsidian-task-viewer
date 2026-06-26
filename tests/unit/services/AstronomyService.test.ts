import { describe, it, expect } from 'vitest';
import {
    getSunTimes,
    getMoonIllumination,
    getMoonPhaseName,
    buildMoonPhaseSvg,
    getEffectiveAstronomyDisplay,
} from '../../../src/services/astronomy/AstronomyService';
import type { AstronomySettings } from '../../../src/types';

describe('AstronomyService', () => {
    describe('getSunTimes', () => {
        it('returns valid sunrise and sunset for Tokyo around equinox', () => {
            const result = getSunTimes(new Date('2026-03-21T00:00:00Z'), 35.6762, 139.6503);
            expect(result.sunrise).not.toBeNull();
            expect(result.sunset).not.toBeNull();
            // sunrise must be before sunset on the same day
            expect(result.sunrise!.getTime()).toBeLessThan(result.sunset!.getTime());
        });

        it('returns null for polar summer (no sunset)', () => {
            // 78N June 21 — well inside the Arctic Circle, sun never sets
            const result = getSunTimes(new Date('2026-06-21T00:00:00Z'), 78, 15);
            expect(result.sunrise).toBeNull();
            expect(result.sunset).toBeNull();
        });
    });

    describe('getMoonIllumination', () => {
        it('returns fraction in [0, 1] and phase in [0, 1]', () => {
            const r = getMoonIllumination(new Date('2026-05-17T12:00:00Z'));
            expect(r.fraction).toBeGreaterThanOrEqual(0);
            expect(r.fraction).toBeLessThanOrEqual(1);
            expect(r.phase).toBeGreaterThanOrEqual(0);
            expect(r.phase).toBeLessThanOrEqual(1);
        });
    });

    describe('getMoonPhaseName', () => {
        it('maps quarter points within tolerance', () => {
            expect(getMoonPhaseName(0)).toBe('newMoon');
            expect(getMoonPhaseName(0.25)).toBe('firstQuarter');
            expect(getMoonPhaseName(0.5)).toBe('fullMoon');
            expect(getMoonPhaseName(0.75)).toBe('lastQuarter');
        });

        it('classifies intermediate phases', () => {
            expect(getMoonPhaseName(0.1)).toBe('waxingCrescent');
            expect(getMoonPhaseName(0.4)).toBe('waxingGibbous');
            expect(getMoonPhaseName(0.6)).toBe('waningGibbous');
            expect(getMoonPhaseName(0.9)).toBe('waningCrescent');
        });

        it('handles phase near 1 as new moon', () => {
            expect(getMoonPhaseName(0.99)).toBe('newMoon');
        });
    });

    describe('buildMoonPhaseSvg', () => {
        it('returns an SVG string with a circle outline', () => {
            const svg = buildMoonPhaseSvg({ fraction: 0.5, phase: 0.25 });
            expect(svg).toContain('<svg');
            expect(svg).toContain('</svg>');
            expect(svg).toContain('<circle');
        });

        it('omits lit path for new moon (fraction ~0)', () => {
            const svg = buildMoonPhaseSvg({ fraction: 0, phase: 0 });
            expect(svg).not.toContain('<path');
        });

        it('renders full disk for full moon (fraction ~1)', () => {
            const svg = buildMoonPhaseSvg({ fraction: 1, phase: 0.5 });
            expect(svg).toContain('<path');
        });

        it('renders crescent for waxing crescent', () => {
            const svg = buildMoonPhaseSvg({ fraction: 0.25, phase: 0.1 });
            expect(svg).toContain('<path');
        });

        it('waxing crescent inner arc traces the right side (sweep=0)', () => {
            // Two arcs in the lit path; the *second* arc is the terminator.
            // For waxing crescent the sweep flag of that arc must be 0.
            const svg = buildMoonPhaseSvg({ fraction: 0.1, phase: 0.05 });
            const arcMatches = svg.match(/A [^A]+/g) ?? [];
            expect(arcMatches.length).toBe(2);
            // Last sweep flag in the inner arc command (format: "rx,ry 0 0 sweep x,y")
            expect(arcMatches[1]).toMatch(/0 0 0 /);
        });

        it('waxing gibbous inner arc traces the left side (sweep=1)', () => {
            const svg = buildMoonPhaseSvg({ fraction: 0.9, phase: 0.4 });
            const arcMatches = svg.match(/A [^A]+/g) ?? [];
            expect(arcMatches.length).toBe(2);
            expect(arcMatches[1]).toMatch(/0 0 1 /);
        });

        it('waning crescent inner arc traces the left side (sweep=1)', () => {
            const svg = buildMoonPhaseSvg({ fraction: 0.1, phase: 0.95 });
            const arcMatches = svg.match(/A [^A]+/g) ?? [];
            expect(arcMatches.length).toBe(2);
            expect(arcMatches[1]).toMatch(/0 0 1 /);
        });

        it('respects size option', () => {
            const svg = buildMoonPhaseSvg({ fraction: 0.5, phase: 0.25 }, { size: 32 });
            expect(svg).toContain('width="32"');
            expect(svg).toContain('height="32"');
        });
    });

    describe('getEffectiveAstronomyDisplay', () => {
        const settings: AstronomySettings = {
            display: { sunTimes: true, moonPhase: false, sunTimesInFront: false },
            location: { latitude: 0, longitude: 0 },
        };

        it('falls back to settings when no instance override', () => {
            expect(getEffectiveAstronomyDisplay(undefined, settings)).toEqual({
                sunTimes: true, moonPhase: false, sunTimesInFront: false,
            });
        });

        it('falls back to settings when instance is empty object', () => {
            expect(getEffectiveAstronomyDisplay({}, settings)).toEqual({
                sunTimes: true, moonPhase: false, sunTimesInFront: false,
            });
        });

        it('respects partial override (sunTimes only)', () => {
            expect(getEffectiveAstronomyDisplay({ sunTimes: false }, settings)).toEqual({
                sunTimes: false, moonPhase: false, sunTimesInFront: false,
            });
        });

        it('respects full override', () => {
            expect(getEffectiveAstronomyDisplay({ sunTimes: false, moonPhase: true, sunTimesInFront: true }, settings)).toEqual({
                sunTimes: false, moonPhase: true, sunTimesInFront: true,
            });
        });

        it('treats explicit false as authoritative (not fallback)', () => {
            const onSettings: AstronomySettings = {
                display: { sunTimes: true, moonPhase: true, sunTimesInFront: true },
                location: { latitude: 0, longitude: 0 },
            };
            expect(getEffectiveAstronomyDisplay({ moonPhase: false }, onSettings)).toEqual({
                sunTimes: true, moonPhase: false, sunTimesInFront: true,
            });
        });

        it('defaults sunTimesInFront to false when missing from legacy settings', () => {
            // Settings persisted before this field existed lack it entirely.
            const legacy = {
                display: { sunTimes: true, moonPhase: true } as AstronomySettings['display'],
                location: { latitude: 0, longitude: 0 },
            };
            expect(getEffectiveAstronomyDisplay(undefined, legacy).sunTimesInFront).toBe(false);
        });

        it('respects sunTimesInFront override', () => {
            expect(getEffectiveAstronomyDisplay({ sunTimesInFront: true }, settings).sunTimesInFront).toBe(true);
        });
    });
});
