import { Setting } from 'obsidian';
import TaskViewerPlugin from '../main';
import { TaskFieldMapping } from '../types';
import { t } from '../i18n';

export function render(el: HTMLElement, plugin: TaskViewerPlugin, redisplay: () => void): void {
    el.createEl('h3', { text: t('settings.parsers.heading') });
    el.createEl('p', { text: t('settings.parsers.description'), cls: 'setting-item-description' });

    // Day Planner toggle
    new Setting(el)
        .setName(t('settings.parsers.enableDayPlanner'))
        .setDesc(t('settings.parsers.enableDayPlannerDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableDayPlanner)
            .onChange(async (value) => {
                plugin.settings.enableDayPlanner = value;
                await plugin.saveSettings();
            })
        );

    // Tasks Plugin toggle
    new Setting(el)
        .setName(t('settings.parsers.enableTasksPlugin'))
        .setDesc(t('settings.parsers.enableTasksPluginDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableTasksPlugin)
            .onChange(async (value) => {
                plugin.settings.enableTasksPlugin = value;
                await plugin.saveSettings();
                redisplay(); // Re-render to show/hide mapping section
            })
        );

    // Tasks Plugin mapping (only when enabled)
    if (plugin.settings.enableTasksPlugin) {
        const mappingContainer = el.createDiv('tv-settings__mapping');
        mappingContainer.createEl('h4', { text: t('settings.parsers.mappingHeading') });

        const fieldOptions: { value: TaskFieldMapping; label: string }[] = [
            { value: 'startDate', label: t('settings.parsers.fieldStartDate') },
            { value: 'endDate',   label: t('settings.parsers.fieldEndDate') },
            { value: 'due',       label: t('settings.parsers.fieldDue') },
            { value: 'ignore',    label: t('settings.parsers.fieldIgnore') },
        ];

        // 🛫 Start
        addMappingDropdown(mappingContainer, '🛫 ' + t('settings.parsers.emojiStart'), fieldOptions,
            plugin.settings.tasksPluginMapping.start,
            async (value) => { plugin.settings.tasksPluginMapping.start = value; await plugin.saveSettings(); }
        );

        // ⏳ Scheduled
        addMappingDropdown(mappingContainer, '⏳ ' + t('settings.parsers.emojiScheduled'), fieldOptions,
            plugin.settings.tasksPluginMapping.scheduled,
            async (value) => { plugin.settings.tasksPluginMapping.scheduled = value; await plugin.saveSettings(); }
        );

        // 📅 Due
        addMappingDropdown(mappingContainer, '📅 ' + t('settings.parsers.emojiDue'), fieldOptions,
            plugin.settings.tasksPluginMapping.due,
            async (value) => { plugin.settings.tasksPluginMapping.due = value; await plugin.saveSettings(); }
        );
    }
}

function addMappingDropdown(
    container: HTMLElement,
    name: string,
    options: { value: TaskFieldMapping; label: string }[],
    currentValue: TaskFieldMapping,
    onChange: (value: TaskFieldMapping) => Promise<void>,
): void {
    new Setting(container)
        .setName(name)
        .addDropdown(dropdown => {
            for (const opt of options) {
                dropdown.addOption(opt.value, opt.label);
            }
            dropdown.setValue(currentValue);
            dropdown.onChange(async (value) => {
                await onChange(value as TaskFieldMapping);
            });
        });
}
