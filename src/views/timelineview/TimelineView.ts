import { ItemView, WorkspaceLeaf, Menu } from 'obsidian';
import { TaskRenderer } from '../TaskRenderer';
import { TaskIndex } from '../../services/TaskIndex';
import { Task, ViewState } from '../../types';
import { DragHandler } from '../../interaction/DragHandler';
import { MenuHandler } from '../../interaction/MenuHandler';
import { TaskLayout } from '../../services/TaskLayout';
import { DateUtils } from '../../utils/DateUtils';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import TaskViewerPlugin from '../../main';
import { CreateTaskModal } from '../../modals/CreateTaskModal';
import { HandleManager } from './HandleManager';
import { TimelineToolbar } from './TimelineToolbar';
import { ViewUtils } from '../ViewUtils';

export const VIEW_TYPE_TIMELINE = 'timeline-view';

/**
 * Timeline View - Displays tasks on a time-based grid layout.
 * 
 * Structure:
 * - Lifecycle: constructor, onOpen, onClose, refresh
 * - Core Rendering: render, renderCurrentTimeIndicator
 * - Grid & Layout: renderGrid, getDatesToShow, renderTimeLabels
 * - Section Renderers: renderFutureSection, renderLongTermTasks, renderTimedTasks
 * - Color & Styling: getFileColor, applyTaskColor
 * - Task Creation: addCreateTaskListeners, handleCreateTaskTrigger
 */
export class TimelineView extends ItemView {
    // ==================== Services & Handlers ====================
    private taskIndex: TaskIndex;
    private plugin: TaskViewerPlugin;
    private taskRenderer: TaskRenderer;
    private dragHandler: DragHandler;
    private menuHandler: MenuHandler;
    private handleManager: HandleManager;
    private toolbar: TimelineToolbar;

    // ==================== State ====================
    private container: HTMLElement;
    private viewState: ViewState;
    private unsubscribe: (() => void) | null = null;
    private currentTimeInterval: number | null = null;
    private lastScrollTop: number = 0;

    // ==================== Lifecycle ====================

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
        console.log('[DEBUG] setState called with:', state);
        if (state) {
            if (state.daysToShow) {
                console.log('[DEBUG] setState - updating daysToShow to:', state.daysToShow);
                this.viewState.daysToShow = state.daysToShow;
            }
            if (state.startDate) {
                console.log('[DEBUG] setState - updating startDate from:', this.viewState.startDate, 'to:', state.startDate);
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

        // Initialize HandleManager
        this.handleManager = new HandleManager(this.container, this.taskIndex);

        // Initialize Toolbar
        this.toolbar = new TimelineToolbar(
            this.container,
            this.app,
            this.viewState,
            this.plugin,
            this.taskIndex,
            {
                onRender: () => this.render(),
                onStateChange: () => { },
                getFileColor: (filePath) => this.getFileColor(filePath),
                getDatesToShow: () => this.getDatesToShow()
            }
        );

        // Initialize DragHandler with selection callback and move callback
        this.dragHandler = new DragHandler(this.container, this.taskIndex, this.plugin,
            (taskId) => {
                this.handleManager.selectTask(taskId);
            },
            () => {
                this.handleManager.updatePositions();
            }
        );

        // Background click to deselect
        this.container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;

            // If clicking handle, do nothing (handled by DragHandler or button click)
            if (target.closest('.handle-btn')) return;

            if (!target.closest('.task-card')) {
                if (this.handleManager.getSelectedTaskId()) {
                    this.handleManager.selectTask(null);
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
            this.handleManager.updatePositions();
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

    // ==================== Core Rendering ====================

    /** Renders the "now" indicator line on today's column. */
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
            const zoomLevel = this.plugin.settings.zoomLevel;
            indicator.style.top = `${minutesFromStart * zoomLevel}px`;
        }
    }

    private render() {

        const scrollArea = this.container.querySelector('.timeline-scroll-area');
        if (scrollArea) {
            this.lastScrollTop = scrollArea.scrollTop;
        }

        this.container.empty();

        // Apply Zoom Level
        const zoomLevel = this.plugin.settings.zoomLevel;
        this.container.style.setProperty('--hour-height', `${60 * zoomLevel}px`);

        this.toolbar.render();
        this.renderGrid();
        this.handleManager.createOverlay();
        this.renderCurrentTimeIndicator();

        const selectedTaskId = this.handleManager.getSelectedTaskId();
        if (selectedTaskId) {
            this.handleManager.selectTask(selectedTaskId);
        }
    }

    // ==================== Grid & Layout ====================

    /** Renders the main grid structure with header, all-day row, and timeline. */
    private renderGrid() {
        const grid = this.container.createDiv('timeline-grid');
        const dates = this.getDatesToShow();
        const colTemplate = `30px repeat(${this.viewState.daysToShow}, minmax(0, 1fr))`;

        // Set view start date for MenuHandler (for E, ED, D type implicit start display)
        this.menuHandler.setViewStartDate(dates[0]);

        // 0. Future Section (Header Grid)
        this.renderFutureSection(grid);

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

            // Add click listener to open daily note
            cell.addEventListener('click', async () => {
                const dateObj = new Date(date);
                // Fix timezone offset for daily note creation
                const [y, m, d] = date.split('-').map(Number);
                dateObj.setFullYear(y, m - 1, d);
                dateObj.setHours(0, 0, 0, 0);

                let file = DailyNoteUtils.getDailyNote(this.app, dateObj);
                if (!file) {
                    file = await DailyNoteUtils.createDailyNote(this.app, dateObj);
                }
                if (file) {
                    await this.app.workspace.getLeaf(false).openFile(file);
                }
            });
        });

        // 2. All-Day Row (Merged All-Day & Long-Term)
        const allDayRow = grid.createDiv('timeline-row all-day-row');
        allDayRow.style.gridTemplateColumns = colTemplate;

        // Time Axis All-Day
        const axisCell = allDayRow.createDiv('all-day-cell');
        axisCell.setText('All Day');
        axisCell.style.gridColumn = '1';
        axisCell.style.gridRow = '1 / span 50'; // Span all implicit rows

        // Background Cells (Grid Lines)
        dates.forEach((date, i) => {
            const cell = allDayRow.createDiv('all-day-cell');
            cell.dataset.date = date;
            cell.style.gridColumn = `${i + 2}`; // +2 because 1 is axis
            cell.style.gridRow = '1 / span 50'; // Span implicit rows (large enough number)
            cell.style.zIndex = '0';
        });

        // Render Tasks (Overlaid)
        this.renderLongTermTasks(allDayRow, dates);

        // 3. Timeline Row (Scrollable)
        const scrollArea = grid.createDiv('timeline-row timeline-scroll-area');
        scrollArea.style.gridTemplateColumns = colTemplate;

        // Add scroll listener to update handles
        scrollArea.addEventListener('scroll', () => {
            this.handleManager.updatePositions();
        });

        // Time Axis Column
        const timeCol = scrollArea.createDiv('time-axis-column');
        this.renderTimeLabels(timeCol);

        // Day Columns
        dates.forEach(date => {
            const col = scrollArea.createDiv('day-timeline-column');
            col.dataset.date = date;
            this.renderTimedTasks(col, date);

            // Add interaction listeners for creating tasks
            this.addCreateTaskListeners(col, date);
        });

        // Restore scroll position (must be done AFTER content is added)
        if (this.lastScrollTop > 0) {
            scrollArea.scrollTop = this.lastScrollTop;
        }
    }

    // ==================== Section Renderers ====================

    /** Renders long-term tasks (spanning multiple days) in the all-day row. */
    private renderLongTermTasks(container: HTMLElement, dates: string[]) {
        const viewStart = dates[0];
        const viewEnd = dates[dates.length - 1];
        const startHour = this.plugin.settings.startHour;
        console.log('[DEBUG] renderLongTermTasks - viewStart:', viewStart);
        console.log('[DEBUG] renderLongTermTasks - viewEnd:', viewEnd);
        console.log('[DEBUG] renderLongTermTasks - startHour setting:', startHour);

        // Fetch tasks that overlap with the view range AND are long-term (>= 24 hours)
        // README spec: tasks with duration >= 24 hours go to long-term section
        let tasks = this.taskIndex.getTasks().filter(t => {
            if (t.isFuture) return false; // Handled in future section

            // Use view's left edge date for undefined startDate (E, ED, D types) per readme spec
            const tStart = t.startDate || viewStart;
            const tEnd = t.endDate || tStart;

            // Check if task overlaps with view range
            if (!(tStart <= viewEnd && tEnd >= viewStart)) return false;

            // Use DateUtils.isLongTermTask to check duration
            // For tasks without startDate (E, ED, D types), use viewStart as start
            const isLongTerm = DateUtils.isLongTermTask(tStart, t.startTime, t.endDate, t.endTime, startHour);

            return isLongTerm;
        });

        // Filter by visible files
        const visibleFiles = this.toolbar.getVisibleFiles();
        if (visibleFiles) {
            tasks = tasks.filter(t => visibleFiles.has(t.file));
        }

        // Sort by Start Date, then Duration (descending)
        tasks.sort((a, b) => {
            // Use view's left edge date for undefined startDate (E, ED, D types)
            const startA = a.startDate || viewStart;
            const startB = b.startDate || viewStart;

            if (startA !== startB) {
                return startA.localeCompare(startB);
            }
            const endA = a.endDate || startA;
            const endB = b.endDate || startB;

            const durA = DateUtils.getDiffDays(startA, endA);
            const durB = DateUtils.getDiffDays(startB, endB);
            return durB - durA;
        });

        // Pack tasks (Vertical Stacking)
        // Track availability: track[trackIndex] = lastOccupiedDateStr
        const tracks: string[] = []; // Stores the 'endDate' of the last task in this track

        tasks.forEach(task => {
            // Use view's left edge date for undefined startDate (E, ED, D types)
            const tStart = task.startDate || viewStart;
            const tEnd = task.endDate || tStart;

            // Calculate deadline line for arrow
            let deadlineLine: number | null = null;
            let isDeadlineClipped = false;
            if (task.deadline && task.deadline.match(/^\d{4}-\d{2}-\d{2}/)) {
                const deadlineDateStr = task.deadline.split('T')[0];
                const deadlineDiff = DateUtils.getDiffDays(viewStart, deadlineDateStr);
                const dlLine = deadlineDiff + 3; // +2 for axis offset, +1 for grid line after day
                const gridMax = this.viewState.daysToShow + 2;

                // Check if deadline is beyond view
                if (dlLine > gridMax) {
                    isDeadlineClipped = true;
                }
                deadlineLine = Math.min(dlLine, gridMax);

                // Calculate task end line
                const taskEndDiff = DateUtils.getDiffDays(viewStart, tEnd);
                const taskEndLine = taskEndDiff + 3;

                // Only show arrow if deadline is after task end
                if (deadlineLine <= taskEndLine) {
                    deadlineLine = null;
                }
            }

            // Calculate collision end (for stacking - includes arrow space)
            const tEndForCollision = deadlineLine
                ? DateUtils.addDays(viewStart, deadlineLine - 3)
                : tEnd;

            // Find first track where task.startDate > track.lastEndDate
            let trackIndex = -1;

            for (let i = 0; i < tracks.length; i++) {
                // Check if space is available
                // Space available if task.startDate > tracks[i]
                if (tStart > tracks[i]) {
                    trackIndex = i;
                    break;
                }
            }

            if (trackIndex === -1) {
                // New track
                trackIndex = tracks.length;
                tracks.push(tEndForCollision);
            } else {
                // Update track with collision end
                tracks[trackIndex] = tEndForCollision;
            }

            // Render Task Card
            const el = container.createDiv('task-card all-day');
            if (task.endDate && task.endDate !== tStart) {
                el.addClass('long-term-task');
            }
            if (task.id === this.handleManager.getSelectedTaskId()) el.addClass('selected');
            el.dataset.id = task.id;

            this.applyTaskColor(el, task.file);
            this.renderTaskContent(el, task);
            this.menuHandler.addTaskContextMenu(el, task);

            // Positioning
            const diffStart = DateUtils.getDiffDays(viewStart, tStart);
            let colStart = 2 + diffStart;

            const durationArr = DateUtils.getDiffDays(tStart, tEnd) + 1;

            let span = durationArr;

            // Handle Out of Bounds (Left)
            if (colStart < 2) {
                span -= (2 - colStart);
                colStart = 2;
            }

            // Handle Out of Bounds (Right)
            const maxCol = 2 + this.viewState.daysToShow;
            if (colStart + span > maxCol) {
                span = maxCol - colStart;
            }

            if (span < 1) return;

            el.style.gridColumn = `${colStart} / span ${span}`;
            el.style.gridRow = `${trackIndex + 1}`;
            el.style.zIndex = '10';

            // Render Deadline Arrow if applicable
            if (deadlineLine) {
                const taskEndLine = colStart + span;
                this.renderDeadlineArrow(container, task, trackIndex, taskEndLine, deadlineLine, isDeadlineClipped);
            }
        });
    }

    private renderDeadlineArrow(
        container: HTMLElement,
        task: Task,
        rowIndex: number,
        taskEndLine: number,
        deadlineLine: number,
        isClipped: boolean = false
    ) {
        const arrowEl = container.createDiv('deadline-arrow');
        arrowEl.dataset.taskId = task.id;
        arrowEl.style.gridRow = (rowIndex + 1).toString();
        arrowEl.style.gridColumnStart = taskEndLine.toString();
        arrowEl.style.gridColumnEnd = deadlineLine.toString();
        arrowEl.title = `Deadline: ${task.deadline}`;

        if (isClipped) {
            arrowEl.addClass('deadline-clipped');
        }
    }

    private renderFutureSection(container: HTMLElement) {
        const headerGrid = container.createDiv('timeline-header-grid');

        // 1. Top Left: Spacer
        headerGrid.createDiv('header-grid-cell header-top-left');

        // 2. Top Right: Label
        const label = headerGrid.createDiv('header-grid-cell header-top-right');
        label.setText('Future / Unassigned');

        // 3. Bottom Left: Toggle
        const toggleCell = headerGrid.createDiv('header-grid-cell header-bottom-left');
        // const toggleBtn = toggleCell.createEl('button', { text: '-' }); // TODO: Implement toggle

        // 4. Bottom Right: Content
        const contentCell = headerGrid.createDiv('header-grid-cell header-bottom-right');
        const list = contentCell.createDiv('unassigned-task-list');

        // Get Future Tasks
        const futureTasks = this.taskIndex.getTasks().filter(t => t.isFuture);

        // Filter by visible files logic if active
        // Applying file filter to future tasks as well for consistency
        const visibleFiles = this.toolbar.getVisibleFiles();
        const filteredFutureTasks = visibleFiles
            ? futureTasks.filter(t => visibleFiles.has(t.file))
            : futureTasks;

        filteredFutureTasks.forEach(task => {
            const el = list.createDiv('task-card future-task-card');
            if (task.id === this.handleManager.getSelectedTaskId()) el.addClass('selected');
            el.dataset.id = task.id;

            this.applyTaskColor(el, task.file);
            this.renderTaskContent(el, task);
            this.menuHandler.addTaskContextMenu(el, task);
        });
    }

    private getDatesToShow(): string[] {
        const dates = [];
        const start = new Date(this.viewState.startDate);
        console.log('[DEBUG] getDatesToShow - viewState.startDate:', this.viewState.startDate);
        console.log('[DEBUG] getDatesToShow - startHour setting:', this.plugin.settings.startHour);
        console.log('[DEBUG] getDatesToShow - current visual date:', DateUtils.getVisualDateOfNow(this.plugin.settings.startHour));
        console.log('[DEBUG] getDatesToShow - actual today:', DateUtils.getToday());

        for (let i = 0; i < this.viewState.daysToShow; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            dates.push(DateUtils.getLocalDateString(d));
        }
        console.log('[DEBUG] getDatesToShow - generated dates:', dates);
        return dates;
    }

    private renderTimeLabels(container: HTMLElement) {
        const startHour = this.plugin.settings.startHour;
        const zoomLevel = this.plugin.settings.zoomLevel;

        for (let i = 0; i < 24; i++) {
            const label = container.createDiv('time-label');
            label.style.top = `${i * 60 * zoomLevel}px`;

            // Display hour adjusted by startHour
            let displayHour = startHour + i;
            if (displayHour >= 24) displayHour -= 24;

            label.setText(`${displayHour}`);
        }
    }



    private renderTimedTasks(container: HTMLElement, date: string) {
        const startHour = this.plugin.settings.startHour;
        const zoomLevel = this.plugin.settings.zoomLevel;
        // Use getTasksForVisualDay, filter for timed tasks with duration < 24 hours
        let tasks = this.taskIndex.getTasksForVisualDay(date, startHour).filter(t => {
            if (!t.startTime) return false;
            // Only include tasks with duration < 24 hours
            const tStart = t.startDate || date;
            const isLongTerm = DateUtils.isLongTermTask(tStart, t.startTime, t.endDate, t.endTime, startHour);
            return !isLongTerm;
        });

        // Filter
        const visibleFiles = this.toolbar.getVisibleFiles();
        if (visibleFiles) {
            tasks = tasks.filter(t => visibleFiles.has(t.file));
        }

        // Calculate layout for overlapping tasks
        const layout = TaskLayout.calculateTaskLayout(tasks, date, startHour);

        tasks.forEach(task => {
            if (!task.startTime) return;

            const el = container.createDiv('task-card timed');
            if (task.id === this.handleManager.getSelectedTaskId()) el.addClass('selected');
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

            el.style.top = `${(relativeStart * zoomLevel) + 1}px`;
            el.style.height = `${(duration * zoomLevel) - 3}px`;
            el.style.width = `calc((100% - 8px) * ${widthFraction} - 2px)`;
            el.style.left = `calc(4px + (100% - 8px) * ${leftFraction})`;
            el.style.setProperty('--initial-height', `${duration * zoomLevel}px`);

            this.renderTaskContent(el, task);
            this.menuHandler.addTaskContextMenu(el, task);
        });
    }

    // ==================== Color & Styling ====================

    /** Gets the custom color for a file from its frontmatter. */
    private getFileColor(filePath: string): string | null {
        return ViewUtils.getFileColor(this.app, filePath, this.plugin.settings.frontmatterColorKey);
    }

    /** Applies file-based accent color to a task element. */
    private applyTaskColor(el: HTMLElement, filePath: string) {
        ViewUtils.applyFileColor(this.app, el, filePath, this.plugin.settings.frontmatterColorKey);
    }

    /** Renders task content using TaskRenderer. */
    private async renderTaskContent(el: HTMLElement, task: Task) {
        await this.taskRenderer.render(el, task, this, this.plugin.settings);
    }

    // ==================== Task Creation ====================

    /** Adds click/context listeners for creating new tasks. */
    private addCreateTaskListeners(col: HTMLElement, date: string) {
        // Context Menu (Right Click)
        col.addEventListener('contextmenu', (e) => {
            // Prevent default context menu if clicking on empty space
            if (e.target === col) {
                e.preventDefault();
                this.handleCreateTaskTrigger(e.offsetY, date);
            }
        });

        // Long Press (Touch)
        let touchTimer: NodeJS.Timeout | null = null;
        col.addEventListener('touchstart', (e) => {
            if (e.target === col && e.touches.length === 1) {
                const touch = e.touches[0];
                // Calculate offsetY relative to col
                const rect = col.getBoundingClientRect();
                const offsetY = touch.clientY - rect.top;

                touchTimer = setTimeout(() => {
                    this.handleCreateTaskTrigger(offsetY, date);
                }, 500); // 500ms long press
            }
        });

        col.addEventListener('touchend', () => {
            if (touchTimer) {
                clearTimeout(touchTimer);
                touchTimer = null;
            }
        });

        col.addEventListener('touchmove', () => {
            if (touchTimer) {
                clearTimeout(touchTimer);
                touchTimer = null;
            }
        });
    }

    private handleCreateTaskTrigger(offsetY: number, date: string) {
        // Calculate time from offsetY
        const zoomLevel = this.plugin.settings.zoomLevel;
        const startHour = this.plugin.settings.startHour;

        // offsetY is in pixels. 1 hour = 60 * zoomLevel pixels
        const minutesFromStart = offsetY / zoomLevel;

        // Add startHour offset
        const rawTotalMinutes = (startHour * 60) + minutesFromStart;
        let totalMinutes = rawTotalMinutes;

        // Normalize to 0-23 hours
        if (totalMinutes >= 24 * 60) {
            totalMinutes -= 24 * 60;
        }

        const hours = Math.floor(totalMinutes / 60);
        const minutes = Math.floor(totalMinutes % 60);

        // Round to nearest 5 minutes for cleaner times
        let roundedMinutes = Math.round(minutes / 5) * 5;
        let finalHours = hours;

        if (roundedMinutes === 60) {
            roundedMinutes = 0;
            finalHours += 1;
        }

        // Normalize hours again just in case
        if (finalHours >= 24) {
            finalHours -= 24;
        }

        // Format time HH:mm
        const timeString = `${finalHours.toString().padStart(2, '0')}:${roundedMinutes.toString().padStart(2, '0')}`;

        // Determine Task Date
        // If finalHours + 24 (effectively) was >= 24, it means it's next day
        // Wait, 'finalHours' is normalized 0-23. 
        // We can check totalMinutes vs 24*60

        let taskDate = date;
        if (rawTotalMinutes >= 24 * 60) {
            // It's the next day
            const d = new Date(date);
            // Fix timezone for date calc
            const [y, m, day] = date.split('-').map(Number);
            d.setFullYear(y, m - 1, day);
            d.setDate(d.getDate() + 1);
            taskDate = DateUtils.getLocalDateString(d);
        }

        // Open Modal
        new CreateTaskModal(this.app, async (result) => {
            // date is the FILE date (visual column date)
            // taskDate is the actual date for the task (@YYYY-MM-DD)
            await this.taskIndex.addTaskToDailyNote(date, timeString, result, this.plugin.settings, taskDate);
        }).open();
    }
}
