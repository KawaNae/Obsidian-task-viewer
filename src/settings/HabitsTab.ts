import { Setting } from 'obsidian';
import TaskViewerPlugin from '../main';
import { HabitType } from '../types';
import { HabitDefinitionWriter } from '../services/template/HabitDefinitionWriter';
import { DailyNoteFrontmatterSuggest } from '../suggest/DailyNoteFrontmatterSuggest';
import { t } from '../i18n';

async function saveHabits(plugin: TaskViewerPlugin): Promise<void> {
    plugin._habitSavePending = true;
    try {
        const writer = new HabitDefinitionWriter(plugin.app);
        await writer.save(plugin.settings.habitDefinitionFile, plugin.settings.habits);
    } finally {
        plugin._habitSavePending = false;
    }
}

export function render(el: HTMLElement, plugin: TaskViewerPlugin): void {
    new Setting(el)
        .setName(t('settings.habits.habitFile'))
        .setDesc(t('settings.habits.habitFileDesc'))
        .addText(text => text
            .setPlaceholder('Templates/Habits/habits.md')
            .setValue(plugin.settings.habitDefinitionFile)
            .onChange(async (value) => {
                plugin.settings.habitDefinitionFile = value.trim();
                await plugin.saveSettings();
            })
        );

    const habitHeader = el.createDiv('setting-item');
    habitHeader.createSpan({ text: t('settings.habits.description'), cls: 'setting-item-description' });

    const habitsListContainer = el.createDiv('habits-list-container');
    renderHabitsList(habitsListContainer, plugin);

    // Allow external refresh (e.g. when habits.md is modified outside settings)
    plugin._habitsTabRefresh = () => renderHabitsList(habitsListContainer, plugin);

    new Setting(el)
        .setName(t('settings.habits.addHabit'))
        .setDesc(t('settings.habits.addHabitDesc'))
        .addButton(btn => btn
            .setButtonText(t('settings.habits.addButton'))
            .onClick(async () => {
                plugin.settings.habits.push({ name: '', type: 'boolean' });
                await saveHabits(plugin);
                renderHabitsList(habitsListContainer, plugin);
            })
        );
}

function renderHabitsList(container: HTMLElement, plugin: TaskViewerPlugin): void {
    container.empty();
    plugin.settings.habits.forEach((habit, i) => {
        const setting = new Setting(container)
            .setName(t('settings.habits.habitN', { n: i + 1 }))
            .addText(text => {
                text.setPlaceholder(t('settings.habits.habitNamePlaceholder'))
                    .setValue(habit.name)
                    .onChange(async (value) => {
                        plugin.settings.habits[i].name = value.trim();
                        await saveHabits(plugin);
                    });
                new DailyNoteFrontmatterSuggest(
                    plugin.app,
                    text.inputEl,
                    plugin.settings.habits,
                    async (suggestion) => {
                        plugin.settings.habits[i].name = suggestion.name;
                        plugin.settings.habits[i].type = suggestion.type;
                        await saveHabits(plugin);
                        renderHabitsList(container, plugin);
                    },
                );
            })
            .addDropdown(dropdown => dropdown
                .addOption('boolean', t('settings.habits.booleanType'))
                .addOption('number', t('settings.habits.numberType'))
                .addOption('string', t('settings.habits.textType'))
                .setValue(habit.type)
                .onChange(async (value) => {
                    plugin.settings.habits[i].type = value as HabitType;
                    await saveHabits(plugin);
                    renderHabitsList(container, plugin);
                })
            );

        if (habit.type === 'number') {
            setting.addText(text => text
                .setPlaceholder(t('settings.habits.unitPlaceholder'))
                .setValue(habit.unit ?? '')
                .onChange(async (value) => {
                    plugin.settings.habits[i].unit = value.trim() || undefined;
                    await saveHabits(plugin);
                })
            );
        }

        setting.addButton(btn => btn
            .setIcon('trash')
            .setTooltip(t('settings.habits.removeHabit'))
            .onClick(async () => {
                plugin.settings.habits.splice(i, 1);
                await saveHabits(plugin);
                renderHabitsList(container, plugin);
            })
        );
    });
}
