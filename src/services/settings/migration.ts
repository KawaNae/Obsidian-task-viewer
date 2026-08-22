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

/**
 * Settings written by an older version, brought up to the current shape.
 *
 * Runs every load, on the raw object straight out of `loadData()` and before
 * the defaults are merged in — a legacy value has to land on its new key
 * while that key is still absent, or the merge would paper over it with a
 * default. Each step is idempotent, so a vault that has already been through
 * this comes out unchanged.
 */
export function migrateSettings(raw: Record<string, unknown>): void {
    migrateLegacyKeyNames(raw);
    migrateAstronomySettings(raw);
    migrateDoubleTapAction(raw);
}

/**
 * v0.33 → v0.34: the `Frontmatter*` names became `Tv*`.
 *
 * The old key is dropped whether or not it was transcribed, so the next
 * `saveSettings` writes a file with no legacy names left in it. A new key that
 * already holds a value wins — it was written by a newer version than the one
 * that wrote the old key.
 */
function migrateLegacyKeyNames(raw: Record<string, unknown>): void {
    const RENAMES: ReadonlyArray<readonly [string, string]> = [
        ['frontmatterTaskKeys', 'tvFileKeys'],
        ['frontmatterTaskHeader', 'tvFileChildHeader'],
        ['frontmatterTaskHeaderLevel', 'tvFileChildHeaderLevel'],
        ['fileMenuForFrontmatterTasks', 'fileMenuForTvFile'],
        ['calendarWeekStartDay', 'weekStartDay'],
    ];
    for (const [oldKey, newKey] of RENAMES) {
        if (raw[oldKey] !== undefined && raw[newKey] === undefined) {
            raw[newKey] = raw[oldKey];
        }
        delete raw[oldKey];
    }
}

/**
 * v0.44 → v0.45: `properties` was absorbed by the task hub, which `detail`
 * already opens.
 */
function migrateDoubleTapAction(raw: Record<string, unknown>): void {
    if (raw.doubleTapAction === 'properties') {
        raw.doubleTapAction = 'detail';
    }
}
