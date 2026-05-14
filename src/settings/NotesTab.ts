import { Setting } from 'obsidian';
import TaskViewerPlugin from '../main';
import { t } from '../i18n';
import { FileSuggest } from '../suggest/FileSuggest';

export function render(el: HTMLElement, plugin: TaskViewerPlugin): void {
    // Daily Notes
    el.createEl('h3', { text: t('settings.notes.dailyNotes'), cls: 'setting-section-header' });

    el.createEl('div', {
        text: t('settings.notes.dailyNotesCoreInfo'),
        cls: 'setting-item-description',
    });

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
            .setValue(plugin.settings.tvFileChildHeader)
            .onChange(async (value) => {
                plugin.settings.tvFileChildHeader = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.notes.childTaskHeadingLevel'))
        .setDesc(t('settings.notes.childTaskHeadingLevelDesc'))
        .addSlider(slider => slider
            .setLimits(1, 6, 1)
            .setValue(plugin.settings.tvFileChildHeaderLevel)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.tvFileChildHeaderLevel = value;
                await plugin.saveSettings();
            }));

    // Periodic Notes
    el.createEl('h3', { text: t('settings.notes.periodicNotes'), cls: 'setting-section-header' });

    el.createEl('div', {
        text: t('settings.notes.weekStartDayHint'),
        cls: 'setting-item-description',
    });

    // Weekly
    el.createEl('h4', { text: t('settings.notes.weeklySubsection') });

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
        .setName(t('settings.notes.weeklyNoteTemplate'))
        .setDesc(t('settings.notes.weeklyNoteTemplateDesc'))
        .addText(text => {
            text
                .setPlaceholder('Templates/Weekly.md')
                .setValue(plugin.settings.weeklyNoteTemplate)
                .onChange(async (value) => {
                    plugin.settings.weeklyNoteTemplate = value;
                    await plugin.saveSettings();
                });
            new FileSuggest(plugin.app, text.inputEl);
        });

    // Monthly
    el.createEl('h4', { text: t('settings.notes.monthlySubsection') });

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
        .setName(t('settings.notes.monthlyNoteTemplate'))
        .setDesc(t('settings.notes.monthlyNoteTemplateDesc'))
        .addText(text => {
            text
                .setPlaceholder('Templates/Monthly.md')
                .setValue(plugin.settings.monthlyNoteTemplate)
                .onChange(async (value) => {
                    plugin.settings.monthlyNoteTemplate = value;
                    await plugin.saveSettings();
                });
            new FileSuggest(plugin.app, text.inputEl);
        });

    // Yearly
    el.createEl('h4', { text: t('settings.notes.yearlySubsection') });

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

    new Setting(el)
        .setName(t('settings.notes.yearlyNoteTemplate'))
        .setDesc(t('settings.notes.yearlyNoteTemplateDesc'))
        .addText(text => {
            text
                .setPlaceholder('Templates/Yearly.md')
                .setValue(plugin.settings.yearlyNoteTemplate)
                .onChange(async (value) => {
                    plugin.settings.yearlyNoteTemplate = value;
                    await plugin.saveSettings();
                });
            new FileSuggest(plugin.app, text.inputEl);
        });
}
