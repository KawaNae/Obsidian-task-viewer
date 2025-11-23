import { ItemView, WorkspaceLeaf, MarkdownRenderer } from 'obsidian';
import { TaskIndex } from '../services/TaskIndex';
import { Task, ViewState } from '../types';
import { DragHandler } from '../interaction/DragHandler';

export const VIEW_TYPE_TIMELINE = 'timeline-view';

export class TimelineView extends ItemView {
    private taskIndex: TaskIndex;
    private container: HTMLElement;
    private viewState: ViewState;
    private dragHandler: DragHandler;
    private selectedTaskId: string | null = null;
    private handleOverlay: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, taskIndex: TaskIndex) {
        super(leaf);
        this.taskIndex = taskIndex;
        this.viewState = {
            startDate: new Date().toISOString().split('T')[0],
            daysToShow: 3
        };
    }

    getViewType() {
        return VIEW_TYPE_TIMELINE;
    }

    getDisplayText() {
        return 'Timeline View';
    }

    getIcon() {
        return 'calendar-with-checkmark';
    }

    async onOpen() {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('task-viewer-container');

        // Initialize DragHandler with selection callback and move callback
        this.dragHandler = new DragHandler(this.container, this.taskIndex,
            (taskId) => {
                this.selectedTaskId = taskId;
                this.render();
            },
            () => {
                this.updateHandlePositions();
            }
        );

        // Background click to deselect
        this.container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            // If clicking handle, do nothing (handled by DragHandler or button click)
            if (target.closest('.handle-btn')) return;

            if (!target.closest('.task-card')) {
                if (this.selectedTaskId) {
                    this.selectedTaskId = null;
                    this.render();
                }
            }
        });

        // Subscribe to data changes
        this.taskIndex.onChange(() => {
            this.render();
        });

        // Window resize listener
        this.registerDomEvent(window, 'resize', () => {
            this.updateHandlePositions();
        });

        // Initial render
        this.render();
    }

    render() {
        this.container.empty();

        this.renderToolbar();
        this.renderGrid();
        this.renderHandleOverlay();

        if (this.selectedTaskId) {
            this.renderHandles(this.selectedTaskId);
        }
    }

    private renderHandleOverlay() {
        this.handleOverlay = this.container.createDiv('handle-overlay');
        this.handleOverlay.style.position = 'absolute';
        this.handleOverlay.style.top = '0';
        this.handleOverlay.style.left = '0';
        this.handleOverlay.style.width = '100%';
        this.handleOverlay.style.height = '100%';
        this.handleOverlay.style.pointerEvents = 'none';
        this.handleOverlay.style.zIndex = '1000'; // Always on top
        this.handleOverlay.style.overflow = 'hidden';
    }

    private updateHandlePositions() {
        if (this.selectedTaskId && this.handleOverlay) {
            this.updateHandleGeometry(this.selectedTaskId);
        }
    }

    private renderHandles(taskId: string) {
        if (!this.handleOverlay) return;

        const taskEl = this.container.querySelector(`.task-card[data-id="${taskId}"]`) as HTMLElement;
        if (!taskEl) return;

        const isAllDay = taskEl.classList.contains('all-day');

        // If handles for this task already exist, check if type matches
        const existingWrapper = this.handleOverlay.querySelector(`.handle-wrapper[data-task-id="${taskId}"]`) as HTMLElement;
        if (existingWrapper) {
            const wrapperIsAllDay = existingWrapper.dataset.isAllDay === 'true';
            if (wrapperIsAllDay === isAllDay) {
                this.updateHandleGeometry(taskId);
                return;
            }
            // Type changed, remove and re-create
            existingWrapper.remove();
        }

        this.handleOverlay.empty(); // Clear other handles (only 1 selected at a time)

        // Create wrapper
        const wrapper = this.handleOverlay.createDiv('handle-wrapper');
        wrapper.dataset.taskId = taskId;
        wrapper.dataset.isAllDay = isAllDay.toString();
        wrapper.style.position = 'absolute';
        wrapper.style.pointerEvents = 'none';

        // --- Handles ---
        if (isAllDay) {
            // Move Handle (Right Edge)
            const moveContainer = wrapper.createDiv('handle-container move-handle-container');
            moveContainer.style.pointerEvents = 'auto';

            const moveHandle = moveContainer.createDiv('handle-btn move-handle');
            moveHandle.setText('::');
            moveHandle.dataset.taskId = taskId;
        } else {
            // Top Resize Handle (Top Center)
            const topContainer = wrapper.createDiv('handle-container top-resize-container');
            topContainer.style.pointerEvents = 'auto';

            const resizeTop = topContainer.createDiv('handle-btn resize-handle top-resize-handle');
            resizeTop.setText('↕');
            resizeTop.dataset.taskId = taskId;

            // Bottom Resize Handle (Bottom Center)
            const bottomContainer = wrapper.createDiv('handle-container bottom-resize-container');
            bottomContainer.style.pointerEvents = 'auto';

            const resizeBottom = bottomContainer.createDiv('handle-btn resize-handle bottom-resize-handle');
            resizeBottom.setText('↕');
            resizeBottom.dataset.taskId = taskId;

            // Move Handle (Right Edge)
            const moveContainer = wrapper.createDiv('handle-container move-handle-container');
            moveContainer.style.pointerEvents = 'auto';

            const moveHandle = moveContainer.createDiv('handle-btn move-handle');
            moveHandle.setText('::');
            moveHandle.dataset.taskId = taskId;
        }

        // Initial positioning
        this.updateHandleGeometry(taskId);
    }

    private updateHandleGeometry(taskId: string) {
        if (!this.handleOverlay) return;

        const wrapper = this.handleOverlay.querySelector(`.handle-wrapper[data-task-id="${taskId}"]`) as HTMLElement;
        const taskEl = this.container.querySelector(`.task-card[data-id="${taskId}"]`) as HTMLElement;

        if (!wrapper || !taskEl) return;

        const containerRect = this.container.getBoundingClientRect();
        const taskRect = taskEl.getBoundingClientRect();

        // Calculate position relative to container
        const top = taskRect.top - containerRect.top;
        const left = taskRect.left - containerRect.left;
        const width = taskRect.width;
        const height = taskRect.height;

        wrapper.style.top = `${top}px`;
        wrapper.style.left = `${left}px`;
        wrapper.style.width = `${width}px`;
        wrapper.style.height = `${height}px`;
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
            this.viewState.startDate = new Date().toISOString().split('T')[0];
            this.render();
        };

        // View Mode Switch
        const modeSelect = toolbar.createEl('select');
        modeSelect.createEl('option', { value: '1', text: '1 Day' });
        modeSelect.createEl('option', { value: '3', text: '3 Days' });
        modeSelect.createEl('option', { value: '7', text: 'Week' });
        modeSelect.value = this.viewState.daysToShow.toString();
        modeSelect.onchange = (e) => {
            this.viewState.daysToShow = parseInt((e.target as HTMLSelectElement).value);
            this.render();
        };

        // Debug Info

    }

    private navigateDate(days: number) {
        const date = new Date(this.viewState.startDate);
        date.setDate(date.getDate() + days);
        this.viewState.startDate = date.toISOString().split('T')[0];
        this.render();
    }

    private renderGrid() {
        const grid = this.container.createDiv('timeline-grid');
        const dates = this.getDatesToShow();
        const colTemplate = `30px repeat(${this.viewState.daysToShow}, minmax(0, 1fr))`;

        // 1. Header Row
        const headerRow = grid.createDiv('timeline-row header-row');
        headerRow.style.gridTemplateColumns = colTemplate;

        // Time Axis Header
        headerRow.createDiv('header-cell').setText(' ');
        // Day Headers
        dates.forEach(date => {
            const cell = headerRow.createDiv('header-cell');
            const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
            cell.setText(`${date} (${dayName})`);
            cell.dataset.date = date;
        });

        // 2. All-Day Row
        const allDayRow = grid.createDiv('timeline-row all-day-row');
        allDayRow.style.gridTemplateColumns = colTemplate;

        // Time Axis All-Day
        allDayRow.createDiv('all-day-cell').setText(' ');
        // Day All-Day Cells
        dates.forEach(date => {
            const cell = allDayRow.createDiv('all-day-cell');
            cell.dataset.date = date;
            this.renderAllDayTasks(cell, date);
        });

        // 3. Timeline Row (Scrollable)
        const scrollArea = grid.createDiv('timeline-row timeline-scroll-area');
        scrollArea.style.gridTemplateColumns = colTemplate;

        // Add scroll listener to update handles
        scrollArea.addEventListener('scroll', () => {
            this.updateHandlePositions();
        });

        // Time Axis Column
        const timeCol = scrollArea.createDiv('time-axis-column');
        this.renderTimeLabels(timeCol);

        // Day Columns
        dates.forEach(date => {
            const col = scrollArea.createDiv('day-timeline-column');
            col.dataset.date = date;
            this.renderTimedTasks(col, date);
        });
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

    private renderTimeLabels(container: HTMLElement) {
        for (let i = 0; i < 24; i++) {
            const label = container.createDiv('time-label');
            label.style.top = `${i * 60}px`;
            label.setText(`${i}`);
        }
    }

    private renderAllDayTasks(container: HTMLElement, date: string) {
        const tasks = this.taskIndex.getTasksForDate(date).filter(t => !t.startTime);
        tasks.forEach(task => {
            const el = container.createDiv('task-card all-day');
            if (task.id === this.selectedTaskId) el.addClass('selected');
            el.dataset.id = task.id;

            this.renderTaskContent(el, task);
        });
    }

    private renderTimedTasks(container: HTMLElement, date: string) {
        const tasks = this.taskIndex.getTasksForDate(date).filter(t => t.startTime);

        // Calculate layout for overlapping tasks
        const layout = this.calculateTaskLayout(tasks);

        tasks.forEach(task => {
            if (!task.startTime) return;

            const el = container.createDiv('task-card timed');
            if (task.id === this.selectedTaskId) el.addClass('selected');
            el.dataset.id = task.id;

            // Calculate position
            const startMinutes = this.timeToMinutes(task.startTime);
            const endMinutes = task.endTime ? this.timeToMinutes(task.endTime) : startMinutes + 60;
            const duration = endMinutes - startMinutes;

            // Apply layout
            const taskLayout = layout.get(task.id) || { width: 100, left: 0 };
            const widthFraction = taskLayout.width / 100;
            const leftFraction = taskLayout.left / 100;

            el.style.top = `${startMinutes}px`;
            el.style.height = `${duration}px`;
            el.style.width = `calc((100% - 8px) * ${widthFraction})`;
            el.style.left = `calc(4px + (100% - 8px) * ${leftFraction})`;
            el.style.setProperty('--initial-height', `${duration}px`);

            this.renderTaskContent(el, task);
        });
    }

    private calculateTaskLayout(tasks: Task[]): Map<string, { width: number, left: number }> {
        const layout = new Map<string, { width: number, left: number }>();
        if (tasks.length === 0) return layout;

        // Sort tasks by start time, then by duration (longer first)
        const sortedTasks = [...tasks].sort((a, b) => {
            const startA = this.timeToMinutes(a.startTime!);
            const startB = this.timeToMinutes(b.startTime!);
            if (startA !== startB) return startA - startB;

            const durA = (a.endTime ? this.timeToMinutes(a.endTime) : startA + 60) - startA;
            const durB = (b.endTime ? this.timeToMinutes(b.endTime) : startB + 60) - startB;
            return durB - durA;
        });

        // Simple column packing algorithm
        const columns: Task[][] = [];

        for (const task of sortedTasks) {
            const start = this.timeToMinutes(task.startTime!);
            const end = task.endTime ? this.timeToMinutes(task.endTime) : start + 60;

            let placed = false;
            for (let i = 0; i < columns.length; i++) {
                const column = columns[i];
                // Check if task overlaps with any task in this column
                const overlaps = column.some(t => {
                    const tStart = this.timeToMinutes(t.startTime!);
                    const tEnd = t.endTime ? this.timeToMinutes(t.endTime) : tStart + 60;
                    return start < tEnd && end > tStart;
                });

                if (!overlaps) {
                    column.push(task);
                    placed = true;
                    break;
                }
            }

            if (!placed) {
                columns.push([task]);
            }
        }

        // Assign width and left position
        // Use full width (100%) divided by columns. Padding is handled in renderTimedTasks.
        const totalColumns = columns.length;
        const width = 100 / totalColumns;

        columns.forEach((column, colIndex) => {
            column.forEach(task => {
                layout.set(task.id, {
                    width: width,
                    left: colIndex * width
                });
            });
        });

        return layout;
    }

    private async renderTaskContent(el: HTMLElement, task: Task) {
        const contentContainer = el.createDiv('task-content-container');

        // Construct full markdown
        // Strip time info from parent task line for display
        const statusChar = task.status === 'done' ? 'x' : (task.status === 'cancelled' ? '-' : ' ');
        const cleanParentLine = `- [${statusChar}] ${task.content}`;

        const fullText = [cleanParentLine, ...task.children].join('\n');

        // Use MarkdownRenderer
        await MarkdownRenderer.render(this.app, fullText, contentContainer, task.file, this);

        // Handle Checkbox Clicks
        const checkboxes = contentContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach((checkbox, index) => {
            checkbox.addEventListener('click', (e) => {
                // If it's the main task (index 0)
                if (index === 0) {
                    const newStatus = (checkbox as HTMLInputElement).checked ? 'done' : 'todo';
                    this.taskIndex.updateTask(task.id, { status: newStatus });
                } else {
                    // For children
                    const childLineIndex = index - 1; // 0-based index into children array
                    if (childLineIndex < task.children.length) {
                        let childLine = task.children[childLineIndex];
                        // Regex to find [ ] or [x]
                        if (childLine.match(/\[ \]/)) {
                            childLine = childLine.replace('[ ]', '[x]');
                        } else if (childLine.match(/\[x\]/i)) {
                            childLine = childLine.replace(/\[x\]/i, '[ ]');
                        } else if (childLine.match(/\[-\]/)) {
                            childLine = childLine.replace(/\[-\]/, '[ ]');
                        }

                        // Calculate absolute line number
                        const absoluteLineNumber = task.line + 1 + childLineIndex;

                        this.taskIndex.updateLine(task.file, absoluteLineNumber, childLine);
                    }
                }
            });

            // Stop propagation so clicking checkbox doesn't drag/select card
            checkbox.addEventListener('pointerdown', (e) => e.stopPropagation());
        });
    }

    private timeToMinutes(time: string): number {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    }
}
