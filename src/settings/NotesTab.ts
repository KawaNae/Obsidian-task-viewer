import { Setting } from 'obsidian';
import type { PluginContext } from '../PluginContext';
import { t } from '../i18n';
import { FileSuggest } from '../suggest/FileSuggest';
import type { SectionSide } from '../services/persistence/utils/Placement';
import { SETTINGS_SCHEMA } from './SettingsSchema';
import type { SettingFields } from './SettingFields';

type PeriodicKey =
    | 'weeklyNoteFormat' | 'weeklyNoteFolder' | 'weeklyNoteTemplate'
    | 'monthlyNoteFormat' | 'monthlyNoteFolder' | 'monthlyNoteTemplate'
    | 'yearlyNoteFormat' | 'yearlyNoteFolder' | 'yearlyNoteTemplate';

export function render(el: HTMLElement, plugin: PluginContext, fields: SettingFields): void {
    /**
     * A periodic note's text setting. A format left empty is its default
     * format; a folder's and a template's path are taken without the space
     * around them (the settings' table). The template's field lists the notes.
     */
    const periodic = (setting: Setting, key: PeriodicKey, shown: { placeholder: string; notes?: boolean }) => fields.text(setting, {
        codec: SETTINGS_SCHEMA[key].codec,
        get: () => plugin.settings[key],
        put: (value) => { plugin.settings[key] = value; },
        placeholder: shown.placeholder,
        list: shown.notes ? (input, picked) => new FileSuggest(plugin.app, input, (f) => picked(f.path)) : undefined,
    });

    // Tasks in notes: where a new line goes in a note, whichever note it is
    el.createEl('h3', { text: t('settings.notes.tasksInNotes'), cls: 'setting-section-header' });

    // The heading's name alone: no `#` before it (HeadingInput).
    fields.text(new Setting(el)
        .setName(t('settings.notes.taskHeading'))
        .setDesc(t('settings.notes.taskHeadingDesc')), {
        codec: SETTINGS_SCHEMA.taskHeading.codec,
        get: () => plugin.settings.taskHeading,
        put: (heading) => { plugin.settings.taskHeading = heading; },
        placeholder: 'Tasks',
    });

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

    periodic(new Setting(el)
        .setName(t('settings.notes.weeklyNoteFormat'))
        .setDesc(t('settings.notes.weeklyNoteFormatDesc')), 'weeklyNoteFormat', { placeholder: 'gggg-[W]ww' });

    periodic(new Setting(el)
        .setName(t('settings.notes.weeklyNoteFolder'))
        .setDesc(t('settings.notes.weeklyNoteFolderDesc')), 'weeklyNoteFolder', { placeholder: '' });

    periodic(new Setting(el)
        .setName(t('settings.notes.weeklyNoteTemplate'))
        .setDesc(t('settings.notes.weeklyNoteTemplateDesc')), 'weeklyNoteTemplate', { placeholder: 'Templates/Weekly.md', notes: true });

    // Monthly
    el.createEl('h4', { text: t('settings.notes.monthlySubsection') });

    periodic(new Setting(el)
        .setName(t('settings.notes.monthlyNoteFormat'))
        .setDesc(t('settings.notes.monthlyNoteFormatDesc')), 'monthlyNoteFormat', { placeholder: 'YYYY-MM' });

    periodic(new Setting(el)
        .setName(t('settings.notes.monthlyNoteFolder'))
        .setDesc(t('settings.notes.monthlyNoteFolderDesc')), 'monthlyNoteFolder', { placeholder: '' });

    periodic(new Setting(el)
        .setName(t('settings.notes.monthlyNoteTemplate'))
        .setDesc(t('settings.notes.monthlyNoteTemplateDesc')), 'monthlyNoteTemplate', { placeholder: 'Templates/Monthly.md', notes: true });

    // Yearly
    el.createEl('h4', { text: t('settings.notes.yearlySubsection') });

    periodic(new Setting(el)
        .setName(t('settings.notes.yearlyNoteFormat'))
        .setDesc(t('settings.notes.yearlyNoteFormatDesc')), 'yearlyNoteFormat', { placeholder: 'YYYY' });

    periodic(new Setting(el)
        .setName(t('settings.notes.yearlyNoteFolder'))
        .setDesc(t('settings.notes.yearlyNoteFolderDesc')), 'yearlyNoteFolder', { placeholder: '' });

    periodic(new Setting(el)
        .setName(t('settings.notes.yearlyNoteTemplate'))
        .setDesc(t('settings.notes.yearlyNoteTemplateDesc')), 'yearlyNoteTemplate', { placeholder: 'Templates/Yearly.md', notes: true });
}
