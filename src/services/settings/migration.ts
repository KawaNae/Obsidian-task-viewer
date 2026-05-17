import { DEFAULT_SETTINGS } from '../../types';

/**
 * Migrates flat astronomy fields (v0.39) into nested `astronomy` structure
 * (v0.40+). Mutates the input object in place: deletes legacy keys and
 * inserts a normalized `astronomy` block when any legacy field is present.
 *
 * Idempotent — calling this on an already-migrated object is a no-op.
 *
 * Why a separate module: keeps migration logic out of `main.ts` (which pulls
 * in the Obsidian runtime), so it can be unit-tested in isolation.
 */
export function migrateAstronomySettings(raw: Record<string, unknown>): void {
    const LEGACY_KEYS = ['showSunTimes', 'showMoonPhase', 'homeLatitude', 'homeLongitude'] as const;
    const hasLegacy = LEGACY_KEYS.some(k => k in raw);
    if (!hasLegacy) return;

    // Build nested only if `astronomy` is not already set; otherwise keep the
    // existing nested config and just drop the legacy keys.
    if (!('astronomy' in raw) || typeof raw.astronomy !== 'object' || raw.astronomy === null) {
        const def = DEFAULT_SETTINGS.astronomy;
        const sunTimes = typeof raw.showSunTimes === 'boolean' ? raw.showSunTimes : def.display.sunTimes;
        const moonPhase = typeof raw.showMoonPhase === 'boolean' ? raw.showMoonPhase : def.display.moonPhase;
        const latitude = typeof raw.homeLatitude === 'number' ? raw.homeLatitude : def.location.latitude;
        const longitude = typeof raw.homeLongitude === 'number' ? raw.homeLongitude : def.location.longitude;
        raw.astronomy = {
            display: { sunTimes, moonPhase },
            location: { latitude, longitude },
        };
    }

    for (const k of LEGACY_KEYS) delete raw[k];
}
