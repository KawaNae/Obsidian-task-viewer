import type { Menu, MenuItem } from 'obsidian';
import { t } from '../../i18n';
import type { AstronomyDisplay, AstronomySettings } from '../../types';
import { getEffectiveAstronomyDisplay } from '../../services/astronomy/AstronomyService';

export interface AstronomyMenuSectionOptions {
    /** Which overlay toggles to show. Calendar / Schedule pass moon only. */
    overlays: Array<'sunTimes' | 'moonPhase'>;
    /** Global settings (used to compute the "effective" indicator). */
    settings: AstronomySettings;
    /** Current per-view override snapshot. */
    instance: Partial<AstronomyDisplay> | undefined;
    /** Receives a new per-view override (or undefined to clear it). */
    onChange: (next: Partial<AstronomyDisplay> | undefined) => void;
}

const OVERLAY_LABELS: Record<'sunTimes' | 'moonPhase', () => string> = {
    sunTimes: () => t('viewOptions.toggleSunTimes'),
    moonPhase: () => t('viewOptions.toggleMoonPhase'),
};

/**
 * Adds astronomy overlay toggles + a "follow global" reset entry to the
 * given Menu. The single source of truth for the menu shape so each view
 * toolbar wires it identically. Per-view overrides are explicit boolean
 * sets; the reset entry clears the override block so the view follows
 * `settings.astronomy.display` again.
 */
export function appendAstronomyMenuSection(menu: Menu, opts: AstronomyMenuSectionOptions): void {
    const effective = getEffectiveAstronomyDisplay(opts.instance, opts.settings);

    for (const key of opts.overlays) {
        menu.addItem((item: MenuItem) => {
            item.setTitle(OVERLAY_LABELS[key]())
                .setChecked(effective[key])
                .onClick(() => {
                    const next: Partial<AstronomyDisplay> = { ...(opts.instance ?? {}) };
                    next[key] = !effective[key];
                    opts.onChange(next);
                });
        });
    }

    // "Follow global" — clears the per-view override entirely. Disabled when
    // no override is set so its semantic ("revert to global") stays honest.
    const hasOverride = opts.instance != null && Object.keys(opts.instance).length > 0;
    menu.addItem((item: MenuItem) => {
        item.setTitle(t('viewOptions.followGlobalAstronomy'))
            .setIcon('rotate-ccw')
            .setDisabled(!hasOverride)
            .onClick(() => opts.onChange(undefined));
    });
}
