import { ItemView, WorkspaceLeaf, TFile, Notice, setIcon, type ViewStateResult } from 'obsidian';
import type { MenuItem } from 'obsidian';
import { t } from '../../i18n';
import { DisplayTask, Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import type { TaskReadService } from '../../services/data/TaskReadService';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import {
    isTaskCompleted as isTaskCompletedUtil,
    parseLocalDateString,
    getCalendarDateRange,
    getWeekStart,
    getNormalizedWindowStart,
    getReferenceMonth,
    getColumnOffset,
    getGridColumnForDay,
    openOrCreateDailyNote,
} from './CalendarDateUtils';
import TaskViewerPlugin from '../../main';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { VIEW_META_MINI_CALENDAR } from '../../constants/viewRegistry';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { FilterSerializer } from '../../services/filter/FilterSerializer';
import { createEmptyFilterState, hasConditions } from '../../services/filter/FilterTypes';
import { ViewUriBuilder, type LeafPosition, type ViewUriOptions } from '../sharedLogic/ViewUriBuilder';
import { ViewTemplateLoader } from '../../services/template/ViewTemplateLoader';
import { ViewTemplateWriter } from '../../services/template/ViewTemplateWriter';
import { InputModal } from '../../modals/InputModal';
import { MiniCalendarToolbar } from './MiniCalendarToolbar';

export const VIEW_TYPE_MINI_CALENDAR = VIEW_META_MINI_CALENDAR.type;

interface IndicatorState {
    hasIncomplete: boolean;
    hasComplete: boolean;
}

interface MiniCalendarViewState {
    windowStart?: string;
    monthKey?: string;
    filterState?: unknown;
    customName?: string;
}

export class MiniCalendarView extends ItemView {
    private readonly plugin: TaskViewerPlugin;
    private readonly readService: TaskReadService;
    private readonly linkInteractionManager: TaskLinkInteractionManager;
    private readonly filterMenu = new FilterMenuComponent();
    private readonly toolbar: MiniCalendarToolbar;

    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private windowStart: string;
    private customName: string | undefined;
    private isAnimating: boolean = false;
    private navigateWeekDebounceTimer: number | null = null;
    private pendingWeekOffset: number = 0;
    private readonly hoverParent = new TaskViewHoverParent();

    constructor(leaf: WorkspaceLeaf, plugin: TaskViewerPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.readService = this.plugin.getTaskReadService();
        this.linkInteractionManager = new TaskLinkInteractionManager(this.app, () => this.plugin.settings);

        this.filterMenu.setStartHourProvider(() => this.plugin.settings.startHour);
        this.filterMenu.setTaskLookupProvider((id) => this.readService.getTask(id));
        this.filterMenu.setStatusDefinitions(this.plugin.settings.statusDefinitions);

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const weekStart = this.getWeekStart(monthStart, this.plugin.settings.calendarWeekStartDay);
        this.windowStart = DateUtils.getLocalDateString(weekStart);

        this.toolbar = new MiniCalendarToolbar({
            app: this.app,
            leaf: this.leaf,
            plugin: this.plugin,
            filterMenu: this.filterMenu,
            linkInteractionManager: this.linkInteractionManager,
            hoverParent: this.hoverParent,
            getReferenceMonth: () => this.getReferenceMonth(),
            onNavigateWeek: (direction) => this.navigateWeek(direction),
            onJumpToCurrentMonth: () => {
                if (this.isAnimating) return;
                const today = new Date();
                const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                const weekStart = this.getWeekStart(monthStart, this.plugin.settings.calendarWeekStartDay);
                this.windowStart = DateUtils.getLocalDateString(weekStart);
                void this.app.workspace.requestSaveLayout();
                void this.render();
            },
            onOpenPeriodicNote: (kind, date) => this.openOrCreatePeriodicNote(kind, date),
            onShowSettingsMenu: (e, anchor) => this.showSettingsMenu(e, anchor),
        });
    }

    getViewType(): string {
        return VIEW_TYPE_MINI_CALENDAR;
    }

    getDisplayText(): string {
        return this.customName || VIEW_META_MINI_CALENDAR.displayText;
    }

    getIcon(): string {
        return VIEW_META_MINI_CALENDAR.icon;
    }

    async setState(state: MiniCalendarViewState, result: ViewStateResult): Promise<void> {
        if (state && typeof state.windowStart === 'string') {
            const parsedWindowStart = this.parseLocalDateString(state.windowStart);
            if (parsedWindowStart) {
                const weekStart = this.getWeekStart(parsedWindowStart, this.plugin.settings.calendarWeekStartDay);
                this.windowStart = DateUtils.getLocalDateString(weekStart);
            }
        }

        if (state?.filterState) {
            this.filterMenu.setFilterState(FilterSerializer.fromJSON(state.filterState));
        } else {
            this.filterMenu.setFilterState(createEmptyFilterState());
        }
        if (typeof state?.customName === 'string' && state.customName.trim()) {
            this.customName = state.customName;
        }

        await super.setState(state, result);
        await this.render();
    }

    getState(): Record<string, unknown> {
        const result: Record<string, unknown> = {
            windowStart: this.windowStart,
        };
        const filterState = this.filterMenu.getFilterState();
        if (hasConditions(filterState)) {
            result.filterState = FilterSerializer.toJSON(filterState);
        }
        if (this.customName) {
            result.customName = this.customName;
        }
        return result;
    }

    async onOpen(): Promise<void> {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('mini-calendar-view');

        await this.render();

        this.unsubscribe = this.readService.onChange(() => {
            void this.render();
        });
    }

    async onClose(): Promise<void> {
        this.hoverParent.dispose();
        this.filterMenu.close();
        if (this.navigateWeekDebounceTimer !== null) {
            window.clearTimeout(this.navigateWeekDebounceTimer);
            this.navigateWeekDebounceTimer = null;
            this.pendingWeekOffset = 0;
        }
        this.isAnimating = false;

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

        this.isAnimating = false;

        const normalizedWindowStart = this.getNormalizedWindowStart(this.windowStart);
        if (normalizedWindowStart !== this.windowStart) {
            this.windowStart = normalizedWindowStart;
        }

        this.toolbar.detach();
        this.container.empty();

        const toolbarHost = this.container.createDiv('mini-calendar-view__toolbar-host');
        this.toolbar.mount(toolbarHost);

        const grid = this.container.createDiv('mini-calendar-grid');
        this.renderWeekdayHeader(grid);

        const body = grid.createDiv('mini-calendar-body');
        const track = body.createDiv('mini-calendar-body__track');
        body.addEventListener('wheel', (e: WheelEvent) => {
            if (e.deltaY === 0) {
                return;
            }
            e.preventDefault();
            this.navigateWeekDebounced(e.deltaY > 0 ? 1 : -1);
        }, { passive: false });

        const { startDate, endDate } = this.getCalendarDateRange();
        const rangeStartStr = DateUtils.getLocalDateString(startDate);
        const rangeEndStr = DateUtils.getLocalDateString(endDate);
        const indicators = this.computeIndicators(rangeStartStr, rangeEndStr);
        const referenceMonth = this.getReferenceMonth();
        const showWeekNumbers = this.shouldShowWeekNumbers();

        const cursor = new Date(startDate);
        for (let weekIndex = 0; weekIndex < 6; weekIndex++) {
            const weekStartDate = new Date(cursor);
            const weekEl = track.createDiv('mini-calendar-week');
            if (showWeekNumbers) {
                weekEl.addClass('has-week-numbers');
                this.renderWeekNumberCell(weekEl, weekStartDate);
            }
            for (let colIndex = 1; colIndex <= 7; colIndex++) {
                const date = new Date(cursor);
                const dateKey = DateUtils.getLocalDateString(date);
                this.renderCell(
                    weekEl,
                    date,
                    dateKey,
                    colIndex,
                    referenceMonth,
                    indicators.get(dateKey) ?? { hasIncomplete: false, hasComplete: false }
                );
                cursor.setDate(cursor.getDate() + 1);
            }
        }
    }

    private renderWeekdayHeader(grid: HTMLElement): void {
        const header = grid.createDiv('mini-calendar-weekday-header');
        if (this.shouldShowWeekNumbers()) {
            header.addClass('has-week-numbers');
            header.createDiv({ cls: 'mini-calendar-weekday-cell', text: t('calendar.w') });
        }
        const weekdays = this.getWeekdayNames();
        weekdays.forEach((label) => {
            header.createDiv({ cls: 'mini-calendar-weekday-cell', text: label });
        });
    }

    private renderCell(
        weekEl: HTMLElement,
        date: Date,
        dateKey: string,
        colIndex: number,
        referenceMonth: { year: number; month: number },
        indicatorState: IndicatorState = { hasIncomplete: false, hasComplete: false },
    ): void {
        const cell = weekEl.createDiv('mini-calendar-cell');
        cell.style.gridColumn = `${this.getGridColumnForDay(colIndex)}`;
        cell.dataset.date = dateKey;

        if (date.getFullYear() !== referenceMonth.year || date.getMonth() !== referenceMonth.month) {
            cell.addClass('is-outside-month');
        }
        if (dateKey === DateUtils.getToday()) {
            cell.addClass('is-today');
        }

        const linkTarget = DailyNoteUtils.getDailyNoteLinkTarget(this.app, date);
        const link = cell.createEl('a', {
            cls: 'internal-link mini-calendar-cell__link',
        });
        link.dataset.href = linkTarget;
        link.setAttribute('href', linkTarget);
        link.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
        });

        link.createSpan({
            cls: 'mini-calendar-cell__date',
            text: String(date.getDate()),
        });

        const indicatorRow = link.createDiv({ cls: 'mini-calendar-cell__indicators' });
        if (indicatorState.hasIncomplete) {
            indicatorRow.createSpan({
                cls: 'mini-calendar-cell__indicator mini-calendar-cell__indicator--incomplete'
            });
        }
        if (indicatorState.hasComplete) {
            indicatorRow.createSpan({
                cls: 'mini-calendar-cell__indicator mini-calendar-cell__indicator--complete'
            });
        }

        this.linkInteractionManager.bind(cell, {
            sourcePath: '',
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            hoverParent: this.hoverParent,
        }, { bindClick: false });

        cell.addEventListener('click', () => {
            void this.openOrCreateDailyNote(date);
        });
    }

    private computeIndicators(rangeStart: string, rangeEnd: string): Map<string, IndicatorState> {
        const indicatorMap = new Map<string, IndicatorState>();
        const filterState = this.filterMenu.getFilterState();
        const filter = hasConditions(filterState) ? filterState : undefined;

        let dateCursor = rangeStart;
        while (dateCursor <= rangeEnd) {
            const tasks = this.readService.getTasksForDateRange(dateCursor, dateCursor, filter);
            if (tasks.length > 0) {
                let hasIncomplete = false;
                let hasComplete = false;
                for (const dt of tasks) {
                    if (this.isTaskCompleted(dt)) {
                        hasComplete = true;
                    } else {
                        hasIncomplete = true;
                    }
                    if (hasIncomplete && hasComplete) break;
                }
                indicatorMap.set(dateCursor, { hasIncomplete, hasComplete });
            }
            dateCursor = DateUtils.addDays(dateCursor, 1);
        }

        return indicatorMap;
    }

    private isTaskCompleted(task: DisplayTask): boolean {
        return isTaskCompletedUtil(task, this.plugin.settings.statusDefinitions, this.readService);
    }

    private getCalendarDateRange(): { startDate: Date; endDate: Date } {
        return getCalendarDateRange(this.windowStart, this.plugin.settings.calendarWeekStartDay);
    }

    private getWeekStart(date: Date, weekStartDay: 0 | 1): Date {
        return getWeekStart(date, weekStartDay);
    }

    private getWeekdayNames(): string[] {
        const labels = t('calendar.weekdaysNarrow').split(',');
        if (this.plugin.settings.calendarWeekStartDay === 1) {
            return [...labels.slice(1), labels[0]];
        }
        return labels;
    }

    private shouldShowWeekNumbers(): boolean {
        return this.plugin.settings.calendarShowWeekNumbers;
    }

    private getColumnOffset(): number {
        return getColumnOffset(this.shouldShowWeekNumbers());
    }

    private getGridColumnForDay(dayColumn: number): number {
        return getGridColumnForDay(dayColumn, this.shouldShowWeekNumbers());
    }

    private renderWeekNumberCell(weekEl: HTMLElement, weekStartDate: Date): void {
        const weekNumberEl = weekEl.createDiv('mini-calendar-week-number');
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
            hoverParent: this.hoverParent,
        }, { bindClick: false });
        weekNumberEl.addEventListener('click', () => {
            void this.openOrCreatePeriodicNote('weekly', weekStartDate);
        });
    }

    private getReferenceMonth(): { year: number; month: number } {
        return getReferenceMonth(this.windowStart);
    }

    private navigateWeek(offset: number): void {
        if (offset === 0 || this.isAnimating) {
            return;
        }

        this.windowStart = DateUtils.addDays(this.windowStart, offset * 7);
        void this.app.workspace.requestSaveLayout();
        this.updateToolbarMonthLabel();

        const body = this.container?.querySelector('.mini-calendar-body');
        if (!(body instanceof HTMLElement)) {
            void this.render();
            return;
        }

        this.animateWeekSlide(body, offset);
    }

    private navigateWeekDebounced(offset: number): void {
        if (this.isAnimating) {
            return;
        }
        this.pendingWeekOffset = offset;
        if (this.navigateWeekDebounceTimer !== null) {
            window.clearTimeout(this.navigateWeekDebounceTimer);
        }
        this.navigateWeekDebounceTimer = window.setTimeout(() => {
            this.navigateWeekDebounceTimer = null;
            const nextOffset = this.pendingWeekOffset;
            this.pendingWeekOffset = 0;
            if (!this.isAnimating) {
                requestAnimationFrame(() => this.navigateWeek(nextOffset));
            }
        }, 50);
    }

    private parseLocalDateString(value: string): Date | null {
        return parseLocalDateString(value);
    }

    private getNormalizedWindowStart(value: string): string {
        return getNormalizedWindowStart(value, this.plugin.settings.calendarWeekStartDay);
    }

    private updateToolbarMonthLabel(): void {
        const referenceMonth = this.getReferenceMonth();
        const now = new Date();
        const isCurrentYear = referenceMonth.year === now.getFullYear();
        const isCurrentMonth = isCurrentYear && referenceMonth.month === now.getMonth();

        const monthEl = this.container?.querySelector('.mini-calendar-toolbar__month');
        const yearEl = this.container?.querySelector('.mini-calendar-toolbar__year');

        if (monthEl instanceof HTMLElement) {
            const monthLink = monthEl.querySelector('.internal-link');
            if (monthLink) {
                monthLink.textContent = String(referenceMonth.month + 1).padStart(2, '0');
            }
            monthEl.toggleClass('is-current', isCurrentMonth);
        }

        if (yearEl instanceof HTMLElement) {
            const yearLink = yearEl.querySelector('.internal-link');
            if (yearLink) {
                yearLink.textContent = `${referenceMonth.year}`;
            }
            yearEl.toggleClass('is-current', isCurrentYear);
        }
    }
    private animateWeekSlide(body: HTMLElement, offset: number): void {
        const track = body.querySelector('.mini-calendar-body__track');
        if (!(track instanceof HTMLElement)) {
            void this.render();
            return;
        }

        const weekRows = Array.from(track.querySelectorAll('.mini-calendar-week'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement);
        if (weekRows.length !== 6) {
            void this.render();
            return;
        }

        const rowHeight = body.clientHeight / 6;
        if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
            void this.render();
            return;
        }

        const { startDate, endDate } = this.getCalendarDateRange();
        const indicators = this.computeIndicators(
            DateUtils.getLocalDateString(startDate),
            DateUtils.getLocalDateString(endDate)
        );
        const referenceMonth = this.getReferenceMonth();

        weekRows.forEach((row) => {
            row.style.height = `${rowHeight}px`;
            row.style.flex = 'none';
        });

        const finalize = () => {
            track.style.transition = '';
            track.style.transform = '';
            track.style.willChange = '';
            track.querySelectorAll('.mini-calendar-week').forEach((row) => {
                if (row instanceof HTMLElement) {
                    row.style.height = '';
                    row.style.flex = '';
                }
            });
            this.isAnimating = false;
            void this.render();
        };

        this.isAnimating = true;

        if (offset > 0) {
            const incomingWeekStart = DateUtils.addDays(this.windowStart, 35);
            const incomingWeek = this.createWeekRow(incomingWeekStart, indicators, referenceMonth, rowHeight);
            track.appendChild(incomingWeek);
            track.style.transform = 'translateY(0)';
            void track.offsetHeight;
            track.style.transition = 'transform 150ms ease-out';
            track.style.willChange = 'transform';
            track.style.transform = `translateY(-${rowHeight}px)`;
            track.addEventListener('transitionend', () => {
                const firstWeek = track.querySelector('.mini-calendar-week');
                if (firstWeek instanceof HTMLElement) {
                    firstWeek.remove();
                }
                finalize();
            }, { once: true });
            return;
        }

        const incomingWeekStart = this.windowStart;
        const incomingWeek = this.createWeekRow(incomingWeekStart, indicators, referenceMonth, rowHeight);
        track.insertBefore(incomingWeek, track.firstChild);
        track.style.transform = `translateY(-${rowHeight}px)`;
        track.style.willChange = 'transform';
        void track.offsetHeight;
        track.style.transition = 'transform 150ms ease-out';
        track.style.transform = 'translateY(0)';
        track.addEventListener('transitionend', () => {
            const currentWeeks = track.querySelectorAll('.mini-calendar-week');
            const lastWeek = currentWeeks.item(currentWeeks.length - 1);
            if (lastWeek instanceof HTMLElement) {
                lastWeek.remove();
            }
            finalize();
        }, { once: true });
    }

    private createWeekRow(
        weekStart: string,
        indicators: Map<string, IndicatorState>,
        referenceMonth: { year: number; month: number },
        rowHeight: number,
    ): HTMLElement {
        const weekEl = document.createElement('div');
        weekEl.addClass('mini-calendar-week');
        if (this.shouldShowWeekNumbers()) {
            weekEl.addClass('has-week-numbers');
        }
        weekEl.style.height = `${rowHeight}px`;
        weekEl.style.flex = 'none';

        const startDate = this.parseLocalDateString(weekStart);
        if (!startDate) {
            return weekEl;
        }

        if (this.shouldShowWeekNumbers()) {
            this.renderWeekNumberCell(weekEl, startDate);
        }

        const cursor = new Date(startDate);
        for (let colIndex = 1; colIndex <= 7; colIndex++) {
            const date = new Date(cursor);
            const dateKey = DateUtils.getLocalDateString(date);
            this.renderCell(
                weekEl,
                date,
                dateKey,
                colIndex,
                referenceMonth,
                indicators.get(dateKey) ?? { hasIncomplete: false, hasComplete: false }
            );
            cursor.setDate(cursor.getDate() + 1);
        }

        return weekEl;
    }

    private showSettingsMenu(e: MouseEvent, moreBtn: HTMLElement): void {
        this.plugin.menuPresenter.present((menu) => {
        // Filter
        menu.addItem((item: MenuItem) => {
            const title = this.filterMenu.hasActiveFilters()
                ? t('toolbar.filter') + ' \u2713'
                : t('toolbar.filter');
            item.setTitle(title)
                .setIcon('filter')
                .onClick(() => {
                    this.filterMenu.showMenuAtElement(moreBtn, {
                        onFilterChange: () => {
                            void this.app.workspace.requestSaveLayout();
                            void this.render();
                        },
                        getTasks: () => this.readService.getTasks(),
                        getStartHour: () => this.plugin.settings.startHour,
                    });
                });
        });

        menu.addSeparator();

        // Save view
        const folder = this.plugin.settings.viewTemplateFolder;
        menu.addItem((item: MenuItem) => {
            item.setTitle(t('toolbar.saveView'))
                .setIcon('save')
                .onClick(() => {
                    if (!folder) {
                        new Notice(t('notice.setViewTemplateFolder'));
                        return;
                    }
                    const defaultName = this.customName || VIEW_META_MINI_CALENDAR.displayText;
                    new InputModal(
                        this.app,
                        t('toolbar.saveViewTitle'),
                        t('toolbar.saveViewLabel'),
                        defaultName,
                        async (value) => {
                            const name = value.trim();
                            if (!name) return;
                            const writer = new ViewTemplateWriter(this.app);
                            await writer.saveTemplate(folder, {
                                filePath: '',
                                name,
                                viewType: 'calendar',
                                filterState: this.filterMenu.getFilterState(),
                            });
                            this.customName = name;
                            this.leaf.updateHeader();
                            this.app.workspace.requestSaveLayout();
                            new Notice(t('notice.viewSaved', { name }));
                        },
                    ).open();
                });
        });

        // Load view
        menu.addItem((item: MenuItem) => {
            item.setTitle(t('toolbar.loadView'))
                .setIcon('folder-open');

            if (!folder) {
                item.setSubmenu().addItem((sub: MenuItem) =>
                    sub.setTitle(t('toolbar.noFolderConfigured')).setDisabled(true));
            } else {
                const loader = new ViewTemplateLoader(this.app);
                const summaries = loader.loadTemplates(folder)
                    .filter(s => s.viewType === 'calendar');

                const submenu = item.setSubmenu();
                if (summaries.length === 0) {
                    submenu.addItem((sub: MenuItem) =>
                        sub.setTitle(t('toolbar.noTemplatesFound')).setDisabled(true));
                } else {
                    for (const summary of summaries) {
                        submenu.addItem((sub: MenuItem) => {
                            sub.setTitle(summary.name)
                                .onClick(async () => {
                                    const full = await loader.loadFullTemplate(summary.filePath);
                                    if (!full) {
                                        new Notice(t('notice.failedToLoadTemplate'));
                                        return;
                                    }
                                    if (full.filterState) {
                                        this.filterMenu.setFilterState(full.filterState);
                                    } else {
                                        this.filterMenu.setFilterState(createEmptyFilterState());
                                    }
                                    if (full.name) {
                                        this.customName = full.name;
                                        this.leaf.updateHeader();
                                    }
                                    void this.app.workspace.requestSaveLayout();
                                    void this.render();
                                });
                        });
                    }
                }
            }
        });

        // Reset view
        menu.addItem((item: MenuItem) => {
            item.setTitle(t('toolbar.resetView'))
                .setIcon('rotate-ccw')
                .onClick(() => {
                    this.filterMenu.setFilterState(createEmptyFilterState());
                    this.customName = undefined;
                    this.leaf.updateHeader();
                    void this.app.workspace.requestSaveLayout();
                    void this.render();
                });
        });

        menu.addSeparator();

        // Copy URI
        menu.addItem((item: MenuItem) => {
            item.setTitle(t('toolbar.copyUri'))
                .setIcon('link')
                .onClick(async () => {
                    const uri = ViewUriBuilder.build(VIEW_META_MINI_CALENDAR.type, this.buildUriOptions(folder));
                    await navigator.clipboard.writeText(uri);
                    new Notice(t('notice.uriCopied'));
                });
        });

        // Copy as link
        menu.addItem((item: MenuItem) => {
            item.setTitle(t('toolbar.copyAsLink'))
                .setIcon('external-link')
                .onClick(async () => {
                    const uri = ViewUriBuilder.build(VIEW_META_MINI_CALENDAR.type, this.buildUriOptions(folder));
                    const displayName = this.customName || VIEW_META_MINI_CALENDAR.displayText;
                    const link = `[${displayName}](${uri})`;
                    await navigator.clipboard.writeText(link);
                    new Notice(t('notice.linkCopied'));
                });
        });

        menu.addSeparator();

        // Position (read-only)
        menu.addItem((item: MenuItem) => {
            item.setTitle(t('toolbar.position')).setDisabled(true);
        });
        const pos = ViewUriBuilder.detectLeafPosition(this.leaf, this.app.workspace);
        const posLabels: Record<LeafPosition, string> = {
            left: t('position.leftSidebar'),
            right: t('position.rightSidebar'),
            tab: t('position.tab'),
            window: t('position.window'),
            override: t('position.override'),
        };
        menu.addItem((item: MenuItem) => {
            item.setTitle(`  ${posLabels[pos]}`)
                .setChecked(true)
                .setDisabled(true);
        });
        }, { kind: 'mouseEvent', event: e });
    }

    private buildUriOptions(folder: string): ViewUriOptions {
        const opts: ViewUriOptions = {
            position: ViewUriBuilder.detectLeafPosition(this.leaf, this.app.workspace),
            name: this.customName,
        };
        const filterState = this.filterMenu.getFilterState();
        if (hasConditions(filterState)) {
            opts.filterState = filterState;
        }
        if (folder) {
            opts.template = this.customName || VIEW_META_MINI_CALENDAR.displayText;
        }
        return opts;
    }

    private async openOrCreateDailyNote(date: Date): Promise<void> {
        return openOrCreateDailyNote(this.app, date);
    }

    private async openOrCreatePeriodicNote(
        granularity: 'weekly' | 'monthly' | 'yearly',
        date: Date
    ): Promise<void> {
        let file: TFile | null;
        const settings = this.plugin.settings;
        switch (granularity) {
            case 'weekly':
                file = DailyNoteUtils.getWeeklyNote(this.app, settings, date);
                if (!file) file = await DailyNoteUtils.createWeeklyNote(this.app, settings, date);
                break;
            case 'monthly':
                file = DailyNoteUtils.getMonthlyNote(this.app, settings, date);
                if (!file) file = await DailyNoteUtils.createMonthlyNote(this.app, settings, date);
                break;
            case 'yearly':
                file = DailyNoteUtils.getYearlyNote(this.app, settings, date);
                if (!file) file = await DailyNoteUtils.createYearlyNote(this.app, settings, date);
                break;
        }
        if (file) {
            await this.app.workspace.getLeaf(false).openFile(file);
        }
    }
}
