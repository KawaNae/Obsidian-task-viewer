import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import TaskViewerPlugin from './main';
import { DefaultLeafPosition, FrontmatterTaskKeys, HabitType, TaskViewerSettings, validateFrontmatterTaskKeys } from './types';

export class TaskViewerSettingTab extends PluginSettingTab {
    plugin: TaskViewerPlugin;

    constructor(app: App, plugin: TaskViewerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('tv-settings');

        // Version display
        const versionEl = containerEl.createDiv('tv-settings__version');
        versionEl.createSpan({
            text: `Task Viewer v${this.plugin.manifest.version}`,
            cls: 'setting-item-description'
        });
        versionEl.createSpan({
            text: ` — Built: ${typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'unknown'}`,
            cls: 'setting-item-description'
        });

        // Tab UI
        const wrapper = containerEl.createDiv('tv-settings__wrapper');
        const nav = wrapper.createDiv('tv-settings__nav');
        const content = wrapper.createDiv('tv-settings__content');

        const tabs = [
            { id: 'general',     label: 'General',     render: (el: HTMLElement) => this.renderGeneralTab(el) },
            { id: 'views',       label: 'Views',       render: (el: HTMLElement) => this.renderViewsTab(el) },
            { id: 'notes',       label: 'Notes',       render: (el: HTMLElement) => this.renderNotesTab(el) },
            { id: 'timer',       label: 'Timer',       render: (el: HTMLElement) => this.renderTimerTab(el) },
            { id: 'frontmatter', label: 'Frontmatter', render: (el: HTMLElement) => this.renderFrontmatterTab(el) },
            { id: 'habits',      label: 'Habits',      render: (el: HTMLElement) => this.renderHabitsTab(el) },
        ];

        tabs.forEach(tab => {
            const btn = nav.createEl('div', {
                cls: 'tv-settings__nav-btn',
                text: tab.label,
                attr: { role: 'tab', tabindex: '0' },
            });
            btn.dataset.tabId = tab.id;

            const panel = content.createDiv('tv-settings__panel');
            panel.dataset.tabId = tab.id;
            tab.render(panel);
        });

        this.activateTab(wrapper, tabs[0].id);

        nav.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('.tv-settings__nav-btn') as HTMLElement | null;
            if (btn?.dataset.tabId) {
                this.activateTab(wrapper, btn.dataset.tabId);
            }
        });
    }

    private activateTab(wrapper: HTMLElement, tabId: string): void {
        wrapper.querySelectorAll('.tv-settings__nav-btn').forEach(btn =>
            btn.toggleClass('tv-settings__nav-btn--active', (btn as HTMLElement).dataset.tabId === tabId)
        );
        wrapper.querySelectorAll('.tv-settings__panel').forEach(panel =>
            (panel as HTMLElement).style.display = (panel as HTMLElement).dataset.tabId === tabId ? '' : 'none'
        );
    }

    // ─── General Tab ─────────────────────────────────────────

    private renderGeneralTab(el: HTMLElement): void {
        new Setting(el)
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

        new Setting(el)
            .setName('Task Select Action')
            .setDesc('How to select a task card to show drag handles. Double click can help prevent accidental selections.')
            .addDropdown(dropdown => dropdown
                .addOption('click', 'Single Click')
                .addOption('dblclick', 'Double Click')
                .setValue(this.plugin.settings.taskSelectAction)
                .onChange(async (value) => {
                    this.plugin.settings.taskSelectAction = value as 'click' | 'dblclick';
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName('Reuse Existing Tab')
            .setDesc('When opening a file from a task card, switch to the existing tab if the file is already open, instead of opening a new tab.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.reuseExistingTab)
                .onChange(async (value) => {
                    this.plugin.settings.reuseExistingTab = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName('Show Editor Menu for Tasks')
            .setDesc('Show a ··· menu button on recognized inline task lines in the editor.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.editorMenuForTasks)
                .onChange(async (value) => {
                    this.plugin.settings.editorMenuForTasks = value;
                    await this.plugin.saveSettings();
                    this.plugin.notifyEditorMenuSettingsChanged();
                }));

        new Setting(el)
            .setName('Show Editor Menu for Checkboxes')
            .setDesc('Show a ··· menu button on plain checkbox lines in the editor.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.editorMenuForCheckboxes)
                .onChange(async (value) => {
                    this.plugin.settings.editorMenuForCheckboxes = value;
                    await this.plugin.saveSettings();
                    this.plugin.notifyEditorMenuSettingsChanged();
                }));

        // Checkboxes
        el.createEl('h3', { text: 'Checkboxes', cls: 'setting-section-header' });

        new Setting(el)
            .setName('Apply Custom Checkboxes Styles')
            .setDesc('If enabled, the plugin will apply its checkbox styles to the entire Obsidian editor, replacing the need for a separate CSS snippet.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.applyGlobalStyles)
                .onChange(async (value) => {
                    this.plugin.settings.applyGlobalStyles = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateGlobalStyles();
                }));

        new Setting(el)
            .setName('Enable Status Menu')
            .setDesc('Show a status selection menu when right-clicking checkboxes on task cards and in the editor.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableStatusMenu)
                .onChange(async (value) => {
                    this.plugin.settings.enableStatusMenu = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName('Status Menu Characters')
            .setDesc('Additional status characters shown in the menu (comma or space separated). [ ] and [x] are always included.')
            .addText(text => text
                .setPlaceholder('-, !, ?, >, /')
                .setValue(this.plugin.settings.statusMenuChars.join(', '))
                .onChange(async (value) => {
                    const chars = value.split(/[,\s]+/)
                        .map(c => c.trim())
                        .filter(c => c.length === 1);
                    this.plugin.settings.statusMenuChars = chars.length > 0 ? chars : ['-', '!', '?', '>', '/'];
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName('Complete Status Characters')
            .setDesc('Characters that represent completed tasks (comma or space separated, e.g., "x, X, -, !").')
            .addText(text => text
                .setPlaceholder('x, X, -, !')
                .setValue(this.plugin.settings.completeStatusChars.join(', '))
                .onChange(async (value) => {
                    const chars = value.split(/[,\s]+/)
                        .map(c => c.trim())
                        .filter(c => c.length > 0);
                    this.plugin.settings.completeStatusChars = chars.length > 0 ? chars : ['x', 'X', '-', '!'];
                    await this.plugin.saveSettings();
                }));

        // Child Tasks
        el.createEl('h3', { text: 'Child Tasks', cls: 'setting-section-header' });

        new Setting(el)
            .setName('Child Task Heading')
            .setDesc('The heading under which new child tasks will be inserted in frontmatter task files.')
            .addText(text => text
                .setPlaceholder('Tasks')
                .setValue(this.plugin.settings.frontmatterTaskHeader)
                .onChange(async (value) => {
                    this.plugin.settings.frontmatterTaskHeader = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
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
    }

    // ─── Views Tab ───────────────────────────────────────────

    private renderViewsTab(el: HTMLElement): void {
        // Timeline
        el.createEl('h3', { text: 'Timeline', cls: 'setting-section-header' });

        new Setting(el)
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

        new Setting(el)
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

        new Setting(el)
            .setName('Default Zoom Level')
            .setDesc('Default zoom level for new Timeline views. Each view can override this independently.')
            .addSlider(slider => slider
                .setLimits(0.25, 10.0, 0.25)
                .setValue(this.plugin.settings.zoomLevel)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.zoomLevel = value;
                    await this.plugin.saveSettings();
                }));

        // Calendar
        el.createEl('h3', { text: 'Calendar', cls: 'setting-section-header' });

        new Setting(el)
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

        new Setting(el)
            .setName('Show Completed Tasks')
            .setDesc('Show completed tasks in Calendar View.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.calendarShowCompleted)
                .onChange(async (value) => {
                    this.plugin.settings.calendarShowCompleted = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName('Show Week Numbers')
            .setDesc('Show ISO week numbers in Calendar and Mini Calendar views.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.calendarShowWeekNumbers)
                .onChange(async (value) => {
                    this.plugin.settings.calendarShowWeekNumbers = value;
                    await this.plugin.saveSettings();
                }));

        // Default Open Position
        el.createEl('h3', { text: 'Default Open Position', cls: 'setting-section-header' });

        new Setting(el)
            .setDesc('Where each view opens when launched from the command palette, ribbon icon, or a URI without a position parameter. In URIs, use position=override to reuse an existing view in place instead of opening a new one.')
            .setClass('setting-item--desc-only');

        type ViewPositionKey = keyof TaskViewerSettings['defaultViewPositions'];
        const positionEntries: { label: string; key: ViewPositionKey }[] = [
            { label: 'Timeline', key: 'timeline' },
            { label: 'Schedule', key: 'schedule' },
            { label: 'Calendar', key: 'calendar' },
            { label: 'Mini Calendar', key: 'miniCalendar' },
            { label: 'Timer', key: 'timer' },
            { label: 'Kanban', key: 'kanban' },
        ];

        for (const entry of positionEntries) {
            new Setting(el)
                .setName(entry.label)
                .addDropdown(dropdown => dropdown
                    .addOption('left', 'Left sidebar')
                    .addOption('right', 'Right sidebar')
                    .addOption('tab', 'Tab')
                    .addOption('window', 'Window')
                    .setValue(this.plugin.settings.defaultViewPositions[entry.key])
                    .onChange(async (value) => {
                        this.plugin.settings.defaultViewPositions[entry.key] = value as DefaultLeafPosition;
                        await this.plugin.saveSettings();
                    }));
        }

        // View Templates (moved from Timer tab)
        el.createEl('h3', { text: 'View Templates', cls: 'setting-section-header' });

        new Setting(el)
            .setName('View Template Folder')
            .setDesc('Vault folder for view template files (.md with _tv-view in frontmatter). Used for cross-device sync of view configurations.')
            .addText(text => text
                .setPlaceholder('Templates/Views')
                .setValue(this.plugin.settings.viewTemplateFolder)
                .onChange(async (value) => {
                    this.plugin.settings.viewTemplateFolder = value.trim();
                    await this.plugin.saveSettings();
                }));

        // Display
        el.createEl('h3', { text: 'Display', cls: 'setting-section-header' });

        new Setting(el)
            .setName('Hide view header')
            .setDesc('Hide the view header (navigation bar) in task viewer panels.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hideViewHeader)
                .onChange(async (value) => {
                    this.plugin.settings.hideViewHeader = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName('Mobile top offset (px)')
            .setDesc('Top offset for mobile views when the header is hidden. Prevents overlap with the OS status bar.')
            .addText(text => {
                text.inputEl.type = 'number';
                text.inputEl.min = '0';
                text
                    .setPlaceholder('32')
                    .setValue(this.plugin.settings.mobileTopOffset.toString())
                    .onChange(async (value) => {
                        let offset = parseInt(value);
                        if (isNaN(offset) || offset < 0) offset = 32;
                        this.plugin.settings.mobileTopOffset = offset;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(el)
            .setName('Fix mobile gradient width')
            .setDesc('Set the background gradient to 100% width on mobile views.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.fixMobileGradientWidth)
                .onChange(async (value) => {
                    this.plugin.settings.fixMobileGradientWidth = value;
                    await this.plugin.saveSettings();
                }));

        // Pinned Lists
        el.createEl('h3', { text: 'Pinned Lists', cls: 'setting-section-header' });

        new Setting(el)
            .setName('Tasks per page')
            .setDesc('Number of task cards to show initially in each pinned list. Click "Show more" to load the next batch.')
            .addText(text => {
                text.inputEl.type = 'number';
                text.inputEl.min = '1';
                text
                    .setPlaceholder('10')
                    .setValue(this.plugin.settings.pinnedListPageSize.toString())
                    .onChange(async (value) => {
                        let n = parseInt(value);
                        if (isNaN(n) || n < 1) n = 10;
                        this.plugin.settings.pinnedListPageSize = n;
                        await this.plugin.saveSettings();
                    });
            });
    }


    // ─── Notes Tab ───────────────────────────────────────────

    private renderNotesTab(el: HTMLElement): void {
        // Daily Notes
        el.createEl('h3', { text: 'Daily Notes', cls: 'setting-section-header' });

        new Setting(el)
            .setName('Daily Note Header')
            .setDesc('The header under which new tasks will be added in the Daily Note.')
            .addText(text => text
                .setPlaceholder('Tasks')
                .setValue(this.plugin.settings.dailyNoteHeader)
                .onChange(async (value) => {
                    this.plugin.settings.dailyNoteHeader = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
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

        // Periodic Notes
        el.createEl('h3', { text: 'Periodic Notes', cls: 'setting-section-header' });

        new Setting(el)
            .setName('Weekly Note Format')
            .setDesc('moment.js format for weekly note filenames (e.g. gggg-[W]ww).')
            .addText(text => text
                .setPlaceholder('gggg-[W]ww')
                .setValue(this.plugin.settings.weeklyNoteFormat)
                .onChange(async (value) => {
                    this.plugin.settings.weeklyNoteFormat = value || 'gggg-[W]ww';
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName('Weekly Note Folder')
            .setDesc('Folder for weekly notes. Leave empty for vault root.')
            .addText(text => text
                .setPlaceholder('')
                .setValue(this.plugin.settings.weeklyNoteFolder)
                .onChange(async (value) => {
                    this.plugin.settings.weeklyNoteFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName('Monthly Note Format')
            .setDesc('moment.js format for monthly note filenames (e.g. YYYY-MM).')
            .addText(text => text
                .setPlaceholder('YYYY-MM')
                .setValue(this.plugin.settings.monthlyNoteFormat)
                .onChange(async (value) => {
                    this.plugin.settings.monthlyNoteFormat = value || 'YYYY-MM';
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName('Monthly Note Folder')
            .setDesc('Folder for monthly notes. Leave empty for vault root.')
            .addText(text => text
                .setPlaceholder('')
                .setValue(this.plugin.settings.monthlyNoteFolder)
                .onChange(async (value) => {
                    this.plugin.settings.monthlyNoteFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName('Yearly Note Format')
            .setDesc('moment.js format for yearly note filenames (e.g. YYYY).')
            .addText(text => text
                .setPlaceholder('YYYY')
                .setValue(this.plugin.settings.yearlyNoteFormat)
                .onChange(async (value) => {
                    this.plugin.settings.yearlyNoteFormat = value || 'YYYY';
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName('Yearly Note Folder')
            .setDesc('Folder for yearly notes. Leave empty for vault root.')
            .addText(text => text
                .setPlaceholder('')
                .setValue(this.plugin.settings.yearlyNoteFolder)
                .onChange(async (value) => {
                    this.plugin.settings.yearlyNoteFolder = value;
                    await this.plugin.saveSettings();
                }));
    }

    // ─── Timer Tab ───────────────────────────────────────────

    private renderTimerTab(el: HTMLElement): void {
        el.createEl('h3', { text: 'Pomodoro', cls: 'setting-section-header' });

        new Setting(el)
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

        new Setting(el)
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

        el.createEl('h3', { text: 'Interval Timer', cls: 'setting-section-header' });

        new Setting(el)
            .setName('Interval Template Folder')
            .setDesc('Vault folder containing interval timer template files (.md with _tv-segments in frontmatter). Leave empty to disable.')
            .addText(text => text
                .setPlaceholder('Templates/Timers')
                .setValue(this.plugin.settings.intervalTemplateFolder)
                .onChange(async (value) => {
                    this.plugin.settings.intervalTemplateFolder = value.trim();
                    await this.plugin.saveSettings();
                }));

    }

    // ─── Frontmatter Tab ─────────────────────────────────────

    private renderFrontmatterTab(el: HTMLElement): void {
        el.createEl('h3', { text: 'Frontmatter Keys', cls: 'setting-section-header' });

        this.addFrontmatterTaskKeySettings(el);

        el.createEl('h3', { text: 'Suggest', cls: 'setting-section-header' });

        new Setting(el)
            .setDesc('Changes may require reloading Obsidian to take effect.')
            .setClass('setting-item--desc-only');

        new Setting(el)
            .setName('Color suggest')
            .setDesc('Enable custom color suggestions for the color property.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.suggestColor)
                .onChange(async (value) => {
                    this.plugin.settings.suggestColor = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName('Line style suggest')
            .setDesc('Enable custom line style suggestions for the linestyle property.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.suggestLinestyle)
                .onChange(async (value) => {
                    this.plugin.settings.suggestLinestyle = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName('Shared tags suggest')
            .setDesc('Enable custom tag suggestions for the shared tags property.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.suggestSharedtags)
                .onChange(async (value) => {
                    this.plugin.settings.suggestSharedtags = value;
                    await this.plugin.saveSettings();
                }));
    }

    // ─── Habits Tab ──────────────────────────────────────────

    private renderHabitsTab(el: HTMLElement): void {
        const habitHeader = el.createDiv('setting-item');
        habitHeader.createSpan({ text: 'Define habits to track in your daily notes\' frontmatter.', cls: 'setting-item-description' });

        const habitsListContainer = el.createDiv('habits-list-container');
        this.renderHabitsList(habitsListContainer);

        new Setting(el)
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

    // ─── Shared Helpers ──────────────────────────────────────

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
            'Due Key',
            'Frontmatter key for task due date.',
            'tv-due',
            'due'
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
            'Placeholder Key',
            'Frontmatter key for export masking. When set, task content is replaced with this value in image exports.',
            'tv-placeholder',
            'placeholder'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            'Shared Tags Key',
            'Frontmatter key for file-level shared tags inherited by all tasks in the file. Use "tags" for Obsidian compatibility.',
            'tags',
            'sharedtags'
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
