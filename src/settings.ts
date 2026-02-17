import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import TaskViewerPlugin from './main';
import { FrontmatterTaskKeys, HabitType, validateFrontmatterTaskKeys } from './types';
import {
    DEFAULT_AI_INDEX_SETTINGS,
    normalizeAiIndexSettings,
    resolveAiIndexOutputPath,
} from './services/aiindex/AiIndexSettings';

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

        containerEl.createEl('h3', { text: 'AI Index', cls: 'setting-section-header' });

        let fileNameSetting: Setting | null = null;
        let outputToPluginFolderSetting: Setting | null = null;
        let customFolderSetting: Setting | null = null;
        let resolvedPathSetting: Setting | null = null;
        let debounceSetting: Setting | null = null;
        let parsersSetting: Setting | null = null;
        let includeDoneSetting: Setting | null = null;
        let includeRawSetting: Setting | null = null;
        let keepDoneDaysSetting: Setting | null = null;
        let createBackupSetting: Setting | null = null;
        let customFolderInputEl: HTMLInputElement | null = null;

        const syncAiIndexUiState = () => {
            const effectivePath = resolveAiIndexOutputPath(this.plugin.settings.aiIndex);
            const isAiEnabled = this.plugin.settings.aiIndex.enabled;
            const isPluginFolderMode = this.plugin.settings.aiIndex.outputToPluginFolder;

            fileNameSetting?.setDisabled(!isAiEnabled);
            outputToPluginFolderSetting?.setDisabled(!isAiEnabled);
            customFolderSetting?.setDisabled(!isAiEnabled);
            resolvedPathSetting?.setDisabled(!isAiEnabled);
            debounceSetting?.setDisabled(!isAiEnabled);
            parsersSetting?.setDisabled(!isAiEnabled);
            includeDoneSetting?.setDisabled(!isAiEnabled);
            includeRawSetting?.setDisabled(!isAiEnabled);
            keepDoneDaysSetting?.setDisabled(!isAiEnabled);
            createBackupSetting?.setDisabled(!isAiEnabled);

            if (customFolderInputEl) {
                customFolderInputEl.disabled = !isAiEnabled || isPluginFolderMode;
            }

            if (customFolderSetting) {
                customFolderSetting.setDesc(!isAiEnabled
                    ? `AI index is disabled. Effective output: ${effectivePath}`
                    : isPluginFolderMode
                        ? `Disabled while plugin-folder output is enabled. Effective output: ${effectivePath}`
                        : `Vault-relative output folder for AI index (folder only). Effective output: ${effectivePath}`);
            }

            if (resolvedPathSetting) {
                resolvedPathSetting.setDesc(effectivePath);
            }
        };

        new Setting(containerEl)
            .setName('Enable AI Index')
            .setDesc('Generate and keep a task index file for AI/search tooling.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.aiIndex.enabled)
                .onChange(async (value) => {
                    this.plugin.settings.aiIndex.enabled = value;
                    await this.plugin.saveSettings();
                    syncAiIndexUiState();
                }));

        fileNameSetting = new Setting(containerEl)
            .setName('AI Index File Name')
            .setDesc('Output file name for AI index. ".ndjson" is auto-appended if missing.')
            .addText(text => {
                let draftFileName = this.plugin.settings.aiIndex.fileName;
                let isSaving = false;

                const commitFileName = async (): Promise<void> => {
                    if (isSaving) return;
                    const normalized = normalizeAiIndexSettings({
                        ...this.plugin.settings.aiIndex,
                        fileName: draftFileName,
                    });

                    text.setValue(normalized.fileName);

                    if (normalized.fileName === this.plugin.settings.aiIndex.fileName) {
                        syncAiIndexUiState();
                        return;
                    }

                    isSaving = true;
                    try {
                        this.plugin.settings.aiIndex = normalized;
                        await this.plugin.saveSettings();
                    } finally {
                        isSaving = false;
                        syncAiIndexUiState();
                    }
                };

                text
                    .setPlaceholder(DEFAULT_AI_INDEX_SETTINGS.fileName)
                    .setValue(this.plugin.settings.aiIndex.fileName)
                    .onChange((value) => {
                        draftFileName = value;
                    });

                text.inputEl.addEventListener('blur', () => {
                    void commitFileName();
                });

                text.inputEl.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        text.inputEl.blur();
                    }
                });
            });

        outputToPluginFolderSetting = new Setting(containerEl)
            .setName('Output AI Index to Plugin Folder')
            .setDesc('If enabled, AI index is written under plugin folder.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.aiIndex.outputToPluginFolder)
                .onChange(async (value) => {
                    const normalized = normalizeAiIndexSettings({
                        ...this.plugin.settings.aiIndex,
                        outputToPluginFolder: value,
                    });
                    this.plugin.settings.aiIndex = normalized;
                    await this.plugin.saveSettings();
                    syncAiIndexUiState();
                }));

        customFolderSetting = new Setting(containerEl)
            .setName('Custom AI Index Output Path')
            .addText(text => {
                let draftFolder = this.plugin.settings.aiIndex.customOutputFolder;
                let isSaving = false;

                const commitFolder = async (): Promise<void> => {
                    if (isSaving) return;
                    const normalized = normalizeAiIndexSettings({
                        ...this.plugin.settings.aiIndex,
                        customOutputFolder: draftFolder,
                    });

                    text.setValue(normalized.customOutputFolder);

                    if (normalized.customOutputFolder === this.plugin.settings.aiIndex.customOutputFolder) {
                        syncAiIndexUiState();
                        return;
                    }

                    isSaving = true;
                    try {
                        this.plugin.settings.aiIndex = normalized;
                        await this.plugin.saveSettings();
                    } finally {
                        isSaving = false;
                        syncAiIndexUiState();
                    }
                };

                text
                    .setPlaceholder(DEFAULT_AI_INDEX_SETTINGS.customOutputFolder)
                    .setValue(this.plugin.settings.aiIndex.customOutputFolder)
                    .onChange((value) => {
                        draftFolder = value;
                    });

                customFolderInputEl = text.inputEl;
                text.inputEl.disabled = this.plugin.settings.aiIndex.outputToPluginFolder;

                text.inputEl.addEventListener('blur', () => {
                    void commitFolder();
                });

                text.inputEl.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        text.inputEl.blur();
                    }
                });
            });

        resolvedPathSetting = new Setting(containerEl)
            .setName('Resolved AI Index Output Path')
            .setDesc(resolveAiIndexOutputPath(this.plugin.settings.aiIndex));

        debounceSetting = new Setting(containerEl)
            .setName('AI Index Debounce (ms)')
            .setDesc('Debounce duration for path-level incremental index updates.')
            .addSlider(slider => slider
                .setLimits(100, 5000, 100)
                .setValue(this.plugin.settings.aiIndex.debounceMs)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    const normalized = normalizeAiIndexSettings({
                        ...this.plugin.settings.aiIndex,
                        debounceMs: value
                    });
                    this.plugin.settings.aiIndex.debounceMs = normalized.debounceMs;
                    await this.plugin.saveSettings();
                }));

        parsersSetting = new Setting(containerEl)
            .setName('AI Index Parsers')
            .setDesc('Comma-separated parsers to include. Supported: inline, frontmatter.')
            .addText(text => text
                .setPlaceholder('inline, frontmatter')
                .setValue(this.plugin.settings.aiIndex.includeParsers.join(', '))
                .onChange(async (value) => {
                    const normalized = normalizeAiIndexSettings({
                        ...this.plugin.settings.aiIndex,
                        includeParsers: value.split(',').map((item) => item.trim())
                    });
                    this.plugin.settings.aiIndex.includeParsers = normalized.includeParsers;
                    await this.plugin.saveSettings();
                }));

        includeDoneSetting = new Setting(containerEl)
            .setName('Include Completed Tasks In AI Index')
            .setDesc('Include done/cancelled/exception tasks in generated AI index.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.aiIndex.includeDone)
                .onChange(async (value) => {
                    this.plugin.settings.aiIndex.includeDone = value;
                    await this.plugin.saveSettings();
                }));

        keepDoneDaysSetting = new Setting(containerEl)
            .setName('Completed Task Retention (Days)')
            .setDesc('Keep completed tasks for this many days (0 = unlimited). Tasks without dates are always kept.')
            .addText(text => text
                .setPlaceholder('0')
                .setValue(String(this.plugin.settings.aiIndex.keepDoneDays))
                .onChange(async (value) => {
                    const parsed = parseInt(value, 10);
                    const clamped = Number.isFinite(parsed) ? Math.max(0, Math.min(3650, parsed)) : 0;
                    this.plugin.settings.aiIndex.keepDoneDays = clamped;
                    await this.plugin.saveSettings();
                }));

        includeRawSetting = new Setting(containerEl)
            .setName('Include Raw Field In AI Index')
            .setDesc('Include the full original text (raw) for each task. Disabled saves ~30-40% file size.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.aiIndex.includeRaw)
                .onChange(async (value) => {
                    this.plugin.settings.aiIndex.includeRaw = value;
                    await this.plugin.saveSettings();
                }));

        createBackupSetting = new Setting(containerEl)
            .setName('Create Backup on AI Index Write')
            .setDesc('Create a .bak file before overwriting the AI index. Disabled reduces I/O.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.aiIndex.createBackup)
                .onChange(async (value) => {
                    this.plugin.settings.aiIndex.createBackup = value;
                    await this.plugin.saveSettings();
                }));

        syncAiIndexUiState();

        containerEl.createEl('h3', { text: 'Interaction', cls: 'setting-section-header' });

        new Setting(containerEl)
            .setName('Long Press Threshold')
            .setDesc('Duration in milliseconds to trigger context menu on touch/stylus long press (100-2000). Lower values make it faster.')
            .addSlider(slider => slider
                .setLimits(100, 2000, 50)
                .setValue(this.plugin.settings.longPressThreshold)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.longPressThreshold = value;
                    await this.plugin.saveSettings();
                }));

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

        containerEl.createEl('h3', { text: 'Calendar', cls: 'setting-section-header' });

        new Setting(containerEl)
            .setName('Week starts on')
            .setDesc('Choose whether weeks start on Sunday or Monday in Calendar View.')
            .addDropdown(dropdown => dropdown
                .addOption('0', 'Sunday')
                .addOption('1', 'Monday')
                .setValue(String(this.plugin.settings.calendarWeekStartDay))
                .onChange(async (value) => {
                    this.plugin.settings.calendarWeekStartDay = value === '1' ? 1 : 0;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Max Tasks Per Cell')
            .setDesc('Maximum number of tasks shown in each calendar day cell before showing "+N more".')
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(this.plugin.settings.calendarMaxTasksPerCell)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.calendarMaxTasksPerCell = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show Completed Tasks')
            .setDesc('Show completed tasks in Calendar View.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.calendarShowCompleted)
                .onChange(async (value) => {
                    this.plugin.settings.calendarShowCompleted = value;
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
            .setDesc('Number of days (from today) to show as "Upcoming" in the Deadline list. Set to 0 to hide the Upcoming group.')
            .addText(text => text
                .setPlaceholder('7')
                .setValue(this.plugin.settings.upcomingDays.toString())
                .onChange(async (value) => {
                    let days = parseInt(value);
                    if (isNaN(days) || days < 0) days = 0;
                    this.plugin.settings.upcomingDays = days;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Expand Completed Group by Default')
            .setDesc('If enabled, the Completed group starts expanded in the Deadline list.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.expandCompletedInDeadlineList)
                .onChange(async (value) => {
                    this.plugin.settings.expandCompletedInDeadlineList = value;
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

        containerEl.createEl('h3', { text: 'Frontmatter Tasks', cls: 'setting-section-header' });

        this.addFrontmatterTaskKeySettings(containerEl);

        new Setting(containerEl)
            .setName('Child Task Heading')
            .setDesc('The heading under which new child tasks will be inserted in frontmatter task files.')
            .addText(text => text
                .setPlaceholder('Tasks')
                .setValue(this.plugin.settings.frontmatterTaskHeader)
                .onChange(async (value) => {
                    this.plugin.settings.frontmatterTaskHeader = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Child Task Heading Level')
            .setDesc('The level of the heading (1-6).')
            .addSlider(slider => slider
                .setLimits(1, 6, 1)
                .setValue(this.plugin.settings.frontmatterTaskHeaderLevel)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.frontmatterTaskHeaderLevel = value;
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

    private addFrontmatterTaskKeySettings(containerEl: HTMLElement): void {
        this.addFrontmatterTaskKeySetting(
            containerEl,
            'Start Key',
            'Frontmatter key for task start date/time.',
            'tv-start',
            'start'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            'End Key',
            'Frontmatter key for task end date/time.',
            'tv-end',
            'end'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            'Deadline Key',
            'Frontmatter key for task deadline.',
            'tv-deadline',
            'deadline'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            'Status Key',
            'Frontmatter key for task status character.',
            'tv-status',
            'status'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            'Content Key',
            'Frontmatter key for task content.',
            'tv-content',
            'content'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            'Timer Target ID Key',
            'Frontmatter key for timer target ID.',
            'tv-timer-target-id',
            'timerTargetId'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            'Color Key',
            'Frontmatter key for task/file color.',
            'tv-color',
            'color'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            'Line Style Key',
            'Frontmatter key for task border line style (solid/dashed/dotted/double/dashdotted).',
            'tv-linestyle',
            'linestyle'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            'Ignore Key',
            'Frontmatter key for file-level ignore. When truthy, this file is fully skipped from scanning and AI index.',
            'tv-ignore',
            'ignore'
        );
    }

    private addFrontmatterTaskKeySetting(
        containerEl: HTMLElement,
        name: string,
        description: string,
        placeholder: string,
        key: keyof FrontmatterTaskKeys
    ): void {
        new Setting(containerEl)
            .setName(name)
            .setDesc(description)
            .addText((text) => {
                text.setPlaceholder(placeholder);
                text.setValue(this.plugin.settings.frontmatterTaskKeys[key]);
                text.onChange(async (value) => {
                    const nextKeys: FrontmatterTaskKeys = {
                        ...this.plugin.settings.frontmatterTaskKeys,
                        [key]: value.trim(),
                    };

                    const error = validateFrontmatterTaskKeys(nextKeys);
                    if (error) {
                        new Notice(error);
                        text.setValue(this.plugin.settings.frontmatterTaskKeys[key]);
                        return;
                    }

                    this.plugin.settings.frontmatterTaskKeys = nextKeys;
                    await this.plugin.saveSettings();
                });
            });
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
