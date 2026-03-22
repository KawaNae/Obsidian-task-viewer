import { Setting } from 'obsidian';
import TaskViewerPlugin from '../main';
import { t } from '../i18n';

export function render(el: HTMLElement, plugin: TaskViewerPlugin): void {
    // Daily Notes
    el.createEl('h3', { text: t('settings.notes.dailyNotes'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.notes.dailyNoteHeader'))
        .setDesc(t('settings.notes.dailyNoteHeaderDesc'))
        .addText(text => text
            .setPlaceholder('Tasks')
            .setValue(plugin.settings.dailyNoteHeader)
            .onChange(async (value) => {
                plugin.settings.dailyNoteHeader = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.notes.dailyNoteHeaderLevel'))
        .setDesc(t('settings.notes.dailyNoteHeaderLevelDesc'))
        .addSlider(slider => slider
            .setLimits(1, 6, 1)
            .setValue(plugin.settings.dailyNoteHeaderLevel)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.dailyNoteHeaderLevel = value;
                await plugin.saveSettings();
            }));

    // Child Tasks
    el.createEl('h3', { text: t('settings.notes.childTasks'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.notes.childTaskHeading'))
        .setDesc(t('settings.notes.childTaskHeadingDesc'))
        .addText(text => text
            .setPlaceholder('Tasks')
            .setValue(plugin.settings.frontmatterTaskHeader)
            .onChange(async (value) => {
                plugin.settings.frontmatterTaskHeader = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.notes.childTaskHeadingLevel'))
        .setDesc(t('settings.notes.childTaskHeadingLevelDesc'))
        .addSlider(slider => slider
            .setLimits(1, 6, 1)
            .setValue(plugin.settings.frontmatterTaskHeaderLevel)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.frontmatterTaskHeaderLevel = value;
                await plugin.saveSettings();
            }));

    // Periodic Notes
    el.createEl('h3', { text: t('settings.notes.periodicNotes'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.notes.weeklyNoteFormat'))
        .setDesc(t('settings.notes.weeklyNoteFormatDesc'))
        .addText(text => text
            .setPlaceholder('gggg-[W]ww')
            .setValue(plugin.settings.weeklyNoteFormat)
            .onChange(async (value) => {
                plugin.settings.weeklyNoteFormat = value || 'gggg-[W]ww';
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.notes.weeklyNoteFolder'))
        .setDesc(t('settings.notes.weeklyNoteFolderDesc'))
        .addText(text => text
            .setPlaceholder('')
            .setValue(plugin.settings.weeklyNoteFolder)
            .onChange(async (value) => {
                plugin.settings.weeklyNoteFolder = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.notes.monthlyNoteFormat'))
        .setDesc(t('settings.notes.monthlyNoteFormatDesc'))
        .addText(text => text
            .setPlaceholder('YYYY-MM')
            .setValue(plugin.settings.monthlyNoteFormat)
            .onChange(async (value) => {
                plugin.settings.monthlyNoteFormat = value || 'YYYY-MM';
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.notes.monthlyNoteFolder'))
        .setDesc(t('settings.notes.monthlyNoteFolderDesc'))
        .addText(text => text
            .setPlaceholder('')
            .setValue(plugin.settings.monthlyNoteFolder)
            .onChange(async (value) => {
                plugin.settings.monthlyNoteFolder = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.notes.yearlyNoteFormat'))
        .setDesc(t('settings.notes.yearlyNoteFormatDesc'))
        .addText(text => text
            .setPlaceholder('YYYY')
            .setValue(plugin.settings.yearlyNoteFormat)
            .onChange(async (value) => {
                plugin.settings.yearlyNoteFormat = value || 'YYYY';
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.notes.yearlyNoteFolder'))
        .setDesc(t('settings.notes.yearlyNoteFolderDesc'))
        .addText(text => text
            .setPlaceholder('')
            .setValue(plugin.settings.yearlyNoteFolder)
            .onChange(async (value) => {
                plugin.settings.yearlyNoteFolder = value;
                await plugin.saveSettings();
            }));
}
