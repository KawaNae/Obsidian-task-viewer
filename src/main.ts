import { Notice, Plugin, WorkspaceLeaf, setIcon, TFile } from 'obsidian';
import { TaskIndex } from './services/core/TaskIndex';
import { TimelineView, VIEW_TYPE_TIMELINE } from './views/timelineview';
import { ScheduleView, VIEW_TYPE_SCHEDULE } from './views/scheduleview';
import { CalendarView, VIEW_TYPE_CALENDAR } from './views/CalendarView';
import { PomodoroView, VIEW_TYPE_POMODORO } from './views/PomodoroView';
import { PomodoroService } from './services/execution/PomodoroService';
import { TimerWidget } from './widgets/TimerWidget';
import {
    TaskViewerSettings,
    DEFAULT_SETTINGS,
    DEFAULT_FRONTMATTER_TASK_KEYS,
    normalizeFrontmatterTaskKeys,
    validateFrontmatterTaskKeys,
} from './types';
import { normalizeAiIndexSettings } from './services/aiindex/AiIndexSettings';
import { TaskViewerSettingTab } from './settings';
import { ColorSuggest } from './suggest/color/ColorSuggest';
import { PropertyColorSuggest } from './suggest/color/PropertyColorSuggest';
import { LineStyleSuggest } from './suggest/line/LineStyleSuggest';
import { PropertyLineStyleSuggest } from './suggest/line/PropertyLineStyleSuggest';
import { DateUtils } from './utils/DateUtils';
import { TASK_VIEWER_HOVER_SOURCE_DISPLAY, TASK_VIEWER_HOVER_SOURCE_ID } from './constants/hover';
import { getViewMeta } from './constants/viewRegistry';

export default class TaskViewerPlugin extends Plugin {
    private taskIndex: TaskIndex;
    private pomodoroService: PomodoroService;
    private timerWidget: TimerWidget;
    public settings: TaskViewerSettings;

    // Day boundary check
    private lastVisualDate: string = '';
    private dateCheckInterval: ReturnType<typeof setInterval> | null = null;

    // MutationObserver for Properties View color suggestions
    private propertiesObserver: MutationObserver | null = null;
    private attachedInputs: WeakSet<HTMLElement> = new WeakSet();

    async onload() {
        console.log('Loading Task Viewer Plugin (Rewrite)');

        // Load Settings
        await this.loadSettings();

        // Initialize Services
        this.taskIndex = new TaskIndex(this.app, this.settings, this.manifest.version);
        await this.taskIndex.initialize();

        this.pomodoroService = new PomodoroService({
            workMinutes: this.settings.pomodoroWorkMinutes,
            breakMinutes: this.settings.pomodoroBreakMinutes,
        });

        // Initialize Timer Widget
        this.timerWidget = new TimerWidget(this.app, this);

        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (!(file instanceof TFile) || file.extension !== 'md') return;
            this.timerWidget?.handleFileRename(oldPath, file.path);
        }));

        // Register View
        this.registerHoverLinkSource(TASK_VIEWER_HOVER_SOURCE_ID, {
            display: TASK_VIEWER_HOVER_SOURCE_DISPLAY,
            defaultMod: false,
        });

        this.registerView(
            VIEW_TYPE_TIMELINE,
            (leaf) => new TimelineView(leaf, this.taskIndex, this)
        );

        this.registerView(
            VIEW_TYPE_SCHEDULE,
            (leaf) => new ScheduleView(leaf, this.taskIndex, this)
        );

        this.registerView(
            VIEW_TYPE_POMODORO,
            (leaf) => new PomodoroView(leaf, this, this.pomodoroService)
        );

        this.registerView(
            VIEW_TYPE_CALENDAR,
            (leaf) => new CalendarView(leaf, this.taskIndex, this)
        );

        const timelineViewMeta = getViewMeta(VIEW_TYPE_TIMELINE);
        const scheduleViewMeta = getViewMeta(VIEW_TYPE_SCHEDULE);
        const pomodoroViewMeta = getViewMeta(VIEW_TYPE_POMODORO);
        const calendarViewMeta = getViewMeta(VIEW_TYPE_CALENDAR);

        // Add Ribbon Icon
        this.addRibbonIcon(timelineViewMeta.icon, timelineViewMeta.ribbonTitle, () => {
            this.activateView(VIEW_TYPE_TIMELINE);
        });

        this.addRibbonIcon(scheduleViewMeta.icon, scheduleViewMeta.ribbonTitle, () => {
            this.activateView(VIEW_TYPE_SCHEDULE);
        });

        this.addRibbonIcon(pomodoroViewMeta.icon, pomodoroViewMeta.ribbonTitle, () => {
            this.activateView(VIEW_TYPE_POMODORO);
        });

        this.addRibbonIcon(calendarViewMeta.icon, calendarViewMeta.ribbonTitle, () => {
            this.activateView(VIEW_TYPE_CALENDAR);
        });

        // Add Command
        this.addCommand({
            id: 'open-timeline-view',
            name: timelineViewMeta.commandName,
            callback: () => {
                this.activateView(VIEW_TYPE_TIMELINE);
            }
        });

        this.addCommand({
            id: 'open-schedule-view',
            name: scheduleViewMeta.commandName,
            callback: () => {
                this.activateView(VIEW_TYPE_SCHEDULE);
            }
        });

        this.addCommand({
            id: 'open-pomodoro-view',
            name: pomodoroViewMeta.commandName,
            callback: () => {
                this.activateView(VIEW_TYPE_POMODORO);
            }
        });

        this.addCommand({
            id: 'open-calendar-view',
            name: calendarViewMeta.commandName,
            callback: () => {
                this.activateView(VIEW_TYPE_CALENDAR);
            }
        });

        this.addCommand({
            id: 'task-viewer-rebuild-ai-index',
            name: 'Task Viewer: Rebuild AI Index',
            callback: async () => {
                try {
                    await this.taskIndex.rebuildAiIndex();
                    new Notice('Task Viewer: AI index rebuilt.');
                } catch (error) {
                    console.error('[TaskViewer] Failed to rebuild AI index:', error);
                    new Notice('Task Viewer: failed to rebuild AI index.');
                }
            }
        });

        this.addCommand({
            id: 'task-viewer-toggle-ai-index',
            name: 'Task Viewer: Toggle AI Index',
            callback: async () => {
                this.settings.aiIndex.enabled = !this.settings.aiIndex.enabled;
                await this.saveSettings();

                if (this.settings.aiIndex.enabled) {
                    await this.taskIndex.rebuildAiIndex();
                    new Notice('Task Viewer: AI index enabled.');
                } else {
                    new Notice('Task Viewer: AI index disabled.');
                }
            }
        });

        this.addCommand({
            id: 'task-viewer-open-ai-index-file',
            name: 'Task Viewer: Open AI Index File',
            callback: async () => {
                try {
                    await this.taskIndex.openAiIndexFile();
                } catch (error) {
                    console.error('[TaskViewer] Failed to open AI index file:', error);
                    new Notice('Task Viewer: failed to open AI index file.');
                }
            }
        });

        // Register Settings Tab
        this.addSettingTab(new TaskViewerSettingTab(this.app, this));

        // Register Editor Suggest
        this.registerEditorSuggest(new ColorSuggest(this.app, this));
        this.registerEditorSuggest(new LineStyleSuggest(this.app, this));

        // Apply global styles if enabled
        this.updateGlobalStyles();

        // Start day boundary check (every 5 minutes)
        this.startDateBoundaryCheck();

        // Start Properties View color suggest observer
        this.startPropertiesColorSuggest();

        // Register URI handler: obsidian://task-viewer?view=timeline|calendar|schedule
        this.registerObsidianProtocolHandler('task-viewer', (params) => {
            const viewMap: Record<string, string> = {
                timeline: VIEW_TYPE_TIMELINE,
                calendar: VIEW_TYPE_CALENDAR,
                schedule: VIEW_TYPE_SCHEDULE,
            };
            const viewType = viewMap[params.view];
            if (viewType) {
                this.activateView(viewType);
            }
        });
    }

    async loadSettings() {
        const raw = await this.loadData();
        const rawObject = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
        const merged = Object.assign({}, DEFAULT_SETTINGS, rawObject) as TaskViewerSettings & {
            frontmatterTaskKeys?: unknown;
            aiIndex?: unknown;
        };
        const hasExpandCompletedKey = Object.prototype.hasOwnProperty.call(rawObject, 'expandCompletedInDeadlineList');
        const hasLegacyShowCompletedKey = Object.prototype.hasOwnProperty.call(rawObject, 'showCompletedInDeadlineList');
        const resolveExpandCompletedInDeadlineList = (): boolean => {
            if (hasExpandCompletedKey) {
                const rawValue = rawObject.expandCompletedInDeadlineList;
                return typeof rawValue === 'boolean'
                    ? rawValue
                    : DEFAULT_SETTINGS.expandCompletedInDeadlineList;
            }
            if (hasLegacyShowCompletedKey) {
                const rawValue = rawObject.showCompletedInDeadlineList;
                return typeof rawValue === 'boolean'
                    ? rawValue
                    : DEFAULT_SETTINGS.expandCompletedInDeadlineList;
            }
            return DEFAULT_SETTINGS.expandCompletedInDeadlineList;
        };
        const sanitizedMerged = { ...merged } as TaskViewerSettings & Record<string, unknown>;
        delete sanitizedMerged.showCompletedInDeadlineList;
        delete sanitizedMerged.excludedPaths;

        const normalizedFrontmatterKeys = normalizeFrontmatterTaskKeys(merged.frontmatterTaskKeys);
        const keysValidationError = validateFrontmatterTaskKeys(normalizedFrontmatterKeys);
        const normalizedAiIndexSettings = normalizeAiIndexSettings(merged.aiIndex);

        this.settings = {
            ...sanitizedMerged,
            expandCompletedInDeadlineList: resolveExpandCompletedInDeadlineList(),
            frontmatterTaskKeys: keysValidationError
                ? { ...DEFAULT_FRONTMATTER_TASK_KEYS }
                : normalizedFrontmatterKeys,
            aiIndex: normalizedAiIndexSettings,
        };
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.taskIndex.updateSettings(this.settings);

        // Update pomodoro service settings
        this.pomodoroService?.updateSettings({
            workMinutes: this.settings.pomodoroWorkMinutes,
            breakMinutes: this.settings.pomodoroBreakMinutes,
        });

        this.refreshAllViews();
    }

    updateGlobalStyles() {
        if (this.settings.applyGlobalStyles) {
            document.body.classList.add('task-viewer-global-styles');
        } else {
            document.body.classList.remove('task-viewer-global-styles');
        }
    }

    // Public accessors for services
    getTaskIndex(): TaskIndex {
        return this.taskIndex;
    }

    getTaskRepository() {
        return (this.taskIndex as any).repository;
    }

    getTimerWidget(): TimerWidget {
        return this.timerWidget;
    }

    /**
     * Start checking for day boundary changes every 5 minutes
     */
    private startDateBoundaryCheck(): void {
        // Record current visual date
        this.lastVisualDate = DateUtils.getVisualDateOfNow(this.settings.startHour);

        // Check every 5 minutes
        this.dateCheckInterval = setInterval(() => {
            const currentVisualDate = DateUtils.getVisualDateOfNow(this.settings.startHour);
            if (currentVisualDate !== this.lastVisualDate) {
                console.log(`[TaskViewer] Day boundary crossed: ${this.lastVisualDate} -> ${currentVisualDate}`);
                this.lastVisualDate = currentVisualDate;
                this.refreshAllViews();
            }
        }, 5 * 60 * 1000); // 5 minutes
    }

    /**
     * Refresh all task viewer views
     */
    public refreshAllViews(): void {
        [VIEW_TYPE_TIMELINE, VIEW_TYPE_SCHEDULE, VIEW_TYPE_CALENDAR].forEach(viewType => {
            this.app.workspace.getLeavesOfType(viewType).forEach(leaf => {
                (leaf.view as any).refresh?.();
            });
        });
    }

    async activateView(viewType: string) {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(viewType);

        if (leaves.length === 0) {
            leaf = workspace.getRightLeaf(false);
        } else {
            leaf = workspace.getLeaf(true);
        }

        if (leaf) {
            await leaf.setViewState({ type: viewType, active: true });
            workspace.revealLeaf(leaf);
        }
    }

    onunload() {
        console.log('Unloading Task Viewer Plugin');
        this.taskIndex?.dispose();
        document.body.classList.remove('task-viewer-global-styles');
        this.pomodoroService?.destroy();
        this.timerWidget?.destroy();

        // Clear day boundary check interval
        if (this.dateCheckInterval) {
            clearInterval(this.dateCheckInterval);
            this.dateCheckInterval = null;
        }

        // Disconnect Properties color suggest observer
        if (this.propertiesObserver) {
            this.propertiesObserver.disconnect();
            this.propertiesObserver = null;
        }
    }

    /**
     * Start observing Properties View for timeline-color inputs
     */
    private startPropertiesColorSuggest(): void {
        this.propertiesObserver = new MutationObserver(() => {
            this.attachPropertyColorSuggests();
        });

        this.propertiesObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Initial scan
        this.attachPropertyColorSuggests();
    }

    /**
     * Attach PropertyColorSuggest to timeline-color property value inputs
     */
    private attachPropertyColorSuggests(): void {
        const colorKey = this.settings.frontmatterTaskKeys.color;
        const linestyleKey = this.settings.frontmatterTaskKeys.linestyle;

        // Find all property key inputs
        const keyInputs = document.querySelectorAll('.metadata-property-key-input');

        keyInputs.forEach((keyInput) => {
            const input = keyInput as HTMLInputElement;
            const isColorKey = input.value === colorKey;
            const isLineStyleKey = input.value === linestyleKey;
            if (!isColorKey && !isLineStyleKey) {
                return;
            }

            // Find the corresponding value contenteditable div
            const propertyContainer = input.closest('.metadata-property');
            if (!propertyContainer) {
                return;
            }

            // The value field is a contenteditable div, not an input
            const valueDiv = propertyContainer.querySelector('.metadata-input-longtext[contenteditable="true"]') as HTMLDivElement;
            if (!valueDiv || this.attachedInputs.has(valueDiv)) {
                return;
            }

            if (isColorKey) {
                new PropertyColorSuggest(this.app, valueDiv, this);
                this.addColorPickerIcon(propertyContainer as HTMLElement, valueDiv);
            } else {
                new PropertyLineStyleSuggest(this.app, valueDiv, this);
            }

            this.attachedInputs.add(valueDiv);
        });
    }

    /**
     * Add color picker icon next to the value field
     */
    private addColorPickerIcon(container: HTMLElement, valueDiv: HTMLDivElement): void {
        // Check if icon already exists
        if (container.querySelector('.task-viewer-color-picker-icon')) {
            return;
        }

        // Create icon button with relative positioning
        const iconBtn = container.createDiv({ cls: 'task-viewer-color-picker-icon clickable-icon' });
        iconBtn.setAttribute('aria-label', 'カラーピッカーを開く');
        iconBtn.style.position = 'relative';
        iconBtn.style.marginLeft = '4px';
        iconBtn.style.display = 'inline-flex';
        iconBtn.style.alignItems = 'center';
        iconBtn.style.cursor = 'pointer';
        setIcon(iconBtn, 'palette');

        // Create hidden color input inside icon button (so picker appears at icon position)
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.style.position = 'absolute';
        colorInput.style.top = '0';
        colorInput.style.left = '0';
        colorInput.style.width = '100%';
        colorInput.style.height = '100%';
        colorInput.style.opacity = '0';
        colorInput.style.cursor = 'pointer';
        iconBtn.appendChild(colorInput);

        // Insert after the value container
        const valueContainer = container.querySelector('.metadata-property-value');
        if (valueContainer) {
            valueContainer.after(iconBtn);
        }

        // Color input change handler
        colorInput.addEventListener('input', async () => {
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                return;
            }

            const colorKey = this.settings.frontmatterTaskKeys.color;
            // @ts-ignore - processFrontMatter
            await this.app.fileManager.processFrontMatter(activeFile, (frontmatter: any) => {
                frontmatter[colorKey] = colorInput.value;
            });

            // Sync UI
            valueDiv.textContent = colorInput.value;
        });

        // Set initial value when clicking
        iconBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentValue = valueDiv.textContent?.trim() || '';

            // Convert color name to hex if needed
            let hexValue = currentValue;
            if (currentValue && !currentValue.startsWith('#')) {
                const tempEl = document.createElement('div');
                tempEl.style.color = currentValue;
                document.body.appendChild(tempEl);
                const computedColor = getComputedStyle(tempEl).color;
                document.body.removeChild(tempEl);

                const rgbMatch = computedColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                if (rgbMatch) {
                    const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
                    const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
                    const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
                    hexValue = `#${r}${g}${b}`;
                }
            }

            colorInput.value = hexValue || '#000000';
        });
    }
}
