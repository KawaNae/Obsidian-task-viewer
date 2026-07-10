import { Setting } from 'obsidian';
import TaskViewerPlugin from '../main';
import { DoubleTapAction } from '../types';
import { t } from '../i18n';

export function render(el: HTMLElement, plugin: TaskViewerPlugin): void {
    // Menu
    el.createEl('h3', { text: t('settings.general.menu'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.general.showEditorMenuForTasks'))
        .setDesc(t('settings.general.showEditorMenuForTasksDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.editorMenuForTasks)
            .onChange(async (value) => {
                plugin.settings.editorMenuForTasks = value;
                await plugin.saveSettings();
                plugin.notifyEditorMenuSettingsChanged();
            }));

    new Setting(el)
        .setName(t('settings.general.showEditorMenuForCheckboxes'))
        .setDesc(t('settings.general.showEditorMenuForCheckboxesDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.editorMenuForCheckboxes)
            .onChange(async (value) => {
                plugin.settings.editorMenuForCheckboxes = value;
                await plugin.saveSettings();
                plugin.notifyEditorMenuSettingsChanged();
            }));

    new Setting(el)
        .setName(t('settings.general.showFileMenuForFrontmatterTasks'))
        .setDesc(t('settings.general.showFileMenuForFrontmatterTasksDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.fileMenuForTvFile)
            .onChange(async (value) => {
                plugin.settings.fileMenuForTvFile = value;
                await plugin.saveSettings();
            }));

    new Setting(el)
        .setName(t('settings.general.enableStatusMenu'))
        .setDesc(t('settings.general.enableStatusMenuDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableStatusMenu)
            .onChange(async (value) => {
                plugin.settings.enableStatusMenu = value;
                await plugin.saveSettings();
            }));

    // Interaction
    el.createEl('h3', { text: t('settings.general.interaction'), cls: 'setting-section-header' });

    new Setting(el)
        .setName(t('settings.general.doubleTapAction'))
        .setDesc(t('settings.general.doubleTapActionDesc'))
        .addDropdown(dropdown => dropdown
            .addOption('detail', t('settings.general.doubleTapActionDetail'))
            .addOption('open', t('settings.general.doubleTapActionOpen'))
            .addOption('menu', t('settings.general.doubleTapActionMenu'))
            .setValue(plugin.settings.doubleTapAction)
            .onChange(async (value) => {
                plugin.settings.doubleTapAction = value as DoubleTapAction;
                await plugin.saveSettings();
            }));

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
        .setName(t('settings.views.enableCardFileLink'))
        .setDesc(t('settings.views.enableCardFileLinkDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableCardFileLink)
            .onChange(async (value) => {
                plugin.settings.enableCardFileLink = value;
                await plugin.saveSettings();
            }));
}
