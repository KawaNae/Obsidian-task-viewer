import { describe, it, expect } from 'vitest';
import { migrateAstronomySettings } from '../../../src/services/settings/migration';

describe('migrateAstronomySettings', () => {
    it('no-ops when no legacy fields present', () => {
        const raw: Record<string, unknown> = { startHour: 5 };
        migrateAstronomySettings(raw);
        expect(raw).toEqual({ startHour: 5 });
    });

    it('migrates a fully-populated flat shape into the nested block', () => {
        const raw: Record<string, unknown> = {
            showSunTimes: true,
            showMoonPhase: true,
            homeLatitude: 50.1,
            homeLongitude: 14.4,
            startHour: 4,
        };
        migrateAstronomySettings(raw);
        expect(raw).toEqual({
            startHour: 4,
            astronomy: {
                display: { sunTimes: true, moonPhase: true },
                location: { latitude: 50.1, longitude: 14.4 },
            },
        });
    });

    it('fills missing fields with defaults', () => {
        const raw: Record<string, unknown> = {
            showMoonPhase: true,
            // sunTimes, lat, lon all missing → defaults filled in
        };
        migrateAstronomySettings(raw);
        const astronomy = raw.astronomy as Record<string, Record<string, unknown>>;
        expect(astronomy.display.sunTimes).toBe(false); // default
        expect(astronomy.display.moonPhase).toBe(true);
        expect(typeof astronomy.location.latitude).toBe('number');
        expect(typeof astronomy.location.longitude).toBe('number');
    });

    it('drops legacy keys after migration', () => {
        const raw: Record<string, unknown> = {
            showSunTimes: false,
            showMoonPhase: false,
            homeLatitude: 0,
            homeLongitude: 0,
        };
        migrateAstronomySettings(raw);
        expect('showSunTimes' in raw).toBe(false);
        expect('showMoonPhase' in raw).toBe(false);
        expect('homeLatitude' in raw).toBe(false);
        expect('homeLongitude' in raw).toBe(false);
    });

    it('keeps existing nested astronomy when both shapes coexist', () => {
        const raw: Record<string, unknown> = {
            showSunTimes: true,    // legacy, but nested takes precedence
            astronomy: {
                display: { sunTimes: false, moonPhase: true },
                location: { latitude: 1, longitude: 2 },
            },
        };
        migrateAstronomySettings(raw);
        expect(raw.astronomy).toEqual({
            display: { sunTimes: false, moonPhase: true },
            location: { latitude: 1, longitude: 2 },
        });
        expect('showSunTimes' in raw).toBe(false);
    });

    it('is idempotent', () => {
        const raw: Record<string, unknown> = {
            showSunTimes: true,
            showMoonPhase: false,
            homeLatitude: 10,
            homeLongitude: 20,
        };
        migrateAstronomySettings(raw);
        const after1 = JSON.parse(JSON.stringify(raw));
        migrateAstronomySettings(raw);
        expect(raw).toEqual(after1);
    });
});
