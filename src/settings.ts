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

        containerEl.createEl('h3', { text: 'File Colors' });
        containerEl.createEl('p', { text: 'Assign colors to specific files to distinguish their tasks in the timeline.' });

        // List existing mappings
        for (const [path, color] of Object.entries(this.plugin.settings.fileColors)) {
            new Setting(containerEl)
                .setName(path)
                .setDesc('Color: ' + color)
                .addColorPicker(colorPicker => colorPicker
                    .setValue(color)
                    .onChange(async (value) => {
                        this.plugin.settings.fileColors[path] = value;
                        await this.plugin.saveSettings();
                    }))
                .addButton(button => button
                    .setButtonText('Remove')
                    .onClick(async () => {
                        delete this.plugin.settings.fileColors[path];
                        await this.plugin.saveSettings();
                        this.display(); // Refresh to remove the item
                    }));
        }

        // Add new mapping
        let newPath = '';
        let newColor = '#ff0000';

        new Setting(containerEl)
            .setName('Add File Color')
            .setDesc('Enter the file path (relative to vault root) and pick a color.')
            .addText(text => text
                .setPlaceholder('Folder/File.md')
                .onChange(value => {
                    newPath = value;
                }))
            .addColorPicker(colorPicker => colorPicker
                .setValue(newColor)
                .onChange(value => {
                    newColor = value;
                }))
            .addButton(button => button
                .setButtonText('Add')
                .setCta()
                .onClick(async () => {
                    if (newPath) {
                        this.plugin.settings.fileColors[newPath] = newColor;
                        await this.plugin.saveSettings();
                        this.display(); // Refresh to show the new item
                    }
                }));
    }
}
