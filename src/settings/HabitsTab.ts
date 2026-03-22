import { Setting } from 'obsidian';
import TaskViewerPlugin from '../main';
import { HabitType } from '../types';
import { t } from '../i18n';

export function render(el: HTMLElement, plugin: TaskViewerPlugin): void {
    const habitHeader = el.createDiv('setting-item');
    habitHeader.createSpan({ text: t('settings.habits.description'), cls: 'setting-item-description' });

    const habitsListContainer = el.createDiv('habits-list-container');
    renderHabitsList(habitsListContainer, plugin);

    new Setting(el)
        .setName(t('settings.habits.addHabit'))
        .setDesc(t('settings.habits.addHabitDesc'))
        .addButton(btn => btn
            .setButtonText(t('settings.habits.addButton'))
            .onClick(async () => {
                plugin.settings.habits.push({ name: '', type: 'boolean' });
                await plugin.saveSettings();
                renderHabitsList(habitsListContainer, plugin);
            })
        );
}

function renderHabitsList(container: HTMLElement, plugin: TaskViewerPlugin): void {
    container.empty();
    plugin.settings.habits.forEach((habit, i) => {
        const setting = new Setting(container)
            .setName(t('settings.habits.habitN', { n: i + 1 }))
            .addText(text => text
                .setPlaceholder(t('settings.habits.habitNamePlaceholder'))
                .setValue(habit.name)
                .onChange(async (value) => {
                    plugin.settings.habits[i].name = value.trim();
                    await plugin.saveSettings();
                })
            )
            .addDropdown(dropdown => dropdown
                .addOption('boolean', t('settings.habits.booleanType'))
                .addOption('number', t('settings.habits.numberType'))
                .addOption('string', t('settings.habits.textType'))
                .setValue(habit.type)
                .onChange(async (value) => {
                    plugin.settings.habits[i].type = value as HabitType;
                    await plugin.saveSettings();
                    renderHabitsList(container, plugin);
                })
            );

        if (habit.type === 'number') {
            setting.addText(text => text
                .setPlaceholder(t('settings.habits.unitPlaceholder'))
                .setValue(habit.unit ?? '')
                .onChange(async (value) => {
                    plugin.settings.habits[i].unit = value.trim() || undefined;
                    await plugin.saveSettings();
                })
            );
        }

        setting.addButton(btn => btn
            .setIcon('trash')
            .setTooltip(t('settings.habits.removeHabit'))
            .onClick(async () => {
                plugin.settings.habits.splice(i, 1);
                await plugin.saveSettings();
                renderHabitsList(container, plugin);
            })
        );
    });
}
