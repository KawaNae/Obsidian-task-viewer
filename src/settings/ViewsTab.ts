import { Setting } from 'obsidian';
import TaskViewerPlugin from '../main';
import { DefaultLeafPosition, TaskViewerSettings } from '../types';
import { t } from '../i18n';

export function render(el: HTMLElement, plugin: TaskViewerPlugin): void {
    // Navigation
    el.createEl('h3', { text: t('settings.views.navigation'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.views.reuseExistingTab'))
        .setDesc(t('settings.views.reuseExistingTabDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.reuseExistingTab)
            .onChange(async (value) => {
                plugin.settings.reuseExistingTab = value;
                await plugin.saveSettings();
            }));

    // Default Open Position
    el.createEl('h3', { text: t('settings.views.defaultOpenPosition'), cls: 'setting-section-header' });

    new Setting(el)
        .setDesc(t('settings.views.defaultOpenPositionDesc'))
        .setClass('setting-item--desc-only');

    type ViewPositionKey = keyof TaskViewerSettings['defaultViewPositions'];
    const positionEntries: { label: string; key: ViewPositionKey }[] = [
        { label: t('settings.views.positionTimeline'), key: 'timeline' },
        { label: t('settings.views.positionSchedule'), key: 'schedule' },
        { label: t('settings.views.positionCalendar'), key: 'calendar' },
        { label: t('settings.views.positionMiniCalendar'), key: 'miniCalendar' },
        { label: t('settings.views.positionTimer'), key: 'timer' },
        { label: t('settings.views.positionKanban'), key: 'kanban' },
    ];

    for (const entry of positionEntries) {
        new Setting(el)
            .setName(entry.label)
            .addDropdown(dropdown => dropdown
                .addOption('left', t('position.leftSidebar'))
                .addOption('right', t('position.rightSidebar'))
                .addOption('tab', t('position.tab'))
                .addOption('window', t('position.window'))
                .setValue(plugin.settings.defaultViewPositions[entry.key])
                .onChange(async (value) => {
                    plugin.settings.defaultViewPositions[entry.key] = value as DefaultLeafPosition;
                    await plugin.saveSettings();
                }));
    }

    // Display
    el.createEl('h3', { text: t('settings.views.display'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.views.hideViewHeader'))
        .setDesc(t('settings.views.hideViewHeaderDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.hideViewHeader)
            .onChange(async (value) => {
                plugin.settings.hideViewHeader = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.views.allDayPartialTracks'))
        .setDesc(t('settings.views.allDayPartialTracksDesc'))
        .addSlider(slider => slider
            .setLimits(1, 8, 1)
            .setValue(plugin.settings.allDayPartialTracks)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.allDayPartialTracks = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.views.mobileTopOffset'))
        .setDesc(t('settings.views.mobileTopOffsetDesc'))
        .addText(text => {
            text.inputEl.type = 'number';
            text.inputEl.min = '0';
            text
                .setPlaceholder('32')
                .setValue(plugin.settings.mobileTopOffset.toString())
                .onChange(async (value) => {
                    let offset = parseInt(value);
                    if (isNaN(offset) || offset < 0) offset = 32;
                    plugin.settings.mobileTopOffset = offset;
                    await plugin.saveSettings();
                });
        });

    new Setting(el)
        .setName(t('settings.views.fixMobileGradientWidth'))
        .setDesc(t('settings.views.fixMobileGradientWidthDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.fixMobileGradientWidth)
            .onChange(async (value) => {
                plugin.settings.fixMobileGradientWidth = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.views.childCollapseThreshold'))
        .setDesc(t('settings.views.childCollapseThresholdDesc'))
        .addSlider(slider => slider
            .setLimits(1, 5, 1)
            .setValue(plugin.settings.childCollapseThreshold)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.childCollapseThreshold = value;
                await plugin.saveSettings();
            }));

    // Sun & Moon
    el.createEl('h3', { text: t('settings.views.sunAndMoon'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.views.showSunTimes'))
        .setDesc(t('settings.views.showSunTimesDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.astronomy.display.sunTimes)
            .onChange(async (value) => {
                plugin.settings.astronomy.display.sunTimes = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.views.showSunInFront'))
        .setDesc(t('settings.views.showSunInFrontDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.astronomy.display.sunTimesInFront)
            .onChange(async (value) => {
                plugin.settings.astronomy.display.sunTimesInFront = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.views.showMoonPhase'))
        .setDesc(t('settings.views.showMoonPhaseDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.astronomy.display.moonPhase)
            .onChange(async (value) => {
                plugin.settings.astronomy.display.moonPhase = value;
                await plugin.saveSettings();
            }));
}
