import { ItemView, WorkspaceLeaf, setIcon, type Workspace } from 'obsidian';
import { ViewUriBuilder } from '../../utils/ViewUriBuilder';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { TaskIndex } from '../../services/core/TaskIndex';
import { Task, ViewState, PinnedListDefinition, isCompleteStatusChar } from '../../types';
import { DragHandler } from '../../interaction/drag/DragHandler';
import { MenuHandler } from '../../interaction/menu/MenuHandler';

import { DateUtils } from '../../utils/DateUtils';

import TaskViewerPlugin from '../../main';

import { HandleManager } from './HandleManager';
import { TimelineToolbar } from './TimelineToolbar';

import { GridRenderer } from './renderers/GridRenderer';
import { AllDaySectionRenderer } from './renderers/AllDaySectionRenderer';
import { TimelineSectionRenderer } from './renderers/TimelineSectionRenderer';
import { PinnedListRenderer } from './renderers/PinnedListRenderer';
import { FilterMenuComponent } from '../filter/FilterMenuComponent';
import { SortMenuComponent } from '../sort/SortMenuComponent';
import { createEmptyFilterState } from '../../services/filter/FilterTypes';
import { createEmptySortState } from '../../services/sort/SortTypes';
import { HabitTrackerRenderer } from './renderers/HabitTrackerRenderer';
import { SidebarManager } from '../sidebar/SidebarManager';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { VIEW_META_TIMELINE } from '../../constants/viewRegistry';

export const VIEW_TYPE_TIMELINE = VIEW_META_TIMELINE.type;

/**
 * Timeline View - Displays tasks on a time-based grid layout.
 * 
 * Structure:
 * - Lifecycle: constructor, onOpen, onClose, refresh
 * - Core Rendering: render, renderCurrentTimeIndicator
 * - Grid & Layout: renderGrid, getDatesToShow, renderTimeLabels
 * - Section Renderers: renderFutureSection, renderLongTermTasks, renderTimedTasks
 * - Color & Styling: applyTaskColor
 * - Task Creation: addCreateTaskListeners, handleCreateTaskTrigger
 */
export class TimelineView extends ItemView {
    private static readonly MOBILE_BREAKPOINT_PX = 768;
    // ==================== Services & Handlers ====================
    private taskIndex: TaskIndex;
    private plugin: TaskViewerPlugin;
    private taskRenderer: TaskCardRenderer;
    private dragHandler: DragHandler;
    private menuHandler: MenuHandler;
    private handleManager: HandleManager;
    private toolbar: TimelineToolbar;
    private sidebarManager: SidebarManager;

    // ==================== Renderers ====================
    private gridRenderer: GridRenderer;
    private allDayRenderer: AllDaySectionRenderer;
    private timelineRenderer: TimelineSectionRenderer;
    private pinnedListRenderer: PinnedListRenderer;
    private sidebarFilterMenu = new FilterMenuComponent();
    private sidebarSortMenu = new SortMenuComponent();
    private habitRenderer: HabitTrackerRenderer;

    // ==================== State ====================
    private container: HTMLElement;
    private viewState: ViewState;
    private unsubscribe: (() => void) | null = null;
    private currentTimeInterval: number | null = null;
    private lastScrollTop: number = 0;
    private hasInitializedStartDate: boolean = false;
    // ==================== Pinch zoom state ====================
    private pinchInitialDistance: number = 0;
    private pinchInitialZoom: number = 1;
    private pinchInitialMidY: number = 0;
    private pinchInitialScrollTop: number = 0;
    private isPinching: boolean = false;

    // ==================== Lifecycle ====================

    constructor(leaf: WorkspaceLeaf, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        super(leaf);
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.viewState = {
            startDate: DateUtils.getVisualDateOfNow(this.plugin.settings.startHour),
            daysToShow: 3,
            showSidebar: true,
            filterFiles: null,
            pinnedLists: [],
        };
        this.sidebarManager = new SidebarManager(true, {
            mobileBreakpointPx: TimelineView.MOBILE_BREAKPOINT_PX,
            onPersist: () => this.app.workspace.requestSaveLayout(),
            onSyncToggleButton: () => this.toolbar?.syncSidebarToggleState(),
        });
        this.taskRenderer = new TaskCardRenderer(this.app, this.taskIndex, {
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            getHoverParent: () => this.leaf,
        });
    }

    getViewType() {
        return VIEW_TYPE_TIMELINE;
    }

    getDisplayText() {
        return this.viewState.customName || VIEW_META_TIMELINE.displayText;
    }

    getIcon() {
        return VIEW_META_TIMELINE.icon;
    }

    async setState(state: any, result: any): Promise<void> {
        if (state) {
            if (typeof state.daysToShow === 'number') {
                this.viewState.daysToShow = state.daysToShow;
            }
            if (typeof state.zoomLevel === 'number') {
                this.viewState.zoomLevel = state.zoomLevel;
            }
            if (typeof state.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.startDate)) {
                this.viewState.startDate = state.startDate;
            }
            if (state.filterState) {
                this.viewState.filterState = state.filterState;
                this.viewState.filterFiles = null;
            } else if (Object.prototype.hasOwnProperty.call(state, 'filterFiles') && Array.isArray(state.filterFiles) && state.filterFiles.length > 0) {
                this.viewState.filterFiles = state.filterFiles;
                this.viewState.filterState = undefined;
            } else {
                this.viewState.filterState = undefined;
                this.viewState.filterFiles = null;
            }
            if (typeof state.showSidebar === 'boolean') {
                this.sidebarManager.setOpen(state.showSidebar, 'setState', {
                    persist: false,
                    animate: false,
                });
                this.viewState.showSidebar = state.showSidebar;
            }
            if (state.pinnedListCollapsed) {
                this.viewState.pinnedListCollapsed = state.pinnedListCollapsed;
            }
            if (Array.isArray(state.pinnedLists)) {
                this.viewState.pinnedLists = state.pinnedLists;
            }
            if (typeof state.customName === 'string' && state.customName.trim()) {
                this.viewState.customName = state.customName;
            } else {
                this.viewState.customName = undefined;
            }
            // Note: startDate is not restored - always use "Today" logic on reload
        }
        await super.setState(state, result);
        this.render();
    }

    getState() {
        const state: Record<string, unknown> = {
            daysToShow: this.viewState.daysToShow,
            showSidebar: this.sidebarManager.isOpen,
        };
        if (this.viewState.pinnedListCollapsed && Object.keys(this.viewState.pinnedListCollapsed).length > 0) {
            state.pinnedListCollapsed = this.viewState.pinnedListCollapsed;
        }
        const lists = this.viewState.pinnedLists;
        if (lists && lists.length > 0) {
            state.pinnedLists = lists;
        }
        if (this.viewState.zoomLevel != null) {
            state.zoomLevel = this.viewState.zoomLevel;
        }
        if (this.viewState.filterState) {
            state.filterState = this.viewState.filterState;
        } else if (this.viewState.filterFiles) {
            state.filterFiles = this.viewState.filterFiles;
        }
        if (this.viewState.customName) {
            state.customName = this.viewState.customName;
        }
        return state;
    }

    async onOpen() {
        // Set initial startDate - will be re-evaluated in onChange when tasks are loaded
        const initialToday = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        this.viewState.startDate = DateUtils.addDays(initialToday, -this.plugin.settings.pastDaysToShow);

        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('timeline-view');
        this.sidebarManager.attach(this.container, (el, ev, handler) =>
            this.registerDomEvent(el as any, ev as any, handler),
        );

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
                getDatesToShow: () => this.getDatesToShow(),
                onRequestSidebarToggle: (nextOpen, source) => {
                    this.sidebarManager.setOpen(nextOpen, source, {
                        persist: true,
                    });
                    this.viewState.showSidebar = nextOpen;
                },
                getLeafPosition: () => ViewUriBuilder.detectLeafPosition(this.leaf, this.app.workspace),
                getCustomName: () => this.viewState.customName,
                onRename: (newName) => {
                    this.viewState.customName = newName;
                    (this.leaf as any).updateHeader();
                    this.app.workspace.requestSaveLayout();
                },
                getLeaf: () => this.leaf,
            }
        );

        // Initialize Renderers
        this.allDayRenderer = new AllDaySectionRenderer(this.taskIndex, this.plugin, this.menuHandler, this.handleManager, this.taskRenderer, () => this.viewState.daysToShow);
        this.timelineRenderer = new TimelineSectionRenderer(this.taskIndex, this.plugin, this.menuHandler, this.handleManager, this.taskRenderer, () => this.getEffectiveZoomLevel());
        this.gridRenderer = new GridRenderer(this.container, this.viewState, this.plugin, this.menuHandler, this.taskIndex);
        this.pinnedListRenderer = new PinnedListRenderer(this.taskRenderer, this.plugin, this.menuHandler, this.taskIndex);
        this.habitRenderer = new HabitTrackerRenderer(this.app, this.plugin);

        // Initialize DragHandler with selection callback, move callback, and view start date provider
        this.dragHandler = new DragHandler(this.container, this.taskIndex, this.plugin,
            (taskId) => {
                this.handleManager.selectTask(taskId);
            },
            () => {
                this.handleManager.updatePositions();
            },
            () => this.viewState.startDate,
            () => this.getEffectiveZoomLevel()
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

        // Ctrl+wheel zoom
        this.registerDomEvent(this.container, 'wheel', (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.25 : -0.25;
            const oldZoom = this.getEffectiveZoomLevel();
            const newZoom = Math.min(10.0, Math.max(0.25, oldZoom + delta));
            if (newZoom === oldZoom) return;

            // Keep the time under cursor stable during zoom when cursor is over scroll area.
            const scrollArea = this.container.querySelector('.timeline-scroll-area') as HTMLElement | null;
            if (scrollArea) {
                const rect = scrollArea.getBoundingClientRect();
                const cursorY = e.clientY - rect.top;
                const isCursorInsideScrollArea = cursorY >= 0 && cursorY <= rect.height;
                if (isCursorInsideScrollArea) {
                    const oldScrollTop = scrollArea.scrollTop;
                    scrollArea.scrollTop = (oldScrollTop + cursorY) * (newZoom / oldZoom) - cursorY;
                }
            }

            this.viewState.zoomLevel = newZoom;
            this.container.style.setProperty('--hour-height', `${60 * newZoom}px`);
            const zoomLabel = this.container.querySelector('.timeline-toolbar__btn--zoom .timeline-toolbar__btn-label');
            if (zoomLabel) {
                zoomLabel.textContent = `${Math.round(newZoom * 100)}%`;
            }
            void this.app.workspace.requestSaveLayout();
        }, { passive: false });

        // Pinch zoom (touch devices)
        this.registerDomEvent(this.container, 'touchstart', (e: TouchEvent) => {
            if (e.touches.length !== 2) return;
            this.isPinching = true;
            this.pinchInitialDistance = this.getTouchDistance(e.touches);
            this.pinchInitialZoom = this.getEffectiveZoomLevel();

            // Capture initial midpoint and scrollTop so scroll correction uses absolute values
            // instead of accumulating per-frame rounding errors.
            const scrollArea = this.container.querySelector('.timeline-scroll-area') as HTMLElement | null;
            if (scrollArea) {
                const rect = scrollArea.getBoundingClientRect();
                this.pinchInitialMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
                this.pinchInitialScrollTop = scrollArea.scrollTop;
            }
        }, { passive: true });

        this.registerDomEvent(this.container, 'touchmove', (e: TouchEvent) => {
            if (!this.isPinching || e.touches.length !== 2) return;
            e.preventDefault();

            const currentDistance = this.getTouchDistance(e.touches);
            if (this.pinchInitialDistance <= 0) return;
            const scale = currentDistance / this.pinchInitialDistance;
            const oldZoom = this.getEffectiveZoomLevel();
            const newZoom = Math.min(10.0, Math.max(0.25, this.pinchInitialZoom * scale));
            if (newZoom === oldZoom) return;

            // Compute scrollTop from initial values (absolute), not from previous frame (relative).
            // This avoids rounding-error accumulation across frames.
            const scrollArea = this.container.querySelector('.timeline-scroll-area') as HTMLElement | null;
            if (scrollArea) {
                const midY = this.pinchInitialMidY;
                if (midY >= 0 && midY <= scrollArea.clientHeight) {
                    scrollArea.scrollTop = (this.pinchInitialScrollTop + midY) * (newZoom / this.pinchInitialZoom) - midY;
                }
            }

            this.viewState.zoomLevel = newZoom;
            this.container.style.setProperty('--hour-height', `${60 * newZoom}px`);
            const zoomLabel = this.container.querySelector('.timeline-toolbar__btn--zoom .timeline-toolbar__btn-label');
            if (zoomLabel) {
                zoomLabel.textContent = `${Math.round(newZoom * 100)}%`;
            }
        }, { passive: false });

        this.registerDomEvent(this.container, 'touchend', (e: TouchEvent) => {
            if (!this.isPinching) return;
            if (e.touches.length < 2) {
                this.isPinching = false;
                void this.app.workspace.requestSaveLayout();
            }
        });
        this.registerDomEvent(this.container, 'touchcancel', () => {
            if (!this.isPinching) return;
            this.isPinching = false;
            void this.app.workspace.requestSaveLayout();
        });

        // Start Current Time Interval
        this.currentTimeInterval = window.setInterval(() => {
            this.renderCurrentTimeIndicator();
        }, 60000); // Every minute

        // Initial render
        this.render();
    }

    async onClose() {
        this.toolbar.closeFilterPopover();
        this.dragHandler.destroy();
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        this.sidebarManager.detach();
        if (this.currentTimeInterval) {
            window.clearInterval(this.currentTimeInterval);
            this.currentTimeInterval = null;
        }
    }

    getEffectiveZoomLevel(): number {
        return this.viewState.zoomLevel ?? this.plugin.settings.zoomLevel;
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
        this.sidebarManager.syncPresentation({ animate: false });

        // Save scroll position
        const scrollArea = this.container.querySelector('.timeline-scroll-area');
        if (scrollArea) {
            this.lastScrollTop = scrollArea.scrollTop;
        }

        this.container.empty();

        // Apply Zoom Level
        const zoomLevel = this.getEffectiveZoomLevel();
        this.container.style.setProperty('--hour-height', `${60 * zoomLevel}px`);

        // Measure and set actual scrollbar width for grid alignment
        const scrollbarWidth = this.measureScrollbarWidth();
        this.container.style.setProperty('--scrollbar-width-actual', `${scrollbarWidth}px`);

        // Toolbar host (top row)
        const toolbarHost = this.container.createDiv('timeline-view__toolbar-host');

        // Build sidebar layout (bottom row)
        const { main, sidebarHeader, sidebarBody } = this.sidebarManager.buildLayout(this.container);

        // Sidebar header content
        sidebarHeader.createEl('p', { cls: 'view-sidebar__title', text: 'Pinned Lists' });

        const addListBtn = sidebarHeader.createEl('button', { cls: 'view-sidebar__add-btn' });
        setIcon(addListBtn, 'plus');
        addListBtn.appendText('Add List');
        addListBtn.addEventListener('click', () => {
            const newId = 'pl-' + Date.now();
            if (!this.viewState.pinnedLists) this.viewState.pinnedLists = [];
            this.viewState.pinnedLists.push({
                id: newId,
                name: 'New List',
                filterState: createEmptyFilterState(),
            });
            this.app.workspace.requestSaveLayout();
            this.pinnedListRenderer.scheduleRename(newId);
            this.render();
        });

        // Render pinned lists into sidebar body
        this.pinnedListRenderer.render(
            sidebarBody,
            this,
            this.viewState.pinnedLists ?? [],
            this.toolbar.getTaskFilter(),
            this.viewState.pinnedListCollapsed ?? {},
            {
                onCollapsedChange: (listId, collapsed) => {
                    if (!this.viewState.pinnedListCollapsed) this.viewState.pinnedListCollapsed = {};
                    this.viewState.pinnedListCollapsed[listId] = collapsed;
                    this.app.workspace.requestSaveLayout();
                },
                onSortEdit: (listDef, anchorEl) => this.openPinnedListSort(listDef, anchorEl),
                onFilterEdit: (listDef, anchorEl) => this.openPinnedListFilter(listDef, anchorEl),
                onDuplicate: (listDef) => {
                    const lists = this.viewState.pinnedLists!;
                    const idx = lists.indexOf(listDef);
                    const dup = {
                        ...listDef,
                        id: 'pl-' + Date.now(),
                        name: listDef.name + ' (copy)',
                        filterState: JSON.parse(JSON.stringify(listDef.filterState)),
                        sortState: listDef.sortState ? JSON.parse(JSON.stringify(listDef.sortState)) : undefined,
                    };
                    lists.splice(idx + 1, 0, dup);
                    this.app.workspace.requestSaveLayout();
                    this.render();
                },
                onRemove: (listDef) => {
                    const lists = this.viewState.pinnedLists!;
                    const idx = lists.indexOf(listDef);
                    if (idx >= 0) lists.splice(idx, 1);
                    this.app.workspace.requestSaveLayout();
                    this.render();
                },
            },
        );

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
                    this.app.workspace.requestSaveLayout();
                },
                getDatesToShow: () => this.getDatesToShow(),
                onRequestSidebarToggle: (nextOpen, source) => {
                    this.sidebarManager.setOpen(nextOpen, source, {
                        persist: true,
                    });
                    this.viewState.showSidebar = nextOpen;
                },
                getLeafPosition: () => ViewUriBuilder.detectLeafPosition(this.leaf, this.app.workspace),
                getCustomName: () => this.viewState.customName,
                onRename: (newName) => {
                    this.viewState.customName = newName;
                    (this.leaf as any).updateHeader();
                    this.app.workspace.requestSaveLayout();
                },
                getLeaf: () => this.leaf,
            }
        );
        this.toolbar.render();
        this.sidebarManager.setOpen(this.viewState.showSidebar, 'render', {
            persist: false,
            animate: false,
        });

        // Use GridRenderer (render into main column)
        this.gridRenderer.render(
            main,
            this.allDayRenderer,
            this.timelineRenderer,
            this.habitRenderer,
            this.handleManager,
            () => this.getDatesToShow(),
            this,
            this.toolbar.getTaskFilter()
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

    private getTouchDistance(touches: TouchList): number {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private openPinnedListSort(listDef: PinnedListDefinition, anchorEl: HTMLElement): void {
        this.sidebarSortMenu.setSortState(listDef.sortState ?? createEmptySortState());
        this.sidebarSortMenu.showMenuAtElement(anchorEl, {
            onSortChange: () => {
                listDef.sortState = this.sidebarSortMenu.getSortState();
                this.app.workspace.requestSaveLayout();
                this.render();
            },
        });
    }

    private openPinnedListFilter(listDef: PinnedListDefinition, anchorEl: HTMLElement): void {
        this.sidebarFilterMenu.setFilterState(listDef.filterState);
        this.sidebarFilterMenu.showMenuAtElement(anchorEl, {
            onFilterChange: () => {
                listDef.filterState = this.sidebarFilterMenu.getFilterState();
                this.app.workspace.requestSaveLayout();
                this.render();
            },
            getTasks: () => this.taskIndex.getTasks(),
        });
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
