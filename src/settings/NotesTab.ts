import { Setting } from 'obsidian';
import type { PluginContext } from '../PluginContext';
import { t } from '../i18n';
import { FileSuggest } from '../suggest/FileSuggest';
import type { SectionSide } from '../services/persistence/utils/Placement';

export function render(el: HTMLElement, plugin: PluginContext): void {
    // Tasks in notes: where a new line goes in a note, whichever note it is
    el.createEl('h3', { text: t('settings.notes.tasksInNotes'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.notes.taskHeading'))
        .setDesc(t('settings.notes.taskHeadingDesc'))
        .addText(text => text
            .setPlaceholder('Tasks')
            .setValue(plugin.settings.taskHeading)
            .onChange(async (value) => {
                plugin.settings.taskHeading = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.notes.taskHeadingLevel'))
        .setDesc(t('settings.notes.taskHeadingLevelDesc'))
        .addSlider(slider => slider
            .setLimits(1, 6, 1)
            .setValue(plugin.settings.taskHeadingLevel)
            .setDynamicTooltip()
            .onChange(async (value) => {
                plugin.settings.taskHeadingLevel = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.notes.sectionSide'))
        .setDesc(t('settings.notes.sectionSideDesc'))
        .addDropdown(dropdown => dropdown
            .addOption('head', t('settings.notes.sectionSideHead'))
            .addOption('end', t('settings.notes.sectionSideEnd'))
            .setValue(plugin.settings.sectionSide)
            .onChange(async (value) => {
                plugin.settings.sectionSide = value as SectionSide;
                await plugin.saveSettings();
            }));

    // Daily Notes
    el.createEl('h3', { text: t('settings.notes.dailyNotes'), cls: 'setting-section-header' });

    el.createEl('div', {
        text: t('settings.notes.dailyNotesCoreInfo'),
        cls: 'setting-item-description',
    });

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
