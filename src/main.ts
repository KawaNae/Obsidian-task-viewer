import { Plugin, WorkspaceLeaf } from 'obsidian';
import { TaskIndex } from './services/TaskIndex';
import { TimelineView, VIEW_TYPE_TIMELINE } from './views/TimelineView';

export default class TaskViewerPlugin extends Plugin {
    private taskIndex: TaskIndex;

    async onload() {
        console.log('Loading Task Viewer Plugin (Rewrite)');

        // Initialize Services
        this.taskIndex = new TaskIndex(this.app);
        await this.taskIndex.initialize();

        // Register View
        this.registerView(
            VIEW_TYPE_TIMELINE,
            (leaf) => new TimelineView(leaf, this.taskIndex)
        );

        // Add Ribbon Icon
        this.addRibbonIcon('calendar-clock', 'Open Timeline', () => {
            this.activateView();
        });

        // Add Command
        this.addCommand({
            id: 'open-timeline-view',
            name: 'Open Timeline View',
            callback: () => {
                this.activateView();
            }
        });
    }

    async activateView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);

        if (leaves.length === 0) {
            leaf = workspace.getRightLeaf(false);
        } else {
            leaf = workspace.getLeaf(true);
        }

        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE_TIMELINE, active: true });
            workspace.revealLeaf(leaf);
        }
    }

    onunload() {
        console.log('Unloading Task Viewer Plugin');
    }
}