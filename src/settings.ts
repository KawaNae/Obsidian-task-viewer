import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import TaskViewerPlugin from './main';
import { DefaultLeafPosition, FrontmatterTaskKeys, HabitType, TaskViewerSettings, validateFrontmatterTaskKeys } from './types';
import { t } from './i18n';

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
            { id: 'general',     label: t('settings.tabs.general'),     render: (el: HTMLElement) => this.renderGeneralTab(el) },
            { id: 'views',       label: t('settings.tabs.views'),       render: (el: HTMLElement) => this.renderViewsTab(el) },
            { id: 'notes',       label: t('settings.tabs.notes'),       render: (el: HTMLElement) => this.renderNotesTab(el) },
            { id: 'timer',       label: t('settings.tabs.timer'),       render: (el: HTMLElement) => this.renderTimerTab(el) },
            { id: 'frontmatter', label: t('settings.tabs.frontmatter'), render: (el: HTMLElement) => this.renderFrontmatterTab(el) },
            { id: 'habits',      label: t('settings.tabs.habits'),      render: (el: HTMLElement) => this.renderHabitsTab(el) },
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
            .setName(t('settings.general.longPressThreshold'))
            .setDesc(t('settings.general.longPressThresholdDesc'))
            .addSlider(slider => slider
                .setLimits(100, 2000, 50)
                .setValue(this.plugin.settings.longPressThreshold)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.longPressThreshold = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName(t('settings.general.taskSelectAction'))
            .setDesc(t('settings.general.taskSelectActionDesc'))
            .addDropdown(dropdown => dropdown
                .addOption('click', t('settings.general.singleClick'))
                .addOption('dblclick', t('settings.general.doubleClick'))
                .setValue(this.plugin.settings.taskSelectAction)
                .onChange(async (value) => {
                    this.plugin.settings.taskSelectAction = value as 'click' | 'dblclick';
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName(t('settings.general.reuseExistingTab'))
            .setDesc(t('settings.general.reuseExistingTabDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.reuseExistingTab)
                .onChange(async (value) => {
                    this.plugin.settings.reuseExistingTab = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName(t('settings.general.showEditorMenuForTasks'))
            .setDesc(t('settings.general.showEditorMenuForTasksDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.editorMenuForTasks)
                .onChange(async (value) => {
                    this.plugin.settings.editorMenuForTasks = value;
                    await this.plugin.saveSettings();
                    this.plugin.notifyEditorMenuSettingsChanged();
                }));

        new Setting(el)
            .setName(t('settings.general.showEditorMenuForCheckboxes'))
            .setDesc(t('settings.general.showEditorMenuForCheckboxesDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.editorMenuForCheckboxes)
                .onChange(async (value) => {
                    this.plugin.settings.editorMenuForCheckboxes = value;
                    await this.plugin.saveSettings();
                    this.plugin.notifyEditorMenuSettingsChanged();
                }));

        // Checkboxes
        el.createEl('h3', { text: t('settings.general.checkboxes'), cls: 'setting-section-header' });

        new Setting(el)
            .setName(t('settings.general.applyCustomCheckboxStyles'))
            .setDesc(t('settings.general.applyCustomCheckboxStylesDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.applyGlobalStyles)
                .onChange(async (value) => {
                    this.plugin.settings.applyGlobalStyles = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateGlobalStyles();
                }));

        new Setting(el)
            .setName(t('settings.general.enableStatusMenu'))
            .setDesc(t('settings.general.enableStatusMenuDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableStatusMenu)
                .onChange(async (value) => {
                    this.plugin.settings.enableStatusMenu = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName(t('settings.general.statusMenuChars'))
            .setDesc(t('settings.general.statusMenuCharsDesc'))
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
            .setName(t('settings.general.completeStatusChars'))
            .setDesc(t('settings.general.completeStatusCharsDesc'))
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
        el.createEl('h3', { text: t('settings.general.childTasks'), cls: 'setting-section-header' });

        new Setting(el)
            .setName(t('settings.general.childTaskHeading'))
            .setDesc(t('settings.general.childTaskHeadingDesc'))
            .addText(text => text
                .setPlaceholder('Tasks')
                .setValue(this.plugin.settings.frontmatterTaskHeader)
                .onChange(async (value) => {
                    this.plugin.settings.frontmatterTaskHeader = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName(t('settings.general.childTaskHeadingLevel'))
            .setDesc(t('settings.general.childTaskHeadingLevelDesc'))
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
        el.createEl('h3', { text: t('settings.views.timeline'), cls: 'setting-section-header' });

        new Setting(el)
            .setName(t('settings.views.startHour'))
            .setDesc(t('settings.views.startHourDesc'))
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
            .setName(t('settings.views.pastDaysToShow'))
            .setDesc(t('settings.views.pastDaysToShowDesc'))
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
            .setName(t('settings.views.defaultZoomLevel'))
            .setDesc(t('settings.views.defaultZoomLevelDesc'))
            .addSlider(slider => slider
                .setLimits(0.25, 10.0, 0.25)
                .setValue(this.plugin.settings.zoomLevel)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.zoomLevel = value;
                    await this.plugin.saveSettings();
                }));

        // Calendar
        el.createEl('h3', { text: t('settings.views.calendar'), cls: 'setting-section-header' });

        new Setting(el)
            .setName(t('settings.views.weekStartsOn'))
            .setDesc(t('settings.views.weekStartsOnDesc'))
            .addDropdown(dropdown => dropdown
                .addOption('0', t('settings.views.sunday'))
                .addOption('1', t('settings.views.monday'))
                .setValue(String(this.plugin.settings.calendarWeekStartDay))
                .onChange(async (value) => {
                    this.plugin.settings.calendarWeekStartDay = value === '1' ? 1 : 0;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName(t('settings.views.showCompletedTasks'))
            .setDesc(t('settings.views.showCompletedTasksDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.calendarShowCompleted)
                .onChange(async (value) => {
                    this.plugin.settings.calendarShowCompleted = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName(t('settings.views.showWeekNumbers'))
            .setDesc(t('settings.views.showWeekNumbersDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.calendarShowWeekNumbers)
                .onChange(async (value) => {
                    this.plugin.settings.calendarShowWeekNumbers = value;
                    await this.plugin.saveSettings();
                }));

        // Default Open Position
        el.createEl('h3', { text: t('settings.views.defaultOpenPosition'), cls: 'setting-section-header' });

        new Setting(el)
            .setDesc(t('settings.views.defaultOpenPositionDesc'))
            .setClass('setting-item--desc-only');

        type ViewPositionKey = keyof TaskViewerSettings['defaultViewPositions'];
        const positionEntries: { label: string; key: ViewPositionKey }[] = [
            { label: t('settings.views.positionTimeline'), key: 'timeline' },
            { label: t('settings.views.positionSchedule'), key: 'schedule' },
            { label: t('settings.views.positionCalendar'), key: 'calendar' },
            { label: t('settings.views.positionMiniCalendar'), key: 'miniCalendar' },
            { label: t('settings.views.positionTimer'), key: 'timer' },
            { label: t('settings.views.positionKanban'), key: 'kanban' },
        ];

        for (const entry of positionEntries) {
            new Setting(el)
                .setName(entry.label)
                .addDropdown(dropdown => dropdown
                    .addOption('left', t('position.leftSidebar'))
                    .addOption('right', t('position.rightSidebar'))
                    .addOption('tab', t('position.tab'))
                    .addOption('window', t('position.window'))
                    .setValue(this.plugin.settings.defaultViewPositions[entry.key])
                    .onChange(async (value) => {
                        this.plugin.settings.defaultViewPositions[entry.key] = value as DefaultLeafPosition;
                        await this.plugin.saveSettings();
                    }));
        }

        // View Templates (moved from Timer tab)
        el.createEl('h3', { text: t('settings.views.viewTemplates'), cls: 'setting-section-header' });

        new Setting(el)
            .setName(t('settings.views.viewTemplateFolder'))
            .setDesc(t('settings.views.viewTemplateFolderDesc'))
            .addText(text => text
                .setPlaceholder('Templates/Views')
                .setValue(this.plugin.settings.viewTemplateFolder)
                .onChange(async (value) => {
                    this.plugin.settings.viewTemplateFolder = value.trim();
                    await this.plugin.saveSettings();
                }));

        // Display
        el.createEl('h3', { text: t('settings.views.display'), cls: 'setting-section-header' });

        new Setting(el)
            .setName(t('settings.views.hideViewHeader'))
            .setDesc(t('settings.views.hideViewHeaderDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hideViewHeader)
                .onChange(async (value) => {
                    this.plugin.settings.hideViewHeader = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName(t('settings.views.mobileTopOffset'))
            .setDesc(t('settings.views.mobileTopOffsetDesc'))
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
            .setName(t('settings.views.fixMobileGradientWidth'))
            .setDesc(t('settings.views.fixMobileGradientWidthDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.fixMobileGradientWidth)
                .onChange(async (value) => {
                    this.plugin.settings.fixMobileGradientWidth = value;
                    await this.plugin.saveSettings();
                }));

        // Pinned Lists
        el.createEl('h3', { text: t('settings.views.pinnedLists'), cls: 'setting-section-header' });

        new Setting(el)
            .setName(t('settings.views.tasksPerPage'))
            .setDesc(t('settings.views.tasksPerPageDesc'))
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
        el.createEl('h3', { text: t('settings.notes.dailyNotes'), cls: 'setting-section-header' });

        new Setting(el)
            .setName(t('settings.notes.dailyNoteHeader'))
            .setDesc(t('settings.notes.dailyNoteHeaderDesc'))
            .addText(text => text
                .setPlaceholder('Tasks')
                .setValue(this.plugin.settings.dailyNoteHeader)
                .onChange(async (value) => {
                    this.plugin.settings.dailyNoteHeader = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName(t('settings.notes.dailyNoteHeaderLevel'))
            .setDesc(t('settings.notes.dailyNoteHeaderLevelDesc'))
            .addSlider(slider => slider
                .setLimits(1, 6, 1)
                .setValue(this.plugin.settings.dailyNoteHeaderLevel)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.dailyNoteHeaderLevel = value;
                    await this.plugin.saveSettings();
                }));

        // Periodic Notes
        el.createEl('h3', { text: t('settings.notes.periodicNotes'), cls: 'setting-section-header' });

        new Setting(el)
            .setName(t('settings.notes.weeklyNoteFormat'))
            .setDesc(t('settings.notes.weeklyNoteFormatDesc'))
            .addText(text => text
                .setPlaceholder('gggg-[W]ww')
                .setValue(this.plugin.settings.weeklyNoteFormat)
                .onChange(async (value) => {
                    this.plugin.settings.weeklyNoteFormat = value || 'gggg-[W]ww';
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName(t('settings.notes.weeklyNoteFolder'))
            .setDesc(t('settings.notes.weeklyNoteFolderDesc'))
            .addText(text => text
                .setPlaceholder('')
                .setValue(this.plugin.settings.weeklyNoteFolder)
                .onChange(async (value) => {
                    this.plugin.settings.weeklyNoteFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName(t('settings.notes.monthlyNoteFormat'))
            .setDesc(t('settings.notes.monthlyNoteFormatDesc'))
            .addText(text => text
                .setPlaceholder('YYYY-MM')
                .setValue(this.plugin.settings.monthlyNoteFormat)
                .onChange(async (value) => {
                    this.plugin.settings.monthlyNoteFormat = value || 'YYYY-MM';
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName(t('settings.notes.monthlyNoteFolder'))
            .setDesc(t('settings.notes.monthlyNoteFolderDesc'))
            .addText(text => text
                .setPlaceholder('')
                .setValue(this.plugin.settings.monthlyNoteFolder)
                .onChange(async (value) => {
                    this.plugin.settings.monthlyNoteFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName(t('settings.notes.yearlyNoteFormat'))
            .setDesc(t('settings.notes.yearlyNoteFormatDesc'))
            .addText(text => text
                .setPlaceholder('YYYY')
                .setValue(this.plugin.settings.yearlyNoteFormat)
                .onChange(async (value) => {
                    this.plugin.settings.yearlyNoteFormat = value || 'YYYY';
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName(t('settings.notes.yearlyNoteFolder'))
            .setDesc(t('settings.notes.yearlyNoteFolderDesc'))
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
        el.createEl('h3', { text: t('settings.timer.pomodoro'), cls: 'setting-section-header' });

        new Setting(el)
            .setName(t('settings.timer.customWorkMinutes'))
            .setDesc(t('settings.timer.customWorkMinutesDesc'))
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
            .setName(t('settings.timer.customBreakMinutes'))
            .setDesc(t('settings.timer.customBreakMinutesDesc'))
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

        el.createEl('h3', { text: t('settings.timer.intervalTimer'), cls: 'setting-section-header' });

        new Setting(el)
            .setName(t('settings.timer.intervalTemplateFolder'))
            .setDesc(t('settings.timer.intervalTemplateFolderDesc'))
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
        el.createEl('h3', { text: t('settings.frontmatter.frontmatterKeys'), cls: 'setting-section-header' });

        this.addFrontmatterTaskKeySettings(el);

        el.createEl('h3', { text: t('settings.frontmatter.suggest'), cls: 'setting-section-header' });

        new Setting(el)
            .setDesc(t('settings.frontmatter.suggestReloadNotice'))
            .setClass('setting-item--desc-only');

        new Setting(el)
            .setName(t('settings.frontmatter.colorSuggest'))
            .setDesc(t('settings.frontmatter.colorSuggestDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.suggestColor)
                .onChange(async (value) => {
                    this.plugin.settings.suggestColor = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(el)
            .setName(t('settings.frontmatter.lineStyleSuggest'))
            .setDesc(t('settings.frontmatter.lineStyleSuggestDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.suggestLinestyle)
                .onChange(async (value) => {
                    this.plugin.settings.suggestLinestyle = value;
                    await this.plugin.saveSettings();
                }));

    }

    // ─── Habits Tab ──────────────────────────────────────────

    private renderHabitsTab(el: HTMLElement): void {
        const habitHeader = el.createDiv('setting-item');
        habitHeader.createSpan({ text: t('settings.habits.description'), cls: 'setting-item-description' });

        const habitsListContainer = el.createDiv('habits-list-container');
        this.renderHabitsList(habitsListContainer);

        new Setting(el)
            .setName(t('settings.habits.addHabit'))
            .setDesc(t('settings.habits.addHabitDesc'))
            .addButton(btn => btn
                .setButtonText(t('settings.habits.addButton'))
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
            t('settings.frontmatter.startKey'),
            t('settings.frontmatter.startKeyDesc'),
            'tv-start',
            'start'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            t('settings.frontmatter.endKey'),
            t('settings.frontmatter.endKeyDesc'),
            'tv-end',
            'end'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            t('settings.frontmatter.dueKey'),
            t('settings.frontmatter.dueKeyDesc'),
            'tv-due',
            'due'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            t('settings.frontmatter.statusKey'),
            t('settings.frontmatter.statusKeyDesc'),
            'tv-status',
            'status'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            t('settings.frontmatter.contentKey'),
            t('settings.frontmatter.contentKeyDesc'),
            'tv-content',
            'content'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            t('settings.frontmatter.timerTargetIdKey'),
            t('settings.frontmatter.timerTargetIdKeyDesc'),
            'tv-timer-target-id',
            'timerTargetId'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            t('settings.frontmatter.colorKey'),
            t('settings.frontmatter.colorKeyDesc'),
            'tv-color',
            'color'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            t('settings.frontmatter.lineStyleKey'),
            t('settings.frontmatter.lineStyleKeyDesc'),
            'tv-linestyle',
            'linestyle'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            t('settings.frontmatter.maskKey'),
            t('settings.frontmatter.maskKeyDesc'),
            'tv-mask',
            'mask'
        );
        this.addFrontmatterTaskKeySetting(
            containerEl,
            t('settings.frontmatter.ignoreKey'),
            t('settings.frontmatter.ignoreKeyDesc'),
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
                .setName(t('settings.habits.habitN', { n: i + 1 }))
                .addText(text => text
                    .setPlaceholder(t('settings.habits.habitNamePlaceholder'))
                    .setValue(habit.name)
                    .onChange(async (value) => {
                        this.plugin.settings.habits[i].name = value.trim();
                        await this.plugin.saveSettings();
                    })
                )
                .addDropdown(dropdown => dropdown
                    .addOption('boolean', t('settings.habits.booleanType'))
                    .addOption('number', t('settings.habits.numberType'))
                    .addOption('string', t('settings.habits.textType'))
                    .setValue(habit.type)
                    .onChange(async (value) => {
                        this.plugin.settings.habits[i].type = value as HabitType;
                        await this.plugin.saveSettings();
                        this.renderHabitsList(container);
                    })
                );

            if (habit.type === 'number') {
                setting.addText(text => text
                    .setPlaceholder(t('settings.habits.unitPlaceholder'))
                    .setValue(habit.unit ?? '')
                    .onChange(async (value) => {
                        this.plugin.settings.habits[i].unit = value.trim() || undefined;
                        await this.plugin.saveSettings();
                    })
                );
            }

            setting.addButton(btn => btn
                .setIcon('trash')
                .setTooltip(t('settings.habits.removeHabit'))
                .onClick(async () => {
                    this.plugin.settings.habits.splice(i, 1);
                    await this.plugin.saveSettings();
                    this.renderHabitsList(container);
                })
            );
        });
    }
}
