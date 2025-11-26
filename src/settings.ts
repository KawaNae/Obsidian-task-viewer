import { App, PluginSettingTab, Setting } from 'obsidian';
import TaskViewerPlugin from './main';

export class TaskViewerSettingTab extends PluginSettingTab {
    plugin: TaskViewerPlugin;

    constructor(app: App, plugin: TaskViewerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Start Hour')
            .setDesc('The hour when your day starts (0-23). Tasks before this hour will be shown in the previous day.')
            .addText(text => text
                .setPlaceholder('5')
                .setValue(this.plugin.settings.startHour.toString())
                .onChange(async (value) => {
                    let hour = parseInt(value);
                    if (isNaN(hour)) hour = 0;
                    if (hour < 0) hour = 0;
                    if (hour > 23) hour = 23;

                    this.plugin.settings.startHour = hour;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Apply Global Checkbox Styles')
            .setDesc('If enabled, the plugin will apply its checkbox styles to the entire Obsidian editor, replacing the need for a separate CSS snippet.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.applyGlobalStyles)
                .onChange(async (value) => {
                    this.plugin.settings.applyGlobalStyles = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateGlobalStyles();
                }));

        new Setting(containerEl)
            .setName('Frontmatter Color Key')
            .setDesc('The key to look for in the file\'s frontmatter to determine the task color (e.g. "color" or "timeline-color").')
            .addText(text => text
                .setPlaceholder('color')
                .setValue(this.plugin.settings.frontmatterColorKey)
                .onChange(async (value) => {
                    this.plugin.settings.frontmatterColorKey = value;
                    await this.plugin.saveSettings();
                }));
    }
}
