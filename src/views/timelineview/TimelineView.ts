import { ItemView, WorkspaceLeaf } from 'obsidian';
import { TaskRenderer } from '../TaskRenderer';
import { TaskIndex } from '../../services/TaskIndex';
import { Task, ViewState, isCompleteStatusChar } from '../../types';
import { DragHandler } from '../../interaction/DragHandler';
import { MenuHandler } from '../../interaction/MenuHandler';

import { DateUtils } from '../../utils/DateUtils';

import TaskViewerPlugin from '../../main';

import { HandleManager } from './HandleManager';
import { TimelineToolbar } from './TimelineToolbar';
import { ViewUtils } from '../ViewUtils';
import { GridRenderer } from './renderers/GridRenderer';
import { AllDaySectionRenderer } from './renderers/AllDaySectionRenderer';
import { TimelineSectionRenderer } from './renderers/TimelineSectionRenderer';


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

    // ==================== Renderers ====================
    private gridRenderer: GridRenderer;
    private allDayRenderer: AllDaySectionRenderer;
    private timelineRenderer: TimelineSectionRenderer;


    // ==================== State ====================
    private container: HTMLElement;
    private viewState: ViewState;
    private unsubscribe: (() => void) | null = null;
    private currentTimeInterval: number | null = null;
    private lastScrollTop: number = 0;
    private hasInitializedStartDate: boolean = false;

    // ==================== Lifecycle ====================

    constructor(leaf: WorkspaceLeaf, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        super(leaf);
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.viewState = {
            startDate: DateUtils.getVisualDateOfNow(this.plugin.settings.startHour),
            daysToShow: 3,
            showDeadlineList: true // Default: show deadline list
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
            // Note: startDate is not restored - always use "Today" logic on reload
        }
        await super.setState(state, result);
        this.render();
    }

    getState() {
        // Only save daysToShow, not startDate (startDate resets on reload like Today button)
        const state = {
            daysToShow: this.viewState.daysToShow
        };
        return state;
    }

    async onOpen() {
        // Set initial startDate - will be re-evaluated in onChange when tasks are loaded
        this.viewState.startDate = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);

        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('timeline-view');

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
                getFileColor: (filePath) => ViewUtils.getFileColor(this.app, filePath, this.plugin.settings.frontmatterColorKey),
                getDatesToShow: () => this.getDatesToShow()
            }
        );

        // Initialize Renderers

        this.allDayRenderer = new AllDaySectionRenderer(this.taskIndex, this.plugin, this.menuHandler, this.handleManager, this.taskRenderer, () => this.viewState.daysToShow);
        this.timelineRenderer = new TimelineSectionRenderer(this.taskIndex, this.plugin, this.menuHandler, this.handleManager, this.taskRenderer);
        this.gridRenderer = new GridRenderer(this.container, this.viewState, this.plugin, this.menuHandler, this.taskIndex);

        // Initialize DragHandler with selection callback, move callback, and view start date provider
        this.dragHandler = new DragHandler(this.container, this.taskIndex, this.plugin,
            (taskId) => {
                this.handleManager.selectTask(taskId);
            },
            () => {
                this.handleManager.updatePositions();
            },
            () => this.viewState.startDate
        );

        // Background click to deselect
        this.container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;

            // If clicking handle, do nothing (handled by DragHandler or button click)
            if (target.closest('.task-card__handle-btn')) return;

            if (!target.closest('.task-card')) {
                if (this.handleManager.getSelectedTaskId()) {
                    this.handleManager.selectTask(null);
                }
            }
        });

        // Subscribe to data changes
        this.unsubscribe = this.taskIndex.onChange((taskId, changes) => {
            // On first data load, re-evaluate startDate using Today button logic
            if (!this.hasInitializedStartDate && this.taskIndex.getTasks().length > 0) {
                this.hasInitializedStartDate = true;
                const oldestOverdue = this.findOldestOverdueDate();
                if (oldestOverdue) {
                    this.viewState.startDate = oldestOverdue;
                }
            }

            if (taskId && changes) {
                // Check if we can do partial update
                // Only content/status changes are safe for partial update (no layout change)
                const safeKeys = ['status', 'statusChar', 'content', 'childLines'];
                const isSafe = changes.every(k => safeKeys.includes(k));

                if (isSafe) {
                    const task = this.taskIndex.getTask(taskId);
                    if (task) {
                        const card = this.container.querySelector(`.task-card[data-id="${taskId}"]`) as HTMLElement;
                        if (card) {
                            // Partial Update: Re-render content only
                            const contentContainer = card.querySelector('.task-card__content');
                            if (contentContainer) contentContainer.remove();

                            this.taskRenderer.render(card, task, this, this.plugin.settings);
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
        // Re-evaluate startDate (Today button logic) for day boundary crossing or settings change
        const oldestOverdue = this.findOldestOverdueDate();
        const today = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        this.viewState.startDate = oldestOverdue || today;

        this.render();
    }

    // ==================== Core Rendering ====================

    /** Renders the "now" indicator line on today's column. */
    /** Renders the "now" indicator line on today's column. */
    private renderCurrentTimeIndicator() {
        this.gridRenderer.renderCurrentTimeIndicator();
    }

    private render() {

        // Save scroll position
        const scrollArea = this.container.querySelector('.timeline-scroll-area');
        if (scrollArea) {
            this.lastScrollTop = scrollArea.scrollTop;
        }

        // Save toggle states
        const allDayRow = this.container.querySelector('.all-day-row');
        const wasAllDayCollapsed = allDayRow?.hasClass('collapsed') || false;

        this.container.empty();

        // Apply Zoom Level
        const zoomLevel = this.plugin.settings.zoomLevel;
        this.container.style.setProperty('--hour-height', `${60 * zoomLevel}px`);

        // Measure and set actual scrollbar width for grid alignment
        const scrollbarWidth = this.measureScrollbarWidth();
        this.container.style.setProperty('--scrollbar-width-actual', `${scrollbarWidth}px`);

        // Initialize 2-Column Layout
        const layoutContainer = this.container.createDiv('timeline-view-layout');

        // Execution Column (Timeline, AllDay)
        const executionColumn = layoutContainer.createDiv('execution-column');

        // Target Column (Deadline List)
        const targetColumn = layoutContainer.createDiv('target-column');
        if (!this.viewState.showDeadlineList) {
            targetColumn.addClass('hidden');
        } else {
            // Placeholder content for now
            targetColumn.createEl('h3', { text: 'Deadline List', attr: { style: 'padding: 10px; border-bottom: 1px solid var(--background-modifier-border); margin: 0;' } });
            const listContainer = targetColumn.createDiv({ attr: { style: 'padding: 10px; color: var(--text-muted);' } });
            listContainer.setText('Coming soon...');
        }

        // Render Toolbar (into execution column)
        // We probably want toolbar in execution column OR above both.
        // Current design: Toolbar is part of timeline view functionality.
        // Let's put it in execution column for now as verified in plan.
        this.toolbar = new TimelineToolbar(
            executionColumn,
            this.app,
            this.viewState,
            this.plugin,
            this.taskIndex,
            {
                onRender: () => this.render(),
                onStateChange: () => {
                    this.plugin.saveSettings();
                },
                getFileColor: (file) => this.getFileColor(file),
                getDatesToShow: () => this.getDatesToShow()
            }
        );
        this.toolbar.render();

        // Use GridRenderer (render into execution column)
        this.gridRenderer.render(
            executionColumn,
            this.allDayRenderer,
            this.timelineRenderer,
            this.handleManager,
            () => this.getDatesToShow(),
            this,
            this.toolbar.getVisibleFiles()
        );

        this.handleManager.createOverlay();
        this.renderCurrentTimeIndicator();

        // Restore scroll position
        const newScrollArea = this.container.querySelector('.timeline-scroll-area');
        if (newScrollArea && this.lastScrollTop > 0) {
            newScrollArea.scrollTop = this.lastScrollTop;
        }

        // Restore toggle states
        const newAllDayRow = this.container.querySelector('.all-day-row');

        if (wasAllDayCollapsed && newAllDayRow) {
            newAllDayRow.addClass('collapsed');
            const toggleBtn = newAllDayRow.querySelector('.section-toggle-btn');
            if (toggleBtn) toggleBtn.setText('+');
        }

        // Restore selected task handles AFTER scroll/toggle restoration
        // Use requestAnimationFrame to ensure layout is complete
        const selectedTaskId = this.handleManager.getSelectedTaskId();
        if (selectedTaskId) {
            requestAnimationFrame(() => {
                this.handleManager.selectTask(selectedTaskId);
            });
        }
    }

    /**
     * Measures the actual scrollbar width for the current environment.
     * Returns 0 for overlay scrollbars (iOS/macOS), ~15px for classic scrollbars (Windows).
     */
    private measureScrollbarWidth(): number {
        const outer = document.createElement('div');
        outer.style.visibility = 'hidden';
        outer.style.overflow = 'scroll';
        outer.style.width = '100px';
        outer.style.height = '100px';
        outer.style.position = 'absolute';
        outer.style.top = '-9999px';
        document.body.appendChild(outer);

        const inner = document.createElement('div');
        inner.style.width = '100%';
        outer.appendChild(inner);

        const scrollbarWidth = outer.offsetWidth - inner.offsetWidth;
        document.body.removeChild(outer);

        return scrollbarWidth;
    }

    // ==================== Grid & Layout ====================



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



    // ==================== Color & Styling ====================

    /** Gets the custom color for a file from its frontmatter. */
    private getFileColor(filePath: string): string | null {
        return ViewUtils.getFileColor(this.app, filePath, this.plugin.settings.frontmatterColorKey);
    }


    // ==================== Task Creation ====================

    // ==================== Overdue Date Logic ====================

    /**
     * Finds the oldest date with incomplete overdue tasks.
     * Returns null if all past tasks are completed.
     * Used for initial view date on open/reload.
     */
    private findOldestOverdueDate(): string | null {
        const startHour = this.plugin.settings.startHour;
        const today = DateUtils.getVisualDateOfNow(startHour);

        // Get all incomplete tasks with dates before today
        const tasks = this.taskIndex.getTasks().filter(t =>
            !isCompleteStatusChar(t.statusChar, this.plugin.settings.completeStatusChars) &&
            t.startDate
        );

        // Find the oldest past date among incomplete tasks
        let oldestDate: string | null = null;

        for (const task of tasks) {
            const taskDate = task.startDate!;

            // Only consider tasks that are before today (visual date)
            if (taskDate < today) {
                if (!oldestDate || taskDate < oldestDate) {
                    oldestDate = taskDate;
                }
            }
        }

        return oldestDate;
    }
}
