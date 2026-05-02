import { Setting } from 'obsidian';
import TaskViewerPlugin from '../main';
import { DefaultLeafPosition, TaskViewerSettings } from '../types';
import { t } from '../i18n';
import { FolderSuggest } from '../suggest/FolderSuggest';

export function render(el: HTMLElement, plugin: TaskViewerPlugin): void {
    // Start Hour (top-level, shared across views)
    new Setting(el)
        .setName(t('settings.views.startHour'))
        .setDesc(t('settings.views.startHourDesc'))
        .addText(text => text
            .setPlaceholder('5')
            .setValue(plugin.settings.startHour.toString())
            .onChange(async (value) => {
                let hour = parseInt(value);
                if (isNaN(hour)) hour = 0;
                if (hour < 0) hour = 0;
                if (hour > 23) hour = 23;
                plugin.settings.startHour = hour;
                await plugin.saveSettings();
            }));

    // Templates
    el.createEl('h3', { text: t('settings.views.templates'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.views.viewTemplateFolder'))
        .setDesc(t('settings.views.viewTemplateFolderDesc'))
        .addText(text => {
            text.setPlaceholder('Templates/Views')
                .setValue(plugin.settings.viewTemplateFolder)
                .onChange(async (value) => {
                    plugin.settings.viewTemplateFolder = value.trim();
                    await plugin.saveSettings();
                });
            new FolderSuggest(plugin.app, text.inputEl);
        });

    new Setting(el)
        .setName(t('settings.views.intervalTemplateFolder'))
        .setDesc(t('settings.views.intervalTemplateFolderDesc'))
        .addText(text => {
            text.setPlaceholder('Templates/Timers')
                .setValue(plugin.settings.intervalTemplateFolder)
                .onChange(async (value) => {
                    plugin.settings.intervalTemplateFolder = value.trim();
                    await plugin.saveSettings();
                });
            new FolderSuggest(plugin.app, text.inputEl);
        });

    // Interaction
    el.createEl('h3', { text: t('settings.views.interaction'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.views.longPressThreshold'))
        .setDesc(t('settings.views.longPressThresholdDesc'))
        .addSlider(slider => slider
            .setLimits(100, 2000, 50)
            .setValue(plugin.settings.longPressThreshold)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.longPressThreshold = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.views.reuseExistingTab'))
        .setDesc(t('settings.views.reuseExistingTabDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.reuseExistingTab)
            .onChange(async (value) => {
                plugin.settings.reuseExistingTab = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.views.enableCardFileLink'))
        .setDesc(t('settings.views.enableCardFileLinkDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableCardFileLink)
            .onChange(async (value) => {
                plugin.settings.enableCardFileLink = value;
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
}
