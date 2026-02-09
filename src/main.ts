import { Plugin, WorkspaceLeaf, setIcon, TFile } from 'obsidian';
import { TaskIndex } from './services/core/TaskIndex';
import { TimelineView, VIEW_TYPE_TIMELINE } from './views/timelineview';
import { ScheduleView, VIEW_TYPE_SCHEDULE } from './views/ScheduleView';
import { PomodoroView, VIEW_TYPE_POMODORO } from './views/PomodoroView';
import { PomodoroService } from './services/execution/PomodoroService';
import { TimerWidget } from './widgets/TimerWidget';
import { TaskViewerSettings, DEFAULT_SETTINGS } from './types';
import { TaskViewerSettingTab } from './settings';
import { ColorSuggest } from './suggest/ColorSuggest';
import { PropertyColorSuggest } from './suggest/PropertyColorSuggest';
import { DateUtils } from './utils/DateUtils';

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
        this.taskIndex = new TaskIndex(this.app, this.settings);
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

        // Add Ribbon Icon
        this.addRibbonIcon('calendar-clock', 'Open Timeline', () => {
            this.activateView(VIEW_TYPE_TIMELINE);
        });

        this.addRibbonIcon('calendar-days', 'Open Schedule', () => {
            this.activateView(VIEW_TYPE_SCHEDULE);
        });

        this.addRibbonIcon('clock', 'Open Pomodoro Timer', () => {
            this.activateView(VIEW_TYPE_POMODORO);
        });

        // Add Command
        this.addCommand({
            id: 'open-timeline-view',
            name: 'Open Timeline View',
            callback: () => {
                this.activateView(VIEW_TYPE_TIMELINE);
            }
        });

        this.addCommand({
            id: 'open-schedule-view',
            name: 'Open Schedule View',
            callback: () => {
                this.activateView(VIEW_TYPE_SCHEDULE);
            }
        });

        this.addCommand({
            id: 'open-pomodoro-view',
            name: 'Open Pomodoro Timer',
            callback: () => {
                this.activateView(VIEW_TYPE_POMODORO);
            }
        });

        // Register Settings Tab
        this.addSettingTab(new TaskViewerSettingTab(this.app, this));

        // Register Editor Suggest
        this.registerEditorSuggest(new ColorSuggest(this.app, this));

        // Apply global styles if enabled
        this.updateGlobalStyles();

        // Start day boundary check (every 5 minutes)
        this.startDateBoundaryCheck();

        // Start Properties View color suggest observer
        this.startPropertiesColorSuggest();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.taskIndex.updateSettings(this.settings);

        // Update pomodoro service settings
        this.pomodoroService?.updateSettings({
            workMinutes: this.settings.pomodoroWorkMinutes,
            breakMinutes: this.settings.pomodoroBreakMinutes,
        });

        // Refresh all Timeline Views
        this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE).forEach(leaf => {
            if (leaf.view instanceof TimelineView) {
                leaf.view.refresh();
            }
        });
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
    private refreshAllViews(): void {
        [VIEW_TYPE_TIMELINE, VIEW_TYPE_SCHEDULE].forEach(viewType => {
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
        const colorKey = this.settings.frontmatterColorKey;

        // Find all property key inputs
        const keyInputs = document.querySelectorAll('.metadata-property-key-input');

        keyInputs.forEach((keyInput) => {
            const input = keyInput as HTMLInputElement;
            if (input.value === colorKey) {
                // Find the corresponding value contenteditable div
                const propertyContainer = input.closest('.metadata-property');
                if (propertyContainer) {
                    // The value field is a contenteditable div, not an input
                    const valueDiv = propertyContainer.querySelector('.metadata-input-longtext[contenteditable="true"]') as HTMLDivElement;
                    if (valueDiv && !this.attachedInputs.has(valueDiv)) {
                        // Attach text suggest
                        new PropertyColorSuggest(this.app, valueDiv, this);
                        this.attachedInputs.add(valueDiv);

                        // Add color picker icon
                        this.addColorPickerIcon(propertyContainer as HTMLElement, valueDiv);
                    }
                }
            }
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

            const colorKey = this.settings.frontmatterColorKey;
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
