import { ItemView, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import { TaskIndex } from '../services/core/TaskIndex';
import { MenuHandler } from '../interaction/menu/MenuHandler';
import { TaskCardRenderer } from './taskcard/TaskCardRenderer';
import { Task, isCompleteStatusChar, PinnedListDefinition } from '../types';
import { DateUtils } from '../utils/DateUtils';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import { TaskIdGenerator } from '../utils/TaskIdGenerator';
import { DragHandler } from '../interaction/drag/DragHandler';
import TaskViewerPlugin from '../main';
import { TaskStyling } from './utils/TaskStyling';
import { DateNavigator, ViewSettingsMenu } from './ViewToolbar';
import { FilterMenuComponent } from './filter/FilterMenuComponent';
import { SortMenuComponent } from './sort/SortMenuComponent';
import { FilterSerializer } from '../services/filter/FilterSerializer';
import { createEmptyFilterState, hasConditions } from '../services/filter/FilterTypes';
import { createEmptySortState } from '../services/sort/SortTypes';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../constants/hover';
import { TaskLinkInteractionManager } from './taskcard/TaskLinkInteractionManager';
import { VIEW_META_CALENDAR } from '../constants/viewRegistry';
import { HandleManager } from './timelineview/HandleManager';
import { SidebarManager } from './sidebar/SidebarManager';
import { PinnedListRenderer } from './timelineview/renderers/PinnedListRenderer';
import { updateSidebarToggleButton } from './sidebar/SidebarToggleButton';

export const VIEW_TYPE_CALENDAR = VIEW_META_CALENDAR.type;

interface CalendarTaskEntry {
    task: Task;
    segmentId: string;
    colStart: number;
    span: number;
    continuesBefore: boolean;
    continuesAfter: boolean;
}

export class CalendarView extends ItemView {
    private readonly taskIndex: TaskIndex;
    private readonly plugin: TaskViewerPlugin;
    private readonly taskRenderer: TaskCardRenderer;
    private readonly linkInteractionManager: TaskLinkInteractionManager;
    private readonly filterMenu = new FilterMenuComponent();
    private readonly sidebarSortMenu = new SortMenuComponent();

    private menuHandler: MenuHandler;
    private dragHandler: DragHandler | null = null;
    private handleManager: HandleManager | null = null;
    private sidebarManager: SidebarManager;
    private pinnedListRenderer: PinnedListRenderer;
    private sidebarFilterMenu = new FilterMenuComponent();
    private syncSidebarToggleBtn: (() => void) | null = null;
    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private windowStart: string;
    private showSidebar = true;
    private pinnedListCollapsed: Record<string, boolean> = {};
    private pinnedLists: PinnedListDefinition[] = [];
    private navigateWeekDebounceTimer: number | null = null;
    private pendingWeekOffset: number = 0;
    private customName: string | undefined;

    constructor(leaf: WorkspaceLeaf, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        super(leaf);
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.taskRenderer = new TaskCardRenderer(this.app, this.taskIndex, {
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            getHoverParent: () => this.leaf,
        });
        this.linkInteractionManager = new TaskLinkInteractionManager(this.app);
        this.sidebarManager = new SidebarManager(true, {
            mobileBreakpointPx: 768,
            onPersist: () => this.app.workspace.requestSaveLayout(),
            onSyncToggleButton: () => this.syncSidebarToggleBtn?.(),
        });
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const weekStart = this.getWeekStart(monthStart, this.plugin.settings.calendarWeekStartDay);
        this.windowStart = DateUtils.getLocalDateString(weekStart);
    }

    getViewType(): string {
        return VIEW_TYPE_CALENDAR;
    }

    getDisplayText(): string {
        return this.customName || VIEW_META_CALENDAR.displayText;
    }

    getIcon(): string {
        return VIEW_META_CALENDAR.icon;
    }

    async setState(state: any, result: any): Promise<void> {
        if (state && typeof state.windowStart === 'string') {
            const parsedWindowStart = this.parseLocalDateString(state.windowStart);
            if (parsedWindowStart) {
                const weekStart = this.getWeekStart(parsedWindowStart, this.plugin.settings.calendarWeekStartDay);
                this.windowStart = DateUtils.getLocalDateString(weekStart);
            }
        } else if (state && typeof state.monthKey === 'string') {
            // Backward compatibility for older saved layout state.
            const monthMatch = state.monthKey.match(/^(\d{4})-(\d{2})$/);
            if (monthMatch) {
                const year = Number(monthMatch[1]);
                const month = Number(monthMatch[2]);
                if (month >= 1 && month <= 12) {
                    const monthStart = new Date(year, month - 1, 1);
                    const weekStart = this.getWeekStart(monthStart, this.plugin.settings.calendarWeekStartDay);
                    this.windowStart = DateUtils.getLocalDateString(weekStart);
                }
            }
        }

        if (state && state.filterState) {
            this.filterMenu.setFilterState(FilterSerializer.fromJSON(state.filterState));
        } else if (state && Object.prototype.hasOwnProperty.call(state, 'filterFiles') && Array.isArray(state.filterFiles) && state.filterFiles.length > 0) {
            const files = state.filterFiles.filter((value: unknown): value is string => typeof value === 'string');
            if (files.length > 0) {
                this.filterMenu.setFilterState({
                    root: {
                        type: 'group',
                        id: 'migrated-file-group',
                        children: [{
                            type: 'condition',
                            id: 'migrated-file',
                            property: 'file',
                            operator: 'includes',
                            value: { type: 'stringSet', values: files },
                        }],
                        logic: 'and',
                    },
                });
            } else {
                this.filterMenu.setFilterState(createEmptyFilterState());
            }
        } else {
            this.filterMenu.setFilterState(createEmptyFilterState());
        }

        if (typeof state?.showSidebar === 'boolean') {
            this.showSidebar = state.showSidebar;
            this.sidebarManager.setOpen(state.showSidebar, 'setState', {
                persist: false, animate: false,
            });
        }
        if (state?.pinnedListCollapsed) {
            this.pinnedListCollapsed = state.pinnedListCollapsed;
        }
        if (Array.isArray(state?.pinnedLists)) {
            this.pinnedLists = state.pinnedLists;
        }
        if (typeof state?.customName === 'string' && state.customName.trim()) {
            this.customName = state.customName;
        } else {
            this.customName = undefined;
        }

        await super.setState(state, result);
        await this.render();
    }

    getState(): Record<string, unknown> {
        const filterState = this.filterMenu.getFilterState();
        const result: Record<string, unknown> = {
            windowStart: this.windowStart,
        };
        if (hasConditions(filterState)) {
            result.filterState = FilterSerializer.toJSON(filterState);
        }
        result.showSidebar = this.sidebarManager.isOpen;
        if (Object.keys(this.pinnedListCollapsed).length > 0) {
            result.pinnedListCollapsed = this.pinnedListCollapsed;
        }
        if (this.pinnedLists.length > 0) {
            result.pinnedLists = this.pinnedLists;
        }
        if (this.customName) {
            result.customName = this.customName;
        }
        return result;
    }

    async onOpen(): Promise<void> {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('calendar-view-container');
        this.sidebarManager.attach(this.container, (el, ev, handler) =>
            this.registerDomEvent(el as any, ev as any, handler),
        );

        this.menuHandler = new MenuHandler(this.app, this.taskIndex, this.plugin);
        this.pinnedListRenderer = new PinnedListRenderer(
            this.taskRenderer, this.plugin, this.menuHandler, this.taskIndex,
        );
        this.handleManager = new HandleManager(this.container, this.taskIndex);
        this.dragHandler = new DragHandler(
            this.container,
            this.taskIndex,
            this.plugin,
            (taskId: string) => {
                this.handleManager?.selectTask(taskId);
            },
            () => {
                this.handleManager?.updatePositions();
            },
            () => this.getViewStartDateString(),
            () => this.plugin.settings.zoomLevel
        );

        this.container.addEventListener('click', (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (target.closest('.task-card__handle-btn')) {
                return;
            }
            if (!target.closest('.task-card')) {
                this.handleManager?.selectTask(null);
            }
        });

        await this.render();

        this.unsubscribe = this.taskIndex.onChange(() => {
            void this.render();
        });
    }

    async onClose(): Promise<void> {
        this.filterMenu.close();
        this.sidebarFilterMenu.close();
        this.sidebarManager.detach();
        if (this.navigateWeekDebounceTimer !== null) {
            window.clearTimeout(this.navigateWeekDebounceTimer);
            this.navigateWeekDebounceTimer = null;
            this.pendingWeekOffset = 0;
        }

        this.dragHandler?.destroy();
        this.dragHandler = null;
        this.handleManager = null;

        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }

    public refresh(): void {
        void this.render();
    }

    private async render(): Promise<void> {
        if (!this.container) {
            return;
        }

        const normalizedWindowStart = this.getNormalizedWindowStart(this.windowStart);
        if (normalizedWindowStart !== this.windowStart) {
            this.windowStart = normalizedWindowStart;
        }

        this.sidebarManager.syncPresentation({ animate: false });
        this.container.empty();

        const toolbar = this.renderToolbar();
        const { main, sidebarHeader, sidebarBody } = this.sidebarManager.buildLayout(this.container);

        this.renderSidebarContent(sidebarHeader, sidebarBody);

        const calendarHost = main.createDiv('calendar-grid');

        this.renderWeekdayHeader(calendarHost);

        const { startDate, endDate } = this.getCalendarDateRange();
        const rangeStartStr = DateUtils.getLocalDateString(startDate);
        const rangeEndStr = DateUtils.getLocalDateString(endDate);
        this.menuHandler.setViewStartDate(rangeStartStr);

        const allVisibleTasks = this.getVisibleTasksInRange(rangeStartStr, rangeEndStr);
        const body = calendarHost.createDiv('calendar-grid__body');
        const referenceMonth = this.getReferenceMonth();
        const showWeekNumbers = this.shouldShowWeekNumbers();

        body.addEventListener('wheel', (e: WheelEvent) => {
            if (e.deltaY === 0) {
                return;
            }

            const atTop = body.scrollTop <= 0;
            const atBottom = body.scrollTop >= body.scrollHeight - body.clientHeight - 1;
            const noScroll = body.scrollHeight <= body.clientHeight + 1;

            if (noScroll || (e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
                e.preventDefault();
                this.navigateWeekDebounced(e.deltaY > 0 ? 1 : -1);
            }
        }, { passive: false });

        let cursor = new Date(startDate);
        while (cursor <= endDate) {
            const weekRow = body.createDiv('calendar-week-row');
            if (showWeekNumbers) {
                weekRow.addClass('has-week-numbers');
            }

            const weekStartDate = new Date(cursor);
            const weekStartStr = DateUtils.getLocalDateString(cursor);
            weekRow.dataset.weekStart = weekStartStr;
            const weekDates: string[] = [];

            if (showWeekNumbers) {
                this.renderWeekNumberCell(weekRow, weekStartDate);
            }

            for (let i = 0; i < 7; i++) {
                const cellDate = new Date(cursor);
                const dateKey = DateUtils.getLocalDateString(cellDate);
                weekDates.push(dateKey);
                this.renderDateHeader(weekRow, cellDate, i + 1, referenceMonth);
                cursor.setDate(cursor.getDate() + 1);
            }

            // Add column separators (skip the outer-right edge).
            const separatorCount = showWeekNumbers ? 7 : 6;
            for (let i = 1; i <= separatorCount; i++) {
                const separator = weekRow.createDiv('calendar-col-separator');
                if (showWeekNumbers) {
                    if (i === 1) {
                        separator.style.left = 'var(--calendar-wk-col-width, 32px)';
                    } else {
                        const dayBoundary = i - 1;
                        separator.style.left = `calc(var(--calendar-wk-col-width, 32px) + (${dayBoundary} / 7) * (100% - var(--calendar-wk-col-width, 32px)))`;
                    }
                } else {
                    separator.style.left = `calc(${i} / 7 * 100%)`;
                }
            }

            await this.renderWeekTasks(weekRow, weekDates, allVisibleTasks);
        }

        toolbar.dataset.range = `${rangeStartStr}:${rangeEndStr}`;

        const selectedTaskId = this.handleManager?.getSelectedTaskId();
        if (selectedTaskId) {
            this.handleManager?.selectTask(selectedTaskId);
        }
    }

    private renderToolbar(): HTMLElement {
        const toolbar = this.container.createDiv('view-toolbar');
        DateNavigator.render(
            toolbar,
            (days) => this.navigateWeek(days),
            () => {
                const today = new Date();
                const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                const weekStart = this.getWeekStart(monthStart, this.plugin.settings.calendarWeekStartDay);
                this.windowStart = DateUtils.getLocalDateString(weekStart);
                void this.app.workspace.requestSaveLayout();
                void this.render();
            },
            { vertical: true }
        );

        toolbar.createDiv('view-toolbar__spacer');

        const filterBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(filterBtn, 'filter');
        filterBtn.setAttribute('aria-label', 'Filter');
        filterBtn.classList.toggle('is-filtered', this.filterMenu.hasActiveFilters());
        filterBtn.addEventListener('click', (event: MouseEvent) => {
            this.filterMenu.showMenu(event, {
                onFilterChange: () => {
                    void this.app.workspace.requestSaveLayout();
                    void this.render();
                    filterBtn.classList.toggle('is-filtered', this.filterMenu.hasActiveFilters());
                },
                getTasks: () => this.taskIndex.getTasks(),
            });
        });

        // View Settings
        ViewSettingsMenu.renderButton(toolbar, {
            app: this.app,
            leaf: this.leaf,
            getCustomName: () => this.customName,
            getDefaultName: () => VIEW_META_CALENDAR.displayText,
            onRename: (newName) => {
                this.customName = newName;
                (this.leaf as any).updateHeader();
                this.app.workspace.requestSaveLayout();
            },
            buildUri: () => ({
                filterState: this.filterMenu.getFilterState(),
                pinnedLists: this.pinnedLists,
                showSidebar: this.sidebarManager.isOpen,
            }),
            viewType: VIEW_META_CALENDAR.type,
        });

        const toggleBtn = toolbar.createEl('button', {
            cls: 'view-toolbar__btn--icon sidebar-toggle-button-icon',
        });
        updateSidebarToggleButton(toggleBtn, this.showSidebar);
        this.syncSidebarToggleBtn = () => updateSidebarToggleButton(toggleBtn, this.sidebarManager.isOpen);
        toggleBtn.onclick = () => {
            const nextOpen = !this.sidebarManager.isOpen;
            this.sidebarManager.setOpen(nextOpen, 'toolbar', { persist: true });
            this.showSidebar = nextOpen;
        };

        return toolbar;
    }

    private renderSidebarContent(header: HTMLElement, body: HTMLElement): void {
        header.createEl('p', { cls: 'view-sidebar__title', text: 'Pinned Lists' });

        const addBtn = header.createEl('button', { cls: 'view-sidebar__add-btn' });
        setIcon(addBtn, 'plus');
        addBtn.appendText('Add List');
        addBtn.addEventListener('click', () => {
            const newId = 'pl-' + Date.now();
            this.pinnedLists.push({
                id: newId,
                name: 'New List',
                filterState: createEmptyFilterState(),
            });
            this.app.workspace.requestSaveLayout();
            this.pinnedListRenderer.scheduleRename(newId);
            void this.render();
        });

        this.pinnedListRenderer.render(body, this, this.pinnedLists,
            (task) => this.filterMenu.isTaskVisible(task),
            this.pinnedListCollapsed, {
            onCollapsedChange: (id, collapsed) => {
                this.pinnedListCollapsed[id] = collapsed;
                this.app.workspace.requestSaveLayout();
            },
            onSortEdit: (listDef, anchorEl) => this.openPinnedListSort(listDef, anchorEl),
            onFilterEdit: (listDef, anchorEl) => this.openPinnedListFilter(listDef, anchorEl),
            onDuplicate: (listDef) => {
                const idx = this.pinnedLists.indexOf(listDef);
                this.pinnedLists.splice(idx + 1, 0, {
                    ...listDef,
                    id: 'pl-' + Date.now(),
                    name: listDef.name + ' (copy)',
                    filterState: JSON.parse(JSON.stringify(listDef.filterState)),
                    sortState: listDef.sortState ? JSON.parse(JSON.stringify(listDef.sortState)) : undefined,
                });
                this.app.workspace.requestSaveLayout();
                void this.render();
            },
            onRemove: (listDef) => {
                const idx = this.pinnedLists.indexOf(listDef);
                if (idx >= 0) this.pinnedLists.splice(idx, 1);
                this.app.workspace.requestSaveLayout();
                void this.render();
            },
        });
    }

    private openPinnedListSort(listDef: PinnedListDefinition, anchorEl: HTMLElement): void {
        this.sidebarSortMenu.setSortState(listDef.sortState ?? createEmptySortState());
        this.sidebarSortMenu.showMenuAtElement(anchorEl, {
            onSortChange: () => {
                listDef.sortState = this.sidebarSortMenu.getSortState();
                this.app.workspace.requestSaveLayout();
                void this.render();
            },
        });
    }

    private openPinnedListFilter(listDef: PinnedListDefinition, anchorEl: HTMLElement): void {
        this.sidebarFilterMenu.setFilterState(listDef.filterState);
        this.sidebarFilterMenu.showMenuAtElement(anchorEl, {
            onFilterChange: () => {
                listDef.filterState = this.sidebarFilterMenu.getFilterState();
                this.app.workspace.requestSaveLayout();
                void this.render();
            },
            getTasks: () => this.taskIndex.getTasks(),
        });
    }

    private renderWeekdayHeader(container: HTMLElement): void {
        const header = container.createDiv('calendar-weekday-header');
        if (this.shouldShowWeekNumbers()) {
            header.addClass('has-week-numbers');
            header.createEl('div', { cls: 'calendar-weekday-cell', text: 'Wk' });
        }

        const weekdays = this.getWeekdayNames();
        weekdays.forEach((label) => {
            header.createEl('div', { cls: 'calendar-weekday-cell', text: label });
        });
    }

    private renderDateHeader(weekRow: HTMLElement, date: Date, colIndex: number, referenceMonth: { year: number; month: number }): void {
        const header = weekRow.createDiv('calendar-date-header');
        const dateKey = DateUtils.getLocalDateString(date);
        const todayKey = DateUtils.getLocalDateString(new Date());
        const isFirstOfMonth = date.getDate() === 1;
        const dateLabel = isFirstOfMonth
            ? dateKey
            : `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

        header.style.gridColumn = `${this.getGridColumnForDay(colIndex)}`;
        header.style.gridRow = '1';
        if (colIndex === 7) {
            header.addClass('is-last-col');
        }

        if (date.getFullYear() !== referenceMonth.year || date.getMonth() !== referenceMonth.month) {
            header.addClass('is-outside-month');
        }
        if (dateKey === todayKey) {
            header.addClass('is-today');
        }

        const linkTarget = DailyNoteUtils.getDailyNoteLinkTarget(this.app, date);
        const dateLink = header.createEl('a', {
            cls: 'internal-link',
            text: dateLabel,
        });
        dateLink.dataset.href = linkTarget;
        dateLink.setAttribute('href', linkTarget);
        dateLink.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
        });

        this.linkInteractionManager.bind(header, {
            sourcePath: '',
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            hoverParent: this.leaf as HoverParent,
        }, { bindClick: false });

        header.addEventListener('click', () => {
            void this.openOrCreateDailyNote(date);
        });
    }

    private async renderWeekTasks(weekRow: HTMLElement, weekDates: string[], allTasks: Task[]): Promise<void> {
        const entries = this.collectWeekTaskEntries(weekDates, allTasks);
        if (entries.length === 0) {
            return;
        }

        const tracks: number[] = [];

        for (const entry of entries) {
            let trackIndex = -1;
            for (let i = 0; i < tracks.length; i++) {
                if (entry.colStart > tracks[i]) {
                    trackIndex = i;
                    break;
                }
            }

            if (trackIndex === -1) {
                trackIndex = tracks.length;
                tracks.push(entry.colStart + entry.span - 1);
            } else {
                tracks[trackIndex] = entry.colStart + entry.span - 1;
            }

            const gridRow = trackIndex + 2;
            await this.renderGridTask(weekRow, entry, gridRow);
        }
    }

    private collectWeekTaskEntries(weekDates: string[], allTasks: Task[]): CalendarTaskEntry[] {
        if (weekDates.length !== 7) {
            return [];
        }

        const weekStart = weekDates[0];
        const weekEnd = weekDates[6];
        const entries: CalendarTaskEntry[] = [];

        for (const task of allTasks) {
            const { effectiveStart, effectiveEnd } = this.getTaskDateRange(task);
            if (!effectiveStart) {
                continue;
            }

            const taskEnd = effectiveEnd || effectiveStart;
            if (effectiveStart > weekEnd || taskEnd < weekStart) {
                continue;
            }

            const clippedStart = effectiveStart < weekStart ? weekStart : effectiveStart;
            const clippedEnd = taskEnd > weekEnd ? weekEnd : taskEnd;

            const colStart = weekDates.indexOf(clippedStart) + 1;
            const colEnd = weekDates.indexOf(clippedEnd) + 1;
            const span = colEnd - colStart + 1;
            if (colStart < 1 || span < 1) {
                continue;
            }

            const isMultiday = this.isMultiDayTask(task);
            const isSplit = isMultiday && (effectiveStart < weekStart || taskEnd > weekEnd);
            const segmentId = isSplit
                ? TaskIdGenerator.makeSegmentId(task.id, clippedStart)
                : task.id;

            entries.push({
                task,
                segmentId,
                colStart,
                span,
                continuesBefore: isMultiday && effectiveStart < weekStart,
                continuesAfter: isMultiday && taskEnd > weekEnd,
            });
        }

        entries.sort((a, b) => {
            if (a.colStart !== b.colStart) return a.colStart - b.colStart;
            if (a.span !== b.span) return b.span - a.span;
            const fileDiff = a.task.file.localeCompare(b.task.file);
            if (fileDiff !== 0) return fileDiff;
            if (a.task.line !== b.task.line) return a.task.line - b.task.line;
            return a.task.id.localeCompare(b.task.id);
        });

        return entries;
    }

    private getVisibleTasksInRange(rangeStart: string, rangeEnd: string): Task[] {
        const allTasks = this.taskIndex.getTasks();
        return allTasks.filter((task) => {
            if (!this.plugin.settings.calendarShowCompleted && this.isTaskCompleted(task)) {
                return false;
            }
            if (!this.filterMenu.isTaskVisible(task)) {
                return false;
            }

            const { effectiveStart, effectiveEnd } = this.getTaskDateRange(task);
            if (!effectiveStart) {
                return false;
            }
            const taskEnd = effectiveEnd || effectiveStart;
            return effectiveStart <= rangeEnd && taskEnd >= rangeStart;
        });
    }

    private getTaskDateRange(task: Task): { effectiveStart: string | null; effectiveEnd: string | null } {
        if (task.startDate) {
            if (task.startTime) {
                const visualDate = DateUtils.getVisualStartDate(
                    task.startDate,
                    task.startTime,
                    this.plugin.settings.startHour
                );
                const isAllDay = DateUtils.isAllDayTask(
                    task.startDate,
                    task.startTime,
                    task.endDate,
                    task.endTime,
                    this.plugin.settings.startHour
                );

                if (isAllDay && task.endDate && task.endDate >= task.startDate) {
                    return { effectiveStart: task.startDate, effectiveEnd: task.endDate };
                }
                return { effectiveStart: visualDate, effectiveEnd: visualDate };
            }

            const effectiveEnd = task.endDate && task.endDate >= task.startDate
                ? task.endDate
                : task.startDate;
            return { effectiveStart: task.startDate, effectiveEnd };
        }

        return { effectiveStart: null, effectiveEnd: null };
    }

    private isMultiDayTask(task: Task): boolean {
        if (!task.startDate) {
            return false;
        }
        if (task.startTime) {
            return DateUtils.isAllDayTask(
                task.startDate,
                task.startTime,
                task.endDate,
                task.endTime,
                this.plugin.settings.startHour
            ) && !!task.endDate && task.endDate > task.startDate;
        }

        return !!task.endDate && task.endDate > task.startDate;
    }

    private async renderGridTask(weekRow: HTMLElement, entry: CalendarTaskEntry, gridRow: number): Promise<void> {
        const isMultiday = this.isMultiDayTask(entry.task);
        const columnOffset = this.getColumnOffset();
        const displayColStart = entry.colStart + columnOffset;

        if (isMultiday) {
            const barEl = weekRow.createDiv('task-card calendar-task-card calendar-multiday-bar');
            barEl.dataset.id = entry.segmentId;
            barEl.addClass('task-card--allday');
            barEl.addClass('task-card--multi-day');
            if (entry.continuesBefore || entry.continuesAfter) {
                barEl.dataset.splitOriginalId = entry.task.id;
            }
            barEl.style.gridColumn = `${displayColStart} / span ${entry.span}`;
            barEl.style.gridRow = `${gridRow}`;

            if (entry.continuesBefore && entry.continuesAfter) {
                barEl.addClass('calendar-multiday-bar--middle');
            } else if (entry.continuesAfter) {
                barEl.addClass('calendar-multiday-bar--head');
            } else if (entry.continuesBefore) {
                barEl.addClass('calendar-multiday-bar--tail');
            }

            TaskStyling.applyTaskColor(barEl, entry.task.color ?? null);
            TaskStyling.applyTaskLinestyle(barEl, entry.task.linestyle ?? null);

            this.menuHandler.addTaskContextMenu(barEl, entry.task);
            await this.taskRenderer.render(barEl, entry.task, this, this.plugin.settings, { topRight: 'none' });
            return;
        }

        const card = weekRow.createDiv('task-card calendar-task-card');
        card.dataset.id = entry.task.id;
        if (!entry.task.startTime) {
            card.addClass('task-card--allday');
        }
        card.style.gridColumn = `${displayColStart} / span ${entry.span}`;
        card.style.gridRow = `${gridRow}`;

        TaskStyling.applyTaskColor(card, entry.task.color ?? null);
        TaskStyling.applyTaskLinestyle(card, entry.task.linestyle ?? null);
        this.menuHandler.addTaskContextMenu(card, entry.task);
        await this.taskRenderer.render(card, entry.task, this, this.plugin.settings);
    }

    private isTaskCompleted(task: Task): boolean {
        let completed = isCompleteStatusChar(task.statusChar || ' ', this.plugin.settings.completeStatusChars);
        if (!completed || task.childLines.length === 0) {
            return completed;
        }

        for (const childLine of task.childLines) {
            const match = childLine.match(/^\s*-\s*\[(.)\]/);
            if (match && !isCompleteStatusChar(match[1], this.plugin.settings.completeStatusChars)) {
                completed = false;
                break;
            }
        }

        return completed;
    }

    private getViewStartDateString(): string {
        const { startDate } = this.getCalendarDateRange();
        return DateUtils.getLocalDateString(startDate);
    }

    private getCalendarDateRange(): { startDate: Date; endDate: Date } {
        const parsedStart = this.parseLocalDateString(this.windowStart);
        const fallbackStart = this.getWeekStart(new Date(), this.plugin.settings.calendarWeekStartDay);
        const startDate = this.getWeekStart(parsedStart ?? fallbackStart, this.plugin.settings.calendarWeekStartDay);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 41);
        return { startDate, endDate };
    }

    private getWeekStart(date: Date, weekStartDay: 0 | 1): Date {
        const day = date.getDay();
        const diff = (day - weekStartDay + 7) % 7;
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() - diff);
    }

    private getWeekdayNames(): string[] {
        const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        if (this.plugin.settings.calendarWeekStartDay === 1) {
            return [...labels.slice(1), labels[0]];
        }
        return labels;
    }

    private shouldShowWeekNumbers(): boolean {
        return this.plugin.settings.calendarShowWeekNumbers;
    }

    private getColumnOffset(): number {
        return this.shouldShowWeekNumbers() ? 1 : 0;
    }

    private getGridColumnForDay(dayColumn: number): number {
        return dayColumn + this.getColumnOffset();
    }

    private renderWeekNumberCell(weekRow: HTMLElement, weekStartDate: Date): void {
        const weekNumberEl = weekRow.createDiv('calendar-week-number');
        const weekNumber = DateUtils.getISOWeekNumber(weekStartDate);

        const todayWeekStart = this.getWeekStart(new Date(), this.plugin.settings.calendarWeekStartDay);
        if (DateUtils.getLocalDateString(weekStartDate) === DateUtils.getLocalDateString(todayWeekStart)) {
            weekNumberEl.addClass('is-current-week');
        }

        const weekLinkTarget = DailyNoteUtils.getWeeklyNoteLinkTarget(this.plugin.settings, weekStartDate);
        const weekLink = weekNumberEl.createEl('a', {
            cls: 'internal-link',
            text: `W${String(weekNumber).padStart(2, '0')}`,
        });
        weekLink.dataset.href = weekLinkTarget;
        weekLink.setAttribute('href', weekLinkTarget);
        weekLink.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
        });
        this.linkInteractionManager.bind(weekNumberEl, {
            sourcePath: '',
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            hoverParent: this.leaf as HoverParent,
        }, { bindClick: false });
        weekNumberEl.addEventListener('click', () => {
            void this.openOrCreatePeriodicNote(weekStartDate);
        });
    }

    private getReferenceMonth(): { year: number; month: number } {
        const midDate = this.parseLocalDateString(DateUtils.addDays(this.windowStart, 20));
        const fallback = this.parseLocalDateString(this.windowStart) ?? new Date();
        const date = midDate ?? fallback;
        return { year: date.getFullYear(), month: date.getMonth() };
    }

    private navigateWeek(offset: number): void {
        this.windowStart = DateUtils.addDays(this.windowStart, offset * 7);
        void this.app.workspace.requestSaveLayout();
        void this.render();
    }

    private navigateWeekDebounced(offset: number): void {
        this.pendingWeekOffset = offset;
        if (this.navigateWeekDebounceTimer !== null) {
            window.clearTimeout(this.navigateWeekDebounceTimer);
        }
        this.navigateWeekDebounceTimer = window.setTimeout(() => {
            this.navigateWeekDebounceTimer = null;
            const nextOffset = this.pendingWeekOffset;
            this.pendingWeekOffset = 0;
            this.navigateWeek(nextOffset);
        }, 200);
    }

    private parseLocalDateString(value: string): Date | null {
        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) {
            return null;
        }

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
            return null;
        }

        const parsed = new Date(year, month - 1, day);
        if (
            parsed.getFullYear() !== year ||
            parsed.getMonth() !== month - 1 ||
            parsed.getDate() !== day
        ) {
            return null;
        }

        return parsed;
    }

    private getNormalizedWindowStart(value: string): string {
        const parsed = this.parseLocalDateString(value);
        const baseDate = parsed ?? new Date();
        const weekStart = this.getWeekStart(baseDate, this.plugin.settings.calendarWeekStartDay);
        return DateUtils.getLocalDateString(weekStart);
    }

    private async openOrCreateDailyNote(date: Date): Promise<void> {
        let file = DailyNoteUtils.getDailyNote(this.app, date);
        if (!file) {
            file = await DailyNoteUtils.createDailyNote(this.app, date);
        }
        if (file) {
            await this.app.workspace.getLeaf(false).openFile(file);
        }
    }

    private async openOrCreatePeriodicNote(date: Date): Promise<void> {
        const settings = this.plugin.settings;
        let file: TFile | null = DailyNoteUtils.getWeeklyNote(this.app, settings, date);
        if (!file) {
            file = await DailyNoteUtils.createWeeklyNote(this.app, settings, date);
        }
        if (file) {
            await this.app.workspace.getLeaf(false).openFile(file);
        }
    }
}
