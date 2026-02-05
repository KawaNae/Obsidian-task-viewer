import { App, PluginSettingTab, Setting } from 'obsidian';
import TaskViewerPlugin from './main';
import { HabitType } from './types';

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
        const buildInfoEl = containerEl.createDiv('setting-item');
        buildInfoEl.createSpan({
            text: `Built: ${typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'unknown'}`,
            cls: 'setting-item-description'
        });

        containerEl.createEl('h3', { text: 'General', cls: 'setting-section-header' });

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
        
        const excludedPathsSetting = new Setting(containerEl)
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
        const textarea = excludedPathsSetting.settingEl.querySelector('textarea');
        if (textarea) {
            textarea.rows = 10;
            textarea.style.width = '100%';
            textarea.style.minWidth = '300px';
        }

        containerEl.createEl('h3', { text: 'Timeline', cls: 'setting-section-header' });

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
            .setName('Past Days to Show')
            .setDesc('Number of past days to always display in the timeline, even when there are no incomplete tasks on those days.')
            .addText(text => {
                text.inputEl.type = 'number';
                text.inputEl.min = '0';
                text
                    .setPlaceholder('0')
                    .setValue(this.plugin.settings.pastDaysToShow.toString())
                    .onChange(async (value) => {
                        let days = parseInt(value);
                        if (isNaN(days) || days < 0) days = 0;
                        this.plugin.settings.pastDaysToShow = days;
                        await this.plugin.saveSettings();
                    });
            });

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

        containerEl.createEl('h3', { text: 'DeadlineList', cls: 'setting-section-header' });

        new Setting(containerEl)
            .setName('Default Deadline Offset')
            .setDesc('Number of days from today to set as the default deadline for new deadline tasks.')
            .addText(text => text
                .setPlaceholder('0')
                .setValue(this.plugin.settings.defaultDeadlineOffset.toString())
                .onChange(async (value) => {
                    let days = parseInt(value);
                    if (isNaN(days)) days = 0;
                    this.plugin.settings.defaultDeadlineOffset = days;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Upcoming Days')
            .setDesc('Number of days (from tomorrow) to show as "Upcoming" in the Deadline list. Set to 0 to hide the Upcoming group.')
            .addText(text => text
                .setPlaceholder('7')
                .setValue(this.plugin.settings.upcomingDays.toString())
                .onChange(async (value) => {
                    let days = parseInt(value);
                    if (isNaN(days) || days < 0) days = 0;
                    this.plugin.settings.upcomingDays = days;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Daily Notes', cls: 'setting-section-header' });

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

        containerEl.createEl('h3', { text: 'Timer Widget', cls: 'setting-section-header' });

        new Setting(containerEl)
            .setName('Custom Pomodoro Work Minutes')
            .setDesc('Custom Work duration in minutes for the Pomodoro timer.')
            .addText(text => {
                text.inputEl.type = 'number';
                text.inputEl.min = '1';
                text
                    .setPlaceholder('25')
                    .setValue(this.plugin.settings.pomodoroWorkMinutes.toString())
                    .onChange(async (value) => {
                        let mins = parseInt(value);
                        if (isNaN(mins) || mins < 1) mins = 1;
                        this.plugin.settings.pomodoroWorkMinutes = mins;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Custom Pomodoro Break Minutes')
            .setDesc('Custom Break duration in minutes for the Pomodoro timer.')
            .addText(text => {
                text.inputEl.type = 'number';
                text.inputEl.min = '1';
                text
                    .setPlaceholder('5')
                    .setValue(this.plugin.settings.pomodoroBreakMinutes.toString())
                    .onChange(async (value) => {
                        let mins = parseInt(value);
                        if (isNaN(mins) || mins < 1) mins = 1;
                        this.plugin.settings.pomodoroBreakMinutes = mins;
                        await this.plugin.saveSettings();
                    });
            });

        containerEl.createEl('h3', { text: 'Habit Tracker', cls: 'setting-section-header' });

        // --- Habit Tracker Section ---
        const habitHeader = containerEl.createDiv('setting-item');
        habitHeader.createSpan({ text: 'Define habits to track in your daily notes\' frontmatter.', cls: 'setting-item-description' });

        const habitsListContainer = containerEl.createDiv('habits-list-container');
        this.renderHabitsList(habitsListContainer);

        new Setting(containerEl)
            .setName('Add Habit')
            .setDesc('Create a new habit to track.')
            .addButton(btn => btn
                .setButtonText('+ Add')
                .onClick(async () => {
                    this.plugin.settings.habits.push({ name: '', type: 'boolean' });
                    await this.plugin.saveSettings();
                    this.renderHabitsList(habitsListContainer);
                })
            );
    }

    private renderHabitsList(container: HTMLElement): void {
        container.empty();
        this.plugin.settings.habits.forEach((habit, i) => {
            const setting = new Setting(container)
                .setName(`Habit ${i + 1}`)
                .addText(text => text
                    .setPlaceholder('Habit name')
                    .setValue(habit.name)
                    .onChange(async (value) => {
                        this.plugin.settings.habits[i].name = value.trim();
                        await this.plugin.saveSettings();
                    })
                )
                .addDropdown(dropdown => dropdown
                    .addOption('boolean', 'Boolean (on/off)')
                    .addOption('number', 'Number')
                    .addOption('string', 'Text')
                    .setValue(habit.type)
                    .onChange(async (value) => {
                        this.plugin.settings.habits[i].type = value as HabitType;
                        await this.plugin.saveSettings();
                        this.renderHabitsList(container);
                    })
                );

            if (habit.type === 'number') {
                setting.addText(text => text
                    .setPlaceholder('Unit (e.g. kg)')
                    .setValue(habit.unit ?? '')
                    .onChange(async (value) => {
                        this.plugin.settings.habits[i].unit = value.trim() || undefined;
                        await this.plugin.saveSettings();
                    })
                );
            }

            setting.addButton(btn => btn
                .setIcon('trash')
                .setTooltip('Remove habit')
                .onClick(async () => {
                    this.plugin.settings.habits.splice(i, 1);
                    await this.plugin.saveSettings();
                    this.renderHabitsList(container);
                })
            );
        });
    }
}
