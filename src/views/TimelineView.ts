import { ItemView, WorkspaceLeaf, Menu } from 'obsidian';
import { TaskRenderer } from './TaskRenderer';
import { TaskIndex } from '../services/TaskIndex';
import { Task, ViewState } from '../types';
import { DragHandler } from '../interaction/DragHandler';
import { MenuHandler } from '../interaction/MenuHandler';
import { TaskLayout } from '../services/TaskLayout';
import { DateUtils } from '../utils/DateUtils';
import { ColorUtils } from '../utils/ColorUtils';
import TaskViewerPlugin from '../main';

export const VIEW_TYPE_TIMELINE = 'timeline-view';

export class TimelineView extends ItemView {
    private taskIndex: TaskIndex;
    private container: HTMLElement;
    private viewState: ViewState;
    private dragHandler: DragHandler;
    private menuHandler: MenuHandler;
    private selectedTaskId: string | null = null;
    private handleOverlay: HTMLElement | null = null;
    private unsubscribe: (() => void) | null = null;
    private plugin: TaskViewerPlugin;
    private taskRenderer: TaskRenderer;

    private currentTimeInterval: number | null = null;
    private lastScrollTop: number = 0;

    constructor(leaf: WorkspaceLeaf, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        super(leaf);
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.viewState = {
            startDate: DateUtils.getVisualDateOfNow(this.plugin.settings.startHour),
            daysToShow: 3
        };
        this.taskRenderer = new TaskRenderer(this.app, this.taskIndex);
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

    async setState(state: any, result: any): Promise<void> {
        if (state) {
            if (state.daysToShow) {
                this.viewState.daysToShow = state.daysToShow;
            }
            if (state.startDate) {
                this.viewState.startDate = state.startDate;
            }
        }
        await super.setState(state, result);
        this.render();
    }

    getState() {
        const state = {
            daysToShow: this.viewState.daysToShow,
            startDate: this.viewState.startDate
        };
        return state;
    }

    async onOpen() {

        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('task-viewer-container');

        // Initialize MenuHandler
        this.menuHandler = new MenuHandler(this.app, this.taskIndex, this.plugin);

        // Initialize DragHandler with selection callback and move callback
        this.dragHandler = new DragHandler(this.container, this.taskIndex, this.plugin,
            (taskId) => {
                this.selectTask(taskId);
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
                    this.selectTask(null);
                }
            }
        });

        // Subscribe to data changes
        this.unsubscribe = this.taskIndex.onChange((taskId, changes) => {
            if (taskId && changes) {
                // Check if we can do partial update
                // Only content/status changes are safe for partial update (no layout change)
                const safeKeys = ['status', 'statusChar', 'content', 'children'];
                const isSafe = changes.every(k => safeKeys.includes(k));

                if (isSafe) {
                    const task = this.taskIndex.getTask(taskId);
                    if (task) {
                        const card = this.container.querySelector(`.task-card[data-id="${taskId}"]`) as HTMLElement;
                        if (card) {
                            // Partial Update: Re-render content only
                            const contentContainer = card.querySelector('.task-content-container');
                            if (contentContainer) contentContainer.remove();

                            this.renderTaskContent(card, task);
                            return;
                        }
                    }
                }
            }

            this.render();
        });

        // Window resize listener
        // Use the window of the container (handles popout windows)
        const win = this.container.ownerDocument.defaultView || window;
        this.registerDomEvent(win, 'resize', () => {
            this.updateHandlePositions();
        });

        // Start Current Time Interval
        this.currentTimeInterval = window.setInterval(() => {
            this.renderCurrentTimeIndicator();
        }, 60000); // Every minute

        // Initial render
        this.render();
    }

    async onClose() {
        this.dragHandler.destroy();
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        if (this.currentTimeInterval) {
            window.clearInterval(this.currentTimeInterval);
            this.currentTimeInterval = null;
        }
    }

    public refresh() {
        this.render();
    }

    private renderCurrentTimeIndicator() {
        // Remove existing indicators
        const existingIndicators = this.container.querySelectorAll('.current-time-indicator');
        existingIndicators.forEach(el => el.remove());

        const now = new Date();
        const startHour = this.plugin.settings.startHour;

        // Calculate current time in minutes from midnight
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        // Calculate minutes relative to the visual day start
        let minutesFromStart = currentMinutes - (startHour * 60);
        if (minutesFromStart < 0) {
            minutesFromStart += 24 * 60;
        }

        // Use local date string to match the column data-date (which assumes local dates)
        const visualDateString = DateUtils.getVisualDateOfNow(startHour);

        // Find the column for this visual date
        const dayCol = this.container.querySelector(`.day-timeline-column[data-date="${visualDateString}"]`) as HTMLElement;

        if (dayCol) {
            const indicator = dayCol.createDiv({ cls: 'current-time-indicator' });
            indicator.style.top = `${minutesFromStart}px`;
        }
    }

    private render() {

        const scrollArea = this.container.querySelector('.timeline-scroll-area');
        if (scrollArea) {
            this.lastScrollTop = scrollArea.scrollTop;
        }

        this.container.empty();

        this.renderToolbar();
        this.renderGrid();
        this.renderHandleOverlay();
        this.renderCurrentTimeIndicator();

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

    private selectTask(taskId: string | null) {

        this.selectedTaskId = taskId;

        // Update .selected class on all task cards
        const taskCards = this.container.querySelectorAll('.task-card');
        taskCards.forEach(el => {
            if ((el as HTMLElement).dataset.id === taskId) {
                el.addClass('selected');
            } else {
                el.removeClass('selected');
            }
        });

        // Update Handles
        if (taskId) {
            this.renderHandles(taskId);
        } else {
            if (this.handleOverlay) {
                this.handleOverlay.empty();
            }
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

    private visibleFiles: Set<string> | null = null; // null means all visible

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
            // Force save state
            this.app.workspace.requestSaveLayout();
        };

        // Filter Button
        const filterBtn = toolbar.createEl('button', { text: 'Filter' });
        filterBtn.onclick = (e) => {
            const menu = new Menu();

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

        // Restore scroll position (must be done AFTER content is added)
        if (this.lastScrollTop > 0) {
            scrollArea.scrollTop = this.lastScrollTop;
        }
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
        const startHour = this.plugin.settings.startHour;
        for (let i = 0; i < 24; i++) {
            const label = container.createDiv('time-label');
            label.style.top = `${i * 60}px`;

            // Display hour adjusted by startHour
            let displayHour = startHour + i;
            if (displayHour >= 24) displayHour -= 24;

            label.setText(`${displayHour}`);
        }
    }

    private renderAllDayTasks(container: HTMLElement, date: string) {
        // All-day tasks are still just based on the date, they don't have time
        let tasks = this.taskIndex.getTasksForDate(date).filter(t => !t.startTime);

        // Filter
        if (this.visibleFiles) {
            tasks = tasks.filter(t => this.visibleFiles!.has(t.file));
        }

        tasks.forEach(task => {
            const el = container.createDiv('task-card all-day');
            if (task.id === this.selectedTaskId) el.addClass('selected');
            el.dataset.id = task.id;

            // Apply Color
            this.applyTaskColor(el, task.file);

            this.renderTaskContent(el, task);
            this.menuHandler.addTaskContextMenu(el, task);
        });
    }

    private renderTimedTasks(container: HTMLElement, date: string) {
        const startHour = this.plugin.settings.startHour;
        // Use getTasksForVisualDay
        let tasks = this.taskIndex.getTasksForVisualDay(date, startHour).filter(t => t.startTime);

        // Filter
        if (this.visibleFiles) {
            tasks = tasks.filter(t => this.visibleFiles!.has(t.file));
        }

        // Calculate layout for overlapping tasks
        const layout = TaskLayout.calculateTaskLayout(tasks, date, startHour);

        tasks.forEach(task => {
            if (!task.startTime) return;

            const el = container.createDiv('task-card timed');
            if (task.id === this.selectedTaskId) el.addClass('selected');
            el.dataset.id = task.id;

            // Apply Color
            this.applyTaskColor(el, task.file);

            // Calculate position
            let startMinutes = DateUtils.timeToMinutes(task.startTime);
            let endMinutes: number;

            if (task.endTime) {
                if (task.endTime.includes('T')) {
                    // Full ISO: Calculate minutes relative to task.date's 00:00
                    // But wait, we need minutes relative to visual day start for rendering?
                    // No, render logic below uses (startMinutes - startHourMinutes).
                    // startMinutes is relative to 00:00 of the task's date (which is 'date' here).

                    // If endTime is next day, we need total minutes from start of 'date'.
                    const startDate = new Date(`${date}T00:00:00`);
                    const endDate = new Date(task.endTime);
                    const diffMs = endDate.getTime() - startDate.getTime();
                    endMinutes = Math.floor(diffMs / 60000);
                } else {
                    endMinutes = DateUtils.timeToMinutes(task.endTime);
                    // Handle wrap around midnight if needed (simple case)
                    if (endMinutes < startMinutes) {
                        endMinutes += 24 * 60;
                    }
                }
            } else {
                endMinutes = startMinutes + 60;
            }

            // Adjust for startHour
            const startHourMinutes = startHour * 60;

            // If task is from next day (e.g. 02:00), add 24h
            if (startMinutes < startHourMinutes) {
                startMinutes += 24 * 60;
                endMinutes += 24 * 60;
            }

            // Calculate relative to visual start
            const relativeStart = startMinutes - startHourMinutes;
            const duration = endMinutes - startMinutes;

            // Apply layout
            const taskLayout = layout.get(task.id) || { width: 100, left: 0 };
            const widthFraction = taskLayout.width / 100;
            const leftFraction = taskLayout.left / 100;

            el.style.top = `${relativeStart + 1}px`;
            el.style.height = `${duration - 3}px`;
            el.style.width = `calc((100% - 8px) * ${widthFraction} - 2px)`;
            el.style.left = `calc(4px + (100% - 8px) * ${leftFraction})`;
            el.style.setProperty('--initial-height', `${duration}px`);

            this.renderTaskContent(el, task);
            this.menuHandler.addTaskContextMenu(el, task);
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

            const hsl = ColorUtils.hexToHSL(color);
            if (hsl) {
                const { h, s, l } = hsl;
                el.style.setProperty('--accent-h', h.toString());
                el.style.setProperty('--accent-s', s + '%');
                el.style.setProperty('--accent-l', l + '%');

                el.style.setProperty('--color-accent-hsl', `var(--accent-h), var(--accent-s), var(--accent-l)`);
                el.style.setProperty('--file-accent', `hsl(var(--accent-h), var(--accent-s), var(--accent-l))`);
                el.style.setProperty('--file-accent-hover', `hsl(calc(var(--accent-h) - 1), calc(var(--accent-s) * 1.01), calc(var(--accent-l) * 1.075))`);
            } else {
                // Fallback for named colors or invalid hex
                el.style.setProperty('--file-accent', color);
                el.style.setProperty('--file-accent-hover', color);
            }
        } else {
            el.style.setProperty('padding-left', '8px', 'important');
        }
    }

    private async renderTaskContent(el: HTMLElement, task: Task) {
        await this.taskRenderer.render(el, task, this, this.plugin.settings);
    }
}
