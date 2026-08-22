import { describe, it, expect } from 'vitest';
import { migrateAstronomySettings, migrateSettings } from '../../../src/services/settings/migration';

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

/**
 * The renames and the one enum value that moved.
 *
 * These ran inline in `loadSettings`, above the `DEFAULT_SETTINGS` merge, and
 * the order was the whole point: a legacy value has to reach its new key while
 * that key is still absent, because the merge fills absent keys with defaults
 * and a default is indistinguishable from a choice once it lands.
 */
describe('migrateSettings: legacy key names', () => {
    it('transcribes an old key onto its new name and drops the old one', () => {
        const raw: Record<string, unknown> = { frontmatterTaskHeader: '子要素' };
        migrateSettings(raw);
        expect(raw).toEqual({ tvFileChildHeader: '子要素' });
    });

    it('renames every key that moved in v0.33 → v0.34', () => {
        const raw: Record<string, unknown> = {
            frontmatterTaskKeys: { start: 'tv-start' },
            frontmatterTaskHeader: '子要素',
            frontmatterTaskHeaderLevel: 3,
            fileMenuForFrontmatterTasks: true,
            calendarWeekStartDay: 0,
        };
        migrateSettings(raw);
        expect(raw).toEqual({
            tvFileKeys: { start: 'tv-start' },
            tvFileChildHeader: '子要素',
            tvFileChildHeaderLevel: 3,
            fileMenuForTvFile: true,
            weekStartDay: 0,
        });
    });

    it('keeps the new key when both names are present', () => {
        // Both names means a newer version already wrote the new one.
        const raw: Record<string, unknown> = {
            frontmatterTaskHeader: '古い', tvFileChildHeader: '新しい',
        };
        migrateSettings(raw);
        expect(raw).toEqual({ tvFileChildHeader: '新しい' });
    });

    it('drops the legacy key even when nothing was transcribed', () => {
        // Mutation: move the delete inside the if and the old name survives
        // every save, so the settings file never stops carrying it.
        const raw: Record<string, unknown> = {
            frontmatterTaskHeader: '古い', tvFileChildHeader: '新しい',
        };
        migrateSettings(raw);
        expect('frontmatterTaskHeader' in raw).toBe(false);
    });

    it('transcribes a falsy legacy value rather than reading it as absent', () => {
        // Mutation: test the old key for truthiness instead of !== undefined
        // and `false` / `0` silently revert to their defaults.
        const raw: Record<string, unknown> = {
            fileMenuForFrontmatterTasks: false, calendarWeekStartDay: 0,
        };
        migrateSettings(raw);
        expect(raw).toEqual({ fileMenuForTvFile: false, weekStartDay: 0 });
    });
});

describe('migrateSettings: doubleTapAction', () => {
    it('sends the retired properties action to the hub', () => {
        const raw: Record<string, unknown> = { doubleTapAction: 'properties' };
        migrateSettings(raw);
        expect(raw.doubleTapAction).toBe('detail');
    });

    it('leaves the other actions alone', () => {
        const raw: Record<string, unknown> = { doubleTapAction: 'open' };
        migrateSettings(raw);
        expect(raw.doubleTapAction).toBe('open');
    });
});

describe('migrateSettings: as a whole', () => {
    it('runs every step in one pass', () => {
        const raw: Record<string, unknown> = {
            frontmatterTaskHeader: '子要素',
            showMoonPhase: true,
            doubleTapAction: 'properties',
        };
        migrateSettings(raw);
        expect(raw.tvFileChildHeader).toBe('子要素');
        expect(raw.astronomy).toBeDefined();
        expect(raw.doubleTapAction).toBe('detail');
    });

    it('is idempotent', () => {
        const raw: Record<string, unknown> = {
            frontmatterTaskHeader: '子要素',
            showSunTimes: true, showMoonPhase: false,
            homeLatitude: 10, homeLongitude: 20,
            doubleTapAction: 'properties',
        };
        migrateSettings(raw);
        const after = JSON.parse(JSON.stringify(raw));
        migrateSettings(raw);
        expect(raw).toEqual(after);
    });

    it('leaves a settings object written by the current version untouched', () => {
        const raw: Record<string, unknown> = { startHour: 5, doubleTapAction: 'detail' };
        migrateSettings(raw);
        expect(raw).toEqual({ startHour: 5, doubleTapAction: 'detail' });
    });
});
