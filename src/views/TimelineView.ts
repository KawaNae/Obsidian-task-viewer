import { ItemView, WorkspaceLeaf, MarkdownRenderer, Menu } from 'obsidian';
import { TaskIndex } from '../services/TaskIndex';
import { Task, ViewState } from '../types';
import { DragHandler } from '../interaction/DragHandler';
import TaskViewerPlugin from '../main';

export const VIEW_TYPE_TIMELINE = 'timeline-view';

export class TimelineView extends ItemView {
    private taskIndex: TaskIndex;
    private container: HTMLElement;
    private viewState: ViewState;
    private dragHandler: DragHandler;
    private selectedTaskId: string | null = null;
    private handleOverlay: HTMLElement | null = null;
    private unsubscribe: (() => void) | null = null;
    private plugin: TaskViewerPlugin;

    private currentTimeInterval: number | null = null;
    private lastScrollTop: number = 0;

    constructor(leaf: WorkspaceLeaf, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        super(leaf);
        this.taskIndex = taskIndex;
        this.plugin = plugin;
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
        this.dragHandler = new DragHandler(this.container, this.taskIndex, this.plugin,
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
        this.unsubscribe = this.taskIndex.onChange(() => {
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

        // Determine which visual day "Now" belongs to
        // If now is 04:00 and startHour is 05:00, it belongs to the PREVIOUS calendar day's visual day.
        // If now is 06:00 and startHour is 05:00, it belongs to TODAY'S calendar day.

        let visualDateOfNow = new Date(now);
        if (now.getHours() < startHour) {
            visualDateOfNow.setDate(visualDateOfNow.getDate() - 1);
        }
        const visualDateString = visualDateOfNow.toISOString().split('T')[0];

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

        // Filter Button
        const filterBtn = toolbar.createEl('button', { text: 'Filter' });
        filterBtn.onclick = (e) => {
            const menu = new Menu();

            const dates = this.getDatesToShow();
            const allTasksInView = dates.flatMap(date => this.taskIndex.getTasksForVisualDay(date, this.plugin.settings.startHour));
            const distinctFiles = Array.from(new Set(allTasksInView.map(t => t.file))).sort();

            distinctFiles.forEach(file => {
                const isVisible = this.visibleFiles === null || this.visibleFiles.has(file);
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
            // Use setTimeout to ensure layout is calculated, though synchronous might work if content is already in DOM
            // But since we just created divs, they are in DOM.
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
            this.addTaskContextMenu(el, task);
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
        const layout = this.calculateTaskLayout(tasks, date);

        tasks.forEach(task => {
            if (!task.startTime) return;

            const el = container.createDiv('task-card timed');
            if (task.id === this.selectedTaskId) el.addClass('selected');
            el.dataset.id = task.id;

            // Apply Color
            this.applyTaskColor(el, task.file);

            // Calculate position
            let startMinutes = this.timeToMinutes(task.startTime);
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
                    endMinutes = this.timeToMinutes(task.endTime);
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
            // How do we know if it's from next day?
            // We can check if startMinutes < startHourMinutes.
            // Since we filtered tasks to be >= startHour (current day) OR < startHour (next day),
            // if it's < startHour, it MUST be next day.
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

            el.style.top = `${relativeStart}px`;
            el.style.height = `${duration}px`;
            el.style.width = `calc((100% - 8px) * ${widthFraction})`;
            el.style.left = `calc(4px + (100% - 8px) * ${leftFraction})`;
            el.style.setProperty('--initial-height', `${duration}px`);

            this.renderTaskContent(el, task);
            this.addTaskContextMenu(el, task);
        });
    }

    private getFileColor(filePath: string): string | null {
        const fileColors = this.plugin.settings.fileColors;
        if (!fileColors) return null;

        // Normalize separators
        const normalizedFile = filePath.replace(/\\\\/g, '/');

        for (const [path, color] of Object.entries(fileColors)) {
            const normalizedPath = path.replace(/\\\\/g, '/');

            // Check for match
            // 1. Suffix match (Filename or Extension)
            // 2. Prefix match (Folder)
            if (normalizedFile.endsWith(normalizedPath) || normalizedFile.startsWith(normalizedPath)) {
                return color;
            }
        }
        return null;
    }

    private applyTaskColor(el: HTMLElement, filePath: string) {
        const color = this.getFileColor(filePath);
        if (color) {
            el.style.setProperty('border-left', `4px solid ${color}`, 'important');
        }
    }

    private calculateTaskLayout(tasks: Task[], date: string): Map<string, { width: number, left: number }> {
        const layout = new Map<string, { width: number, left: number }>();
        if (tasks.length === 0) return layout;

        const startHour = this.plugin.settings.startHour;
        const startHourMinutes = startHour * 60;

        // Helper to get adjusted minutes (minutes from visual start)
        const getAdjustedMinutes = (task: Task, timeStr: string, isEnd: boolean) => {
            let m: number;

            if (timeStr.includes('T')) {
                const startDate = new Date(`${date}T00:00:00`);
                const endDate = new Date(timeStr);
                const diffMs = endDate.getTime() - startDate.getTime();
                m = Math.floor(diffMs / 60000);
            } else {
                m = this.timeToMinutes(timeStr);
            }

            // Adjust for visual day
            // If it's simple time and < startHour, it's next day (add 24h)
            if (!timeStr.includes('T') && m < startHourMinutes) {
                m += 24 * 60;
            }

            return m;
        };

        // 1. Prepare tasks with calculated start/end for sorting
        const preparedTasks = tasks.map(task => {
            const start = getAdjustedMinutes(task, task.startTime!, false);
            let end = task.endTime ? getAdjustedMinutes(task, task.endTime, true) : start + 60;
            // Fix simple wrap for end time if needed
            if (!task.endTime?.includes('T') && end < start) end += 24 * 60;

            return { task, start, end };
        });

        // 2. Sort by start time, then by duration (longer first)
        preparedTasks.sort((a, b) => {
            if (a.start !== b.start) return a.start - b.start;
            const durA = a.end - a.start;
            const durB = b.end - b.start;
            return durB - durA;
        });

        // 3. Group into clusters of overlapping tasks
        const clusters: typeof preparedTasks[] = [];
        let currentCluster: typeof preparedTasks = [];
        let clusterMaxEnd = -1;

        for (const item of preparedTasks) {
            if (currentCluster.length === 0) {
                currentCluster.push(item);
                clusterMaxEnd = item.end;
            } else {
                // If this task starts after the current cluster ends, it's a new cluster
                if (item.start >= clusterMaxEnd) {
                    clusters.push(currentCluster);
                    currentCluster = [item];
                    clusterMaxEnd = item.end;
                } else {
                    currentCluster.push(item);
                    clusterMaxEnd = Math.max(clusterMaxEnd, item.end);
                }
            }
        }
        if (currentCluster.length > 0) {
            clusters.push(currentCluster);
        }

        // 4. Process each cluster independently
        for (const cluster of clusters) {
            const columns: typeof preparedTasks[] = [];

            for (const item of cluster) {
                let placed = false;
                for (let i = 0; i < columns.length; i++) {
                    const column = columns[i];
                    // Check overlap
                    const overlaps = column.some(t => {
                        return item.start < t.end && item.end > t.start;
                    });

                    if (!overlaps) {
                        column.push(item);
                        placed = true;
                        break;
                    }
                }

                if (!placed) {
                    columns.push([item]);
                }
            }

            // Assign width and left position for this cluster
            const totalColumns = columns.length;
            const width = 100 / totalColumns;

            columns.forEach((column, colIndex) => {
                column.forEach(item => {
                    layout.set(item.task.id, {
                        width: width,
                        left: colIndex * width
                    });
                });
            });
        }

        return layout;
    }

    private addTaskContextMenu(el: HTMLElement, task: Task) {
        el.addEventListener('contextmenu', (event) => {
            event.preventDefault();

            const menu = new Menu();

            // Delete
            menu.addItem((item) => {
                item.setTitle('Delete')
                    .setIcon('trash')
                    .onClick(async () => {
                        await this.taskIndex.deleteTask(task.id);
                    });
            });

            // Convert
            const isAllDay = !task.startTime;
            menu.addItem((item) => {
                item.setTitle(isAllDay ? 'Convert to Timed' : 'Convert to All Day')
                    .setIcon('calendar-with-checkmark')
                    .onClick(async () => {
                        const updates: Partial<Task> = {};
                        if (isAllDay) {
                            // Convert to Timed (default to startHour)
                            const startHour = this.plugin.settings.startHour;
                            const h = startHour.toString().padStart(2, '0');
                            updates.startTime = `${h}:00`;
                            updates.endTime = `${(startHour + 1).toString().padStart(2, '0')}:00`;
                        } else {
                            // Convert to All Day
                            updates.startTime = undefined;
                            updates.endTime = undefined;
                        }
                        await this.taskIndex.updateTask(task.id, updates);
                    });
            });

            // Duplicate
            menu.addItem((item) => {
                item.setTitle('Duplicate')
                    .setIcon('copy')
                    .onClick(async () => {
                        await this.taskIndex.duplicateTask(task.id);
                    });
            });

            menu.showAtPosition({ x: event.pageX, y: event.pageY });
        });
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

        // Handle Internal Links
        const internalLinks = contentContainer.querySelectorAll('a.internal-link');
        internalLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const target = (link as HTMLElement).dataset.href;
                if (target) {
                    this.app.workspace.openLinkText(target, task.file, true);
                }
            });
            // Prevent drag/selection start
            link.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
            });
        });

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
