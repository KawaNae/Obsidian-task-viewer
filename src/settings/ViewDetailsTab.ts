import { Setting } from 'obsidian';
import TaskViewerPlugin from '../main';
import { t } from '../i18n';

export function render(el: HTMLElement, plugin: TaskViewerPlugin): void {
    // Timeline
    el.createEl('h3', { text: t('settings.views.timeline'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.views.pastDaysToShow'))
        .setDesc(t('settings.views.pastDaysToShowDesc'))
        .addText(text => {
            text.inputEl.type = 'number';
            text.inputEl.min = '0';
            text
                .setPlaceholder('0')
                .setValue(plugin.settings.pastDaysToShow.toString())
                .onChange(async (value) => {
                    let days = parseInt(value);
                    if (isNaN(days) || days < 0) days = 0;
                    plugin.settings.pastDaysToShow = days;
                    await plugin.saveSettings();
                });
        });

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

    // Calendar / Mini Calendar
    el.createEl('h3', { text: t('settings.views.calendarMiniCalendar'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.views.weekStartsOn'))
        .setDesc(t('settings.views.weekStartsOnDesc'))
        .addDropdown(dropdown => dropdown
            .addOption('0', t('settings.views.sunday'))
            .addOption('1', t('settings.views.monday'))
            .setValue(String(plugin.settings.calendarWeekStartDay))
            .onChange(async (value) => {
                plugin.settings.calendarWeekStartDay = value === '1' ? 1 : 0;
                await plugin.saveSettings();
            }));

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

    new Setting(el)
        .setName(t('settings.views.customWorkMinutes'))
        .setDesc(t('settings.views.customWorkMinutesDesc'))
        .addText(text => {
            text.inputEl.type = 'number';
            text.inputEl.min = '1';
            text
                .setPlaceholder('25')
                .setValue(plugin.settings.pomodoroWorkMinutes.toString())
                .onChange(async (value) => {
                    let mins = parseInt(value);
                    if (isNaN(mins) || mins < 1) mins = 1;
                    plugin.settings.pomodoroWorkMinutes = mins;
                    await plugin.saveSettings();
                });
        });

    new Setting(el)
        .setName(t('settings.views.customBreakMinutes'))
        .setDesc(t('settings.views.customBreakMinutesDesc'))
        .addText(text => {
            text.inputEl.type = 'number';
            text.inputEl.min = '1';
            text
                .setPlaceholder('5')
                .setValue(plugin.settings.pomodoroBreakMinutes.toString())
                .onChange(async (value) => {
                    let mins = parseInt(value);
                    if (isNaN(mins) || mins < 1) mins = 1;
                    plugin.settings.pomodoroBreakMinutes = mins;
                    await plugin.saveSettings();
                });
        });

    // Pinned Lists
    el.createEl('h3', { text: t('settings.views.pinnedLists'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.views.tasksPerPage'))
        .setDesc(t('settings.views.tasksPerPageDesc'))
        .addText(text => {
            text.inputEl.type = 'number';
            text.inputEl.min = '1';
            text
                .setPlaceholder('10')
                .setValue(plugin.settings.pinnedListPageSize.toString())
                .onChange(async (value) => {
                    let n = parseInt(value);
                    if (isNaN(n) || n < 1) n = 10;
                    plugin.settings.pinnedListPageSize = n;
                    await plugin.saveSettings();
                });
        });
}
