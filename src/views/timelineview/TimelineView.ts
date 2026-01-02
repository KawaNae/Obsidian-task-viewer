import { ItemView, WorkspaceLeaf } from 'obsidian';
import { TaskRenderer } from '../TaskRenderer';
import { TaskIndex } from '../../services/TaskIndex';
import { Task, ViewState } from '../../types';
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
import { FutureSectionRenderer } from './renderers/FutureSectionRenderer';

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
    private futureRenderer: FutureSectionRenderer;

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
                getFileColor: (filePath) => ViewUtils.getFileColor(this.app, filePath, this.plugin.settings.frontmatterColorKey),
                getDatesToShow: () => this.getDatesToShow()
            }
        );

        // Initialize Renderers
        this.futureRenderer = new FutureSectionRenderer(this.taskIndex, this.plugin, this.menuHandler, this.handleManager, this.taskRenderer);
        this.allDayRenderer = new AllDaySectionRenderer(this.taskIndex, this.plugin, this.menuHandler, this.handleManager, this.taskRenderer, () => this.viewState.daysToShow);
        this.timelineRenderer = new TimelineSectionRenderer(this.taskIndex, this.plugin, this.menuHandler, this.handleManager, this.taskRenderer);
        this.gridRenderer = new GridRenderer(this.container, this.viewState, this.plugin, this.menuHandler);

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
        const futureSection = this.container.querySelector('.future-section-grid');
        const allDayRow = this.container.querySelector('.allday-section');
        const wasFutureCollapsed = futureSection?.hasClass('collapsed') || false;
        const wasAllDayCollapsed = allDayRow?.hasClass('collapsed') || false;

        this.container.empty();

        // Apply Zoom Level
        const zoomLevel = this.plugin.settings.zoomLevel;
        this.container.style.setProperty('--hour-height', `${60 * zoomLevel}px`);

        this.toolbar.render();

        // Use GridRenderer
        this.gridRenderer.render(
            this.futureRenderer,
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
        const newFutureSection = this.container.querySelector('.future-section-grid');
        const newAllDayRow = this.container.querySelector('.allday-section');

        if (wasFutureCollapsed && newFutureSection) {
            newFutureSection.addClass('collapsed');
            const toggleBtn = newFutureSection.querySelector('.section-toggle-btn');
            if (toggleBtn) toggleBtn.setText('+');
        }

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


    // ==================== Task Creation ====================
}
