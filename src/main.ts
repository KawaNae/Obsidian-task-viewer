import { Plugin, WorkspaceLeaf } from 'obsidian';
import { TaskIndex } from './services/TaskIndex';
import { TimelineView, VIEW_TYPE_TIMELINE } from './views/timelineview';
import { KanbanView, VIEW_TYPE_KANBAN } from './views/KanbanView';
import { ScheduleView, VIEW_TYPE_SCHEDULE } from './views/ScheduleView';
import { TaskViewerSettings, DEFAULT_SETTINGS } from './types';
import { TaskViewerSettingTab } from './settings';
import { ColorSuggest } from './suggest/ColorSuggest';

export default class TaskViewerPlugin extends Plugin {
    private taskIndex: TaskIndex;
    public settings: TaskViewerSettings;

    async onload() {
        console.log('Loading Task Viewer Plugin (Rewrite)');

        // Load Settings
        await this.loadSettings();

        // Initialize Services
        this.taskIndex = new TaskIndex(this.app);
        await this.taskIndex.initialize();

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

        // Register Settings Tab
        this.addSettingTab(new TaskViewerSettingTab(this.app, this));

        // Register Editor Suggest
        this.registerEditorSuggest(new ColorSuggest(this.app, this));

        // Apply global styles if enabled
        this.updateGlobalStyles();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);

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
    }
}