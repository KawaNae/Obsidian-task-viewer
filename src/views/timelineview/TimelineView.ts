import { ItemView, WorkspaceLeaf } from 'obsidian';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { TaskIndex } from '../../services/core/TaskIndex';
import { Task, ViewState, isCompleteStatusChar } from '../../types';
import { DragHandler } from '../../interaction/drag/DragHandler';
import { MenuHandler } from '../../interaction/menu/MenuHandler';

import { DateUtils } from '../../utils/DateUtils';

import TaskViewerPlugin from '../../main';

import { HandleManager } from './HandleManager';
import { TimelineToolbar } from './TimelineToolbar';
import { ViewUtils } from '../ViewUtils';
import { GridRenderer } from './renderers/GridRenderer';
import { AllDaySectionRenderer } from './renderers/AllDaySectionRenderer';
import { TimelineSectionRenderer } from './renderers/TimelineSectionRenderer';
import { DeadlineListRenderer } from './renderers/DeadlineListRenderer';
import { HabitTrackerRenderer } from './renderers/HabitTrackerRenderer';


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
    private taskRenderer: TaskCardRenderer;
    private dragHandler: DragHandler;
    private menuHandler: MenuHandler;
    private handleManager: HandleManager;
    private toolbar: TimelineToolbar;

    // ==================== Renderers ====================
    private gridRenderer: GridRenderer;
    private allDayRenderer: AllDaySectionRenderer;
    private timelineRenderer: TimelineSectionRenderer;
    private deadlineRenderer: DeadlineListRenderer;
    private habitRenderer: HabitTrackerRenderer;


    // ==================== State ====================
    private container: HTMLElement;
    private viewState: ViewState;
    private unsubscribe: (() => void) | null = null;
    private currentTimeInterval: number | null = null;
    private lastScrollTop: number = 0;
    private hasInitializedStartDate: boolean = false;
    private targetColumnEl: HTMLElement | null = null;
    private executionColumnEl: HTMLElement | null = null;
    private sidebarBackdropEl: HTMLElement | null = null;

    // ==================== Lifecycle ====================

    constructor(leaf: WorkspaceLeaf, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        super(leaf);
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.viewState = {
            startDate: DateUtils.getVisualDateOfNow(this.plugin.settings.startHour),
            daysToShow: 3,
            showDeadlineList: true, // Default: show deadline list
            filterFiles: null
        };
        this.taskRenderer = new TaskCardRenderer(this.app, this.taskIndex);
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
            if (state.filterFiles) {
                this.viewState.filterFiles = state.filterFiles;
            }
            // Note: startDate is not restored - always use "Today" logic on reload
        }
        await super.setState(state, result);
        this.render();
    }

    getState() {
        // Only save daysToShow, not startDate (startDate resets on reload like Today button)
        const state = {
            daysToShow: this.viewState.daysToShow,
            filterFiles: this.viewState.filterFiles
        };
        return state;
    }

    async onOpen() {
        // Set initial startDate - will be re-evaluated in onChange when tasks are loaded
        const initialToday = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        this.viewState.startDate = DateUtils.addDays(initialToday, -this.plugin.settings.pastDaysToShow);

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
                getFileColor: (filePath) => ViewUtils.getFileColor(this.app, filePath, this.plugin.settings.frontmatterTaskKeys.color),
                getDatesToShow: () => this.getDatesToShow()
            }
        );

        // Initialize Renderers

        // Initialize Renderers
        this.allDayRenderer = new AllDaySectionRenderer(this.taskIndex, this.plugin, this.menuHandler, this.handleManager, this.taskRenderer, () => this.viewState.daysToShow);
        this.timelineRenderer = new TimelineSectionRenderer(this.taskIndex, this.plugin, this.menuHandler, this.handleManager, this.taskRenderer);
        this.gridRenderer = new GridRenderer(this.container, this.viewState, this.plugin, this.menuHandler, this.taskIndex);
        this.deadlineRenderer = new DeadlineListRenderer(this.taskRenderer, this.plugin, this.menuHandler);
        this.habitRenderer = new HabitTrackerRenderer(this.app, this.plugin);

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
                const today = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
                const pastDate = DateUtils.addDays(today, -this.plugin.settings.pastDaysToShow);
                this.viewState.startDate = (oldestOverdue && oldestOverdue < pastDate) ? oldestOverdue : pastDate;
            }

            if (taskId && changes) {
                // 日付/時刻の変更は完全レンダリングが必要（位置変更）
                const layoutKeys = ['startDate', 'startTime', 'endDate', 'endTime', 'deadline'];
                const hasLayoutChange = changes.some(k => layoutKeys.includes(k));

                if (hasLayoutChange) {
                    // レイアウト変更の場合は完全レンダリング
                    this.render();
                    return;
                }

                // コンテンツ/ステータスの変更のみが部分更新で安全
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
        this.registerDomEvent(win, 'keydown', (event: KeyboardEvent) => {
            if (event.key === 'Escape' && this.viewState.showDeadlineList) {
                event.preventDefault();
                this.closeDeadlineList();
            }
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
        const pastDate = DateUtils.addDays(today, -this.plugin.settings.pastDaysToShow);
        this.viewState.startDate = (oldestOverdue && oldestOverdue < pastDate) ? oldestOverdue : pastDate;

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

        this.container.empty();

        // Apply Zoom Level
        const zoomLevel = this.plugin.settings.zoomLevel;
        this.container.style.setProperty('--hour-height', `${60 * zoomLevel}px`);

        // Measure and set actual scrollbar width for grid alignment
        const scrollbarWidth = this.measureScrollbarWidth();
        this.container.style.setProperty('--scrollbar-width-actual', `${scrollbarWidth}px`);

        // Toolbar host (top row)
        const toolbarHost = this.container.createDiv('timeline-view__toolbar-host');

        // Initialize 2-Column Layout (bottom row)
        const layoutContainer = this.container.createDiv('timeline-view__layout');

        // Main Column (Timeline, AllDay)
        const executionColumn = layoutContainer.createDiv('timeline-view__main');
        this.executionColumnEl = executionColumn;

        const backdrop = layoutContainer.createDiv('timeline-view__sidebar-backdrop');
        backdrop.addEventListener('click', () => this.closeDeadlineList());
        this.sidebarBackdropEl = backdrop;

        // Sidebar Column (Deadline List)
        const targetColumn = layoutContainer.createDiv('timeline-view__sidebar');

        const sidebarHeader = targetColumn.createDiv('timeline-view__sidebar-header');
        sidebarHeader.createEl('p', { cls: 'timeline-view__sidebar-title', text: 'Deadline List' });

        const listContainer = targetColumn.createDiv('timeline-view__sidebar-body deadline-list-wrapper');

        const deadlineTasks = this.taskIndex.getDeadlineTasks();
        const visibleFiles = this.viewState.filterFiles ? new Set(this.viewState.filterFiles) : null;
        this.deadlineRenderer.render(listContainer, deadlineTasks, this, visibleFiles);

        this.targetColumnEl = targetColumn;

        // Render Toolbar (above both columns)
        this.toolbar = new TimelineToolbar(
            toolbarHost,
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
                getDatesToShow: () => this.getDatesToShow(),
                onToggleDeadlineList: () => {
                    this.applyDeadlineListVisibility();
                }
            }
        );
        this.toolbar.render();
        this.applyDeadlineListVisibility();

        // Use GridRenderer (render into execution column)
        this.gridRenderer.render(
            executionColumn,
            this.allDayRenderer,
            this.timelineRenderer,
            this.habitRenderer,
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

        // Restore selected task handles AFTER scroll restoration
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

    private applyDeadlineListVisibility(): void {
        const isOpen = this.viewState.showDeadlineList;

        if (this.targetColumnEl) {
            this.targetColumnEl.classList.toggle('timeline-view__sidebar--hidden', !isOpen);
        }
        if (this.executionColumnEl) {
            this.executionColumnEl.classList.toggle('timeline-view__main--sidebar-open', isOpen);
        }
        if (this.sidebarBackdropEl) {
            this.sidebarBackdropEl.classList.toggle('timeline-view__sidebar-backdrop--visible', isOpen);
        }

        this.toolbar?.syncSidebarToggleState();
    }

    private closeDeadlineList(): void {
        if (!this.viewState.showDeadlineList) {
            return;
        }
        this.viewState.showDeadlineList = false;
        this.applyDeadlineListVisibility();
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
        return ViewUtils.getFileColor(this.app, filePath, this.plugin.settings.frontmatterTaskKeys.color);
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
