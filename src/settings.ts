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

        // Version display at top
        const versionEl = containerEl.createDiv('setting-item');
        versionEl.createSpan({
            text: `Task Viewer v${this.plugin.manifest.version}`,
            cls: 'setting-item-description'
        });

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
            .setName('Apply Custom Checkboxes Styles')
            .setDesc('If enabled, the plugin will apply its checkbox styles to the entire Obsidian editor, replacing the need for a separate CSS snippet.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.applyGlobalStyles)
                .onChange(async (value) => {
                    this.plugin.settings.applyGlobalStyles = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateGlobalStyles();
                }));

        new Setting(containerEl)
            .setName('Complete Status Characters')
            .setDesc('Characters that represent completed tasks (comma or space separated, e.g., "x, X, -, !").')
            .addText(text => text
                .setPlaceholder('x, X, -, !')
                .setValue(this.plugin.settings.completeStatusChars.join(', '))
                .onChange(async (value) => {
                    // Parse input: split by comma or space, trim, filter empty
                    const chars = value.split(/[,\s]+/)
                        .map(c => c.trim())
                        .filter(c => c.length > 0);

                    this.plugin.settings.completeStatusChars = chars.length > 0 ? chars : ['x', 'X', '-', '!'];
                    await this.plugin.saveSettings();
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

        new Setting(containerEl)
            .setName('Default Zoom Level')
            .setDesc('The default zoom level for the timeline view (0.25 - 4.0).')
            .addSlider(slider => slider
                .setLimits(0.25, 4.0, 0.25)
                .setValue(this.plugin.settings.zoomLevel)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.zoomLevel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Daily Note Header')
            .setDesc('The header under which new tasks will be added in the Daily Note.')
            .addText(text => text
                .setPlaceholder('Tasks')
                .setValue(this.plugin.settings.dailyNoteHeader)
                .onChange(async (value) => {
                    this.plugin.settings.dailyNoteHeader = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Daily Note Header Level')
            .setDesc('The level of the header (1-6).')
            .addSlider(slider => slider
                .setLimits(1, 6, 1)
                .setValue(this.plugin.settings.dailyNoteHeaderLevel)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.dailyNoteHeaderLevel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Excluded Paths')
            .setDesc('Paths to exclude from task scanning (one per line). Files starting with these paths will be ignored.')
            .addTextArea(text => text
                .setPlaceholder('Templates/\nArchive/\nSecret.md')
                .setValue(this.plugin.settings.excludedPaths.join('\n'))
                .onChange(async (value) => {
                    const paths = value.split('\n')
                        .map(p => p.trim())
                        .filter(p => p.length > 0);
                    this.plugin.settings.excludedPaths = paths;
                    await this.plugin.saveSettings();
                }));

        // Enhance the textarea for better visibility
        const excludedPathsSetting = containerEl.lastElementChild as HTMLElement;
        const textarea = excludedPathsSetting?.querySelector('textarea');
        if (textarea) {
            textarea.rows = 10;
            textarea.style.width = '100%';
            textarea.style.minWidth = '300px';
        }
    }
}
