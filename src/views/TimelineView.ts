import { ItemView, WorkspaceLeaf, Menu } from 'obsidian';
import { TaskRenderer } from './TaskRenderer';
import { TaskIndex } from '../services/TaskIndex';
import { Task, ViewState } from '../types';
import { DragHandler } from '../interaction/DragHandler';
import { MenuHandler } from '../interaction/MenuHandler';
import { TaskLayout } from '../services/TaskLayout';
import { DateUtils } from '../utils/DateUtils';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import { ColorUtils } from '../utils/ColorUtils';
import TaskViewerPlugin from '../main';
import { CreateTaskModal } from '../modals/CreateTaskModal';

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
        const initialDate = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        console.log('[DEBUG] Constructor - setting initial viewState.startDate to:', initialDate);
        this.viewState = {
            startDate: initialDate,
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

        const task = this.taskIndex.getTask(taskId);
        if (!task) return;

        // Check if this is a Future (unassigned) task - no handles should be shown
        if (task.isFuture) {
            return;
        }

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

        // --- Handles ---
        if (isAllDay) {
            // Left Resize Handle
            const leftContainer = wrapper.createDiv('handle-container left-resize-container');
            leftContainer.style.pointerEvents = 'auto';
            const resizeLeft = leftContainer.createDiv('handle-btn resize-handle left-resize-handle');
            resizeLeft.setText('↔');
            resizeLeft.dataset.taskId = taskId;

            // Right Resize Handle
            const rightContainer = wrapper.createDiv('handle-container right-resize-container');
            rightContainer.style.pointerEvents = 'auto';
            const resizeRight = rightContainer.createDiv('handle-btn resize-handle right-resize-handle');
            resizeRight.setText('↔');
            resizeRight.dataset.taskId = taskId;

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

        if (!wrapper || !taskEl) {
            console.log(`[updateHandleGeometry] wrapper or taskEl not found for ${taskId}`, { wrapper: !!wrapper, taskEl: !!taskEl });
            return;
        }

        const containerRect = this.container.getBoundingClientRect();
        const taskRect = taskEl.getBoundingClientRect();

        // Calculate position relative to container
        const top = taskRect.top - containerRect.top;
        const left = taskRect.left - containerRect.left;
        const width = taskRect.width;
        const height = taskRect.height;

        console.log(`[updateHandleGeometry] ${taskId}: top=${top}, left=${left}, width=${width}, height=${height}`);

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

        // Zoom Controls
        const zoomContainer = toolbar.createDiv('zoom-controls');

        const zoomOutBtn = zoomContainer.createEl('button', { text: '-' });
        zoomOutBtn.onclick = async () => {
            let newZoom = this.plugin.settings.zoomLevel - 0.25;
            if (newZoom < 0.25) newZoom = 0.25;
            this.plugin.settings.zoomLevel = newZoom;
            await this.plugin.saveSettings();
            this.render();
        };

        const zoomLabel = zoomContainer.createSpan({ cls: 'zoom-label', text: `${Math.round(this.plugin.settings.zoomLevel * 100)}%` });

        const zoomInBtn = zoomContainer.createEl('button', { text: '+' });
        zoomInBtn.onclick = async () => {
            let newZoom = this.plugin.settings.zoomLevel + 0.25;
            if (newZoom > 4.0) newZoom = 4.0;
            this.plugin.settings.zoomLevel = newZoom;
            await this.plugin.saveSettings();
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
                const color = this.getFileColor(file);
                const fileName = file.split('/').pop() || file;
                menu.addItem(item => {
                    item.setTitle(fileName)
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
        // Use DateUtils.getLocalDateString instead of toISOString() to avoid timezone issues
        this.viewState.startDate = DateUtils.getLocalDateString(date);
        console.log('[DEBUG] navigateDate - updated startDate to:', this.viewState.startDate);
        this.render();
    }


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

            // Add interaction listeners for creating tasks
            this.addCreateTaskListeners(col, date);
        });

        // Restore scroll position (must be done AFTER content is added)
        if (this.lastScrollTop > 0) {
            scrollArea.scrollTop = this.lastScrollTop;
        }
    }

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
        if (this.visibleFiles) {
            tasks = tasks.filter(t => this.visibleFiles!.has(t.file));
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
            if (task.id === this.selectedTaskId) el.addClass('selected');
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
        // if (this.visibleFiles) ... (Future tasks might belong to files not in view? Global filter?)
        // Applying file filter to future tasks as well for consistency
        const filteredFutureTasks = this.visibleFiles
            ? futureTasks.filter(t => this.visibleFiles!.has(t.file))
            : futureTasks;

        filteredFutureTasks.forEach(task => {
            const el = list.createDiv('task-card future-task-card');
            if (task.id === this.selectedTaskId) el.addClass('selected');
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

            el.style.top = `${(relativeStart * zoomLevel) + 1}px`;
            el.style.height = `${(duration * zoomLevel) - 3}px`;
            el.style.width = `calc((100% - 8px) * ${widthFraction} - 2px)`;
            el.style.left = `calc(4px + (100% - 8px) * ${leftFraction})`;
            el.style.setProperty('--initial-height', `${duration * zoomLevel}px`);

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
        }
    }

    private async renderTaskContent(el: HTMLElement, task: Task) {
        await this.taskRenderer.render(el, task, this, this.plugin.settings);
    }

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
