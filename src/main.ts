import { Plugin, WorkspaceLeaf } from 'obsidian';
import { TaskIndex } from './services/TaskIndex';
import { TimelineView, VIEW_TYPE_TIMELINE } from './views/timelineview';
import { KanbanView, VIEW_TYPE_KANBAN } from './views/KanbanView';
import { ScheduleView, VIEW_TYPE_SCHEDULE } from './views/ScheduleView';
import { PomodoroView, VIEW_TYPE_POMODORO } from './views/PomodoroView';
import { PomodoroService } from './services/PomodoroService';
import { TimerWidget } from './widgets/TimerWidget';
import { TaskViewerSettings, DEFAULT_SETTINGS } from './types';
import { TaskViewerSettingTab } from './settings';
import { ColorSuggest } from './suggest/ColorSuggest';
import { DateUtils } from './utils/DateUtils';

export default class TaskViewerPlugin extends Plugin {
    private taskIndex: TaskIndex;
    private pomodoroService: PomodoroService;
    private timerWidget: TimerWidget;
    public settings: TaskViewerSettings;

    // Day boundary check
    private lastVisualDate: string = '';
    private dateCheckInterval: ReturnType<typeof setInterval> | null = null;

    async onload() {
        console.log('Loading Task Viewer Plugin (Rewrite)');

        // Load Settings
        await this.loadSettings();

        // Initialize Services
        this.taskIndex = new TaskIndex(this.app);
        await this.taskIndex.initialize();

        this.pomodoroService = new PomodoroService({
            workMinutes: this.settings.pomodoroWorkMinutes,
            breakMinutes: this.settings.pomodoroBreakMinutes,
        });

        // Initialize Timer Widget
        this.timerWidget = new TimerWidget(this.app, this);

        // Register View
        this.registerView(
            VIEW_TYPE_TIMELINE,
            (leaf) => new TimelineView(leaf, this.taskIndex, this)
        );

        this.registerView(
            VIEW_TYPE_KANBAN,
            (leaf) => new KanbanView(leaf, this.taskIndex, this)
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

        this.addRibbonIcon('kanban-square', 'Open Kanban', () => {
            this.activateView(VIEW_TYPE_KANBAN);
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
            id: 'open-kanban-view',
            name: 'Open Kanban View',
            callback: () => {
                this.activateView(VIEW_TYPE_KANBAN);
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
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);

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
        [VIEW_TYPE_TIMELINE, VIEW_TYPE_KANBAN, VIEW_TYPE_SCHEDULE].forEach(viewType => {
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
    }
}