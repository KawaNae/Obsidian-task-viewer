import { ItemView, WorkspaceLeaf, Menu } from 'obsidian';
import { TaskIndex } from '../services/TaskIndex';
import { TaskRenderer } from './TaskRenderer';
import { Task, ViewState } from '../types';
import { DateUtils } from '../utils/DateUtils';
import TaskViewerPlugin from '../main';

export const VIEW_TYPE_KANBAN = 'kanban-view';

interface KanbanColumn {
    id: string;
    title: string;
    statusChar: string;
    status: 'todo' | 'done' | 'cancelled';
}

export class KanbanView extends ItemView {
    private taskIndex: TaskIndex;
    private plugin: TaskViewerPlugin;
    private taskRenderer: TaskRenderer;
    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private viewState: ViewState;
    private visibleFiles: Set<string> | null = null;

    private columns: KanbanColumn[] = [
        { id: 'todo', title: 'Todo', statusChar: ' ', status: 'todo' },
        { id: 'done', title: 'Done', statusChar: 'x', status: 'done' },
        { id: 'cancelled', title: 'Cancelled', statusChar: '-', status: 'cancelled' },
        { id: 'important', title: 'Important', statusChar: '!', status: 'todo' },
        { id: 'question', title: 'Question', statusChar: '?', status: 'todo' }
    ];

    constructor(leaf: WorkspaceLeaf, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        super(leaf);
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.taskRenderer = new TaskRenderer(this.app, this.taskIndex);
        this.viewState = {
            startDate: DateUtils.getVisualDateOfNow(this.plugin.settings.startHour),
            daysToShow: 3
        };
    }

    getViewType() {
        return VIEW_TYPE_KANBAN;
    }

    getDisplayText() {
        return 'Kanban View';
    }

    getIcon() {
        return 'kanban-square';
    }

    async onOpen() {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('kanban-view-container');

        this.render();

        // Subscribe to changes
        this.unsubscribe = this.taskIndex.onChange(() => {
            this.render();
        });
    }

    async onClose() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
    }

    private render() {
        this.container.empty();

        this.renderToolbar();

        const board = this.container.createDiv('kanban-board');

        this.columns.forEach(col => {
            const columnEl = board.createDiv('kanban-column');
            columnEl.dataset.statusChar = col.statusChar;

            // Header
            const header = columnEl.createDiv('kanban-column-header');
            header.setText(col.title);

            // Task List Container
            const taskList = columnEl.createDiv('kanban-task-list');

            // Filter tasks for this column
            const tasks = this.getTasksForColumn(col);

            tasks.forEach(task => {
                const cardContainer = taskList.createDiv('kanban-task-card-wrapper');
                // Make draggable
                cardContainer.draggable = true;
                cardContainer.dataset.taskId = task.id;

                const card = cardContainer.createDiv('task-card');
                // Apply color if available
                this.applyTaskColor(card, task.file);

                this.taskRenderer.render(card, task, this, this.plugin.settings);

                // Drag Events
                cardContainer.addEventListener('dragstart', (e) => {
                    e.dataTransfer?.setData('text/plain', task.id);
                    e.dataTransfer?.setDragImage(card, 0, 0);
                    cardContainer.addClass('dragging');
                });

                cardContainer.addEventListener('dragend', () => {
                    cardContainer.removeClass('dragging');
                });
            });

            // Drop Zone Events
            taskList.addEventListener('dragover', (e) => {
                e.preventDefault(); // Allow drop
                taskList.addClass('drag-over');
            });

            taskList.addEventListener('dragleave', () => {
                taskList.removeClass('drag-over');
            });

            taskList.addEventListener('drop', async (e) => {
                e.preventDefault();
                taskList.removeClass('drag-over');
                const taskId = e.dataTransfer?.getData('text/plain');
                if (taskId) {
                    await this.handleDrop(taskId, col);
                }
            });
        });
    }

    private renderToolbar() {
        const toolbar = this.container.createDiv('task-viewer-toolbar');

        // Date Navigation
        const prevBtn = toolbar.createEl('button', { text: '<' });
        prevBtn.onclick = () => this.navigateDate(-1);

        const nextBtn = toolbar.createEl('button', { text: '>' });
        nextBtn.onclick = () => this.navigateDate(1);

        const todayBtn = toolbar.createEl('button', { text: 'Today' });
        todayBtn.onclick = () => {
            this.viewState.startDate = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
            this.render();
        };

        // Date Range Display
        const dateDisplay = toolbar.createEl('span', { cls: 'kanban-date-display' });
        dateDisplay.style.fontWeight = 'bold';
        dateDisplay.style.marginLeft = '10px';
        dateDisplay.style.marginRight = '10px';
        dateDisplay.setText(this.getDateRangeString());

        // View Mode Switch
        const modeSelect = toolbar.createEl('select');
        modeSelect.createEl('option', { value: '1', text: '1 Day' });
        modeSelect.createEl('option', { value: '3', text: '3 Days' });
        modeSelect.createEl('option', { value: '7', text: 'Week' });
        modeSelect.value = this.viewState.daysToShow.toString();
        modeSelect.onchange = (e) => {
            const newValue = parseInt((e.target as HTMLSelectElement).value);
            this.viewState.daysToShow = newValue;
            this.render();
        };

        // Filter Button
        const filterBtn = toolbar.createEl('button', { text: 'Filter' });
        filterBtn.onclick = (e) => {
            const menu = new Menu();

            // Get all tasks in current view range to determine available files
            const dates = this.getDatesToShow();
            const allTasksInView = dates.flatMap(date => this.taskIndex.getTasksForVisualDay(date, this.plugin.settings.startHour));
            const distinctFiles = Array.from(new Set(allTasksInView.map(t => t.file))).sort();

            distinctFiles.forEach(file => {
                const isVisible = this.visibleFiles === null || this.visibleFiles.has(file);
                const color = this.getFileColor(file);
                menu.addItem(item => {
                    item.setTitle(file)
                        .setChecked(isVisible)
                        .onClick(() => {
                            if (this.visibleFiles === null) {
                                // Initialize with all currently visible files
                                this.visibleFiles = new Set(distinctFiles);
                            }

                            if (isVisible) {
                                this.visibleFiles.delete(file);
                            } else {
                                this.visibleFiles.add(file);
                            }

                            // If all checked, set to null
                            if (this.visibleFiles.size === distinctFiles.length) {
                                this.visibleFiles = null;
                            }

                            this.render();
                        });

                    // Always set icon to align text
                    item.setIcon('circle');
                    const iconEl = (item as any).dom.querySelector('.menu-item-icon');

                    if (iconEl) {
                        if (color) {
                            iconEl.style.color = color;
                            iconEl.style.fill = color;
                        } else {
                            // Hide icon but keep space
                            iconEl.style.visibility = 'hidden';
                        }
                    }
                });
            });

            menu.showAtPosition({ x: e.pageX, y: e.pageY });
        };
    }

    private getDateRangeString(): string {
        const start = this.viewState.startDate;
        if (this.viewState.daysToShow === 1) {
            return start;
        }

        const endDate = new Date(start);
        endDate.setDate(endDate.getDate() + this.viewState.daysToShow - 1);
        const end = endDate.toISOString().split('T')[0];

        return `${start} ~ ${end}`;
    }

    private navigateDate(days: number) {
        const date = new Date(this.viewState.startDate);
        date.setDate(date.getDate() + days);
        this.viewState.startDate = date.toISOString().split('T')[0];
        this.render();
    }

    private getDatesToShow(): string[] {
        const dates = [];
        const start = new Date(this.viewState.startDate);
        for (let i = 0; i < this.viewState.daysToShow; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            dates.push(d.toISOString().split('T')[0]);
        }
        return dates;
    }

    private getTasksForColumn(col: KanbanColumn): Task[] {
        const dates = this.getDatesToShow();
        const startHour = this.plugin.settings.startHour;

        // Get tasks for all days in range
        let tasks = dates.flatMap(date => this.taskIndex.getTasksForVisualDay(date, startHour));

        // Filter by File
        if (this.visibleFiles) {
            tasks = tasks.filter(t => this.visibleFiles!.has(t.file));
        }

        // Filter by Column Status
        return tasks.filter(task => {
            // Check status char match
            const taskChar = task.statusChar || (task.status === 'done' ? 'x' : (task.status === 'cancelled' ? '-' : ' '));
            return taskChar === col.statusChar;
        });
    }

    private async handleDrop(taskId: string, targetCol: KanbanColumn) {
        const task = this.taskIndex.getTask(taskId);
        if (!task) return;

        // Don't update if already in same column (same status char)
        const currentChar = task.statusChar || (task.status === 'done' ? 'x' : (task.status === 'cancelled' ? '-' : ' '));
        if (currentChar === targetCol.statusChar) return;

        // Update task
        await this.taskIndex.updateTask(taskId, {
            status: targetCol.status,
            statusChar: targetCol.statusChar
        });
    }

    private getFileColor(filePath: string): string | null {
        const key = this.plugin.settings.frontmatterColorKey;
        if (!key) return null;

        const cache = this.app.metadataCache.getCache(filePath);
        return cache?.frontmatter?.[key] || null;
    }

    private applyTaskColor(el: HTMLElement, filePath: string) {
        const color = this.getFileColor(filePath);

        if (color) {
            el.style.setProperty('border-left', `4px solid ${color}`, 'important');
            el.style.setProperty('--file-accent', color);
        }
    }
}
