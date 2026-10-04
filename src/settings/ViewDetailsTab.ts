import { Setting } from 'obsidian';
import type { PluginContext } from '../PluginContext';
import { t } from '../i18n';
import type { TaskViewerSettings } from '../types';
import { SETTINGS_SCHEMA } from './SettingsSchema';
import type { SettingFields } from './SettingFields';

type CountKey = 'pastDaysToShow' | 'pomodoroWorkMinutes' | 'pomodoroBreakMinutes' | 'pinnedListPageSize';

export function render(el: HTMLElement, plugin: PluginContext, fields: SettingFields): void {
    /** A whole number of the settings, read by its range in the settings' table. */
    const count = (setting: Setting, key: CountKey, placeholder: string) => fields.text(setting, {
        codec: SETTINGS_SCHEMA[key].codec,
        get: () => plugin.settings[key],
        put: (n: TaskViewerSettings[CountKey]) => { plugin.settings[key] = n; },
        placeholder,
        inputMode: 'numeric',
    });

    // Timeline
    el.createEl('h3', { text: t('settings.views.timeline'), cls: 'setting-section-header' });

    count(new Setting(el)
        .setName(t('settings.views.pastDaysToShow'))
        .setDesc(t('settings.views.pastDaysToShowDesc')), 'pastDaysToShow', '0');

    new Setting(el)
        .setName(t('settings.views.startFromOldestOverdue'))
        .setDesc(t('settings.views.startFromOldestOverdueDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.startFromOldestOverdue)
            .onChange(async (value) => {
                plugin.settings.startFromOldestOverdue = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.views.defaultZoomLevel'))
        .setDesc(t('settings.views.defaultZoomLevelDesc'))
        .addSlider(slider => slider
            .setLimits(0.25, 10.0, 0.25)
            .setValue(plugin.settings.zoomLevel)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.zoomLevel = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.views.showAllDay'))
        .setDesc(t('settings.views.showAllDayDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.showAllDay)
            .onChange(async (value) => {
                plugin.settings.showAllDay = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.views.showTimeline'))
        .setDesc(t('settings.views.showTimelineDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.showTimeline)
            .onChange(async (value) => {
                plugin.settings.showTimeline = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.views.showWeekRow'))
        .setDesc(t('settings.views.showWeekRowDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.showWeekRow)
            .onChange(async (value) => {
                plugin.settings.showWeekRow = value;
                await plugin.saveSettings();
            }));

    // Calendar / Mini Calendar
    el.createEl('h3', { text: t('settings.views.calendarMiniCalendar'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.views.showWeekNumbers'))
        .setDesc(t('settings.views.showWeekNumbersDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.calendarShowWeekNumbers)
            .onChange(async (value) => {
                plugin.settings.calendarShowWeekNumbers = value;
                await plugin.saveSettings();
            }));

    // Timer
    el.createEl('h3', { text: t('settings.views.timer'), cls: 'setting-section-header' });

    count(new Setting(el)
        .setName(t('settings.views.customWorkMinutes'))
        .setDesc(t('settings.views.customWorkMinutesDesc')), 'pomodoroWorkMinutes', '25');

    count(new Setting(el)
        .setName(t('settings.views.customBreakMinutes'))
        .setDesc(t('settings.views.customBreakMinutesDesc')), 'pomodoroBreakMinutes', '5');

    // Pinned Lists
    el.createEl('h3', { text: t('settings.views.pinnedLists'), cls: 'setting-section-header' });

    count(new Setting(el)
        .setName(t('settings.views.tasksPerPage'))
        .setDesc(t('settings.views.tasksPerPageDesc')), 'pinnedListPageSize', '10');
}
