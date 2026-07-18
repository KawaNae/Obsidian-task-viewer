import { ItemView, type WorkspaceLeaf, type TFile, type ViewStateResult } from 'obsidian';
import { logDebug } from '../../log/log';
import { t } from '../../i18n';
import type { DisplayTask, Task, AstronomyDisplay } from '../../types';
import { attachMoonPhase } from '../sharedUI/AstronomyCellAdorner';
import { shouldRenderForChanges } from '../sharedUI/RenderScheduler';
import { getEffectiveAstronomyDisplay } from '../../services/astronomy/AstronomyService';
import { DateUtils } from '../../utils/DateUtils';
import { withWeekStartDay } from '../../utils/momentWeekLocale';
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
import type TaskViewerPlugin from '../../main';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { VIEW_META_MINI_CALENDAR } from '../../constants/viewRegistry';
import { codecFor, type ViewConfigCodec } from '../../services/viewConfig';
import { MiniCalendarSchema, type MiniCalendarConfig, type MiniCalendarTransient } from './MiniCalendarSchema';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { createEmptyFilterState, hasConditions } from '../../services/filter/FilterTypes';
import { MiniCalendarToolbar } from './MiniCalendarToolbar';

export const VIEW_TYPE_MINI_CALENDAR = VIEW_META_MINI_CALENDAR.type;

interface IndicatorState {
    hasIncomplete: boolean;
    hasComplete: boolean;
}

type MiniCalendarViewState = Partial<MiniCalendarConfig> & Partial<MiniCalendarTransient>;

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
    private astronomyDisplay: Partial<AstronomyDisplay> | undefined = undefined;
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
        const weekStart = this.getWeekStart(monthStart, this.plugin.settings.weekStartDay);
        this.windowStart = DateUtils.getLocalDateString(weekStart);

        this.toolbar = new MiniCalendarToolbar({
            app: this.app,
            leaf: this.leaf,
            plugin: this.plugin,
            readService: this.readService,
            filterMenu: this.filterMenu,
            linkInteractionManager: this.linkInteractionManager,
            hoverParent: this.hoverParent,
            getReferenceMonth: () => this.getReferenceMonth(),
            onNavigateWeek: (direction) => this.navigateWeek(direction),
            onJumpToCurrentMonth: () => {
                if (this.isAnimating) return;
                const today = new Date();
                const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                const weekStart = this.getWeekStart(monthStart, this.plugin.settings.weekStartDay);
                this.windowStart = DateUtils.getLocalDateString(weekStart);
                void this.app.workspace.requestSaveLayout();
                void this.render();
            },
            onFilterChange: () => {
                void this.app.workspace.requestSaveLayout();
                void this.render();
            },
            getCustomName: () => this.customName,
            onRename: (newName) => {
                this.customName = newName;
                this.leaf.updateHeader();
                this.app.workspace.requestSaveLayout();
            },
            getCurrentConfig: () => this.getCurrentConfig(),
            applyConfig: (cfg) => this.applyConfig(cfg),
            onConfigApplied: () => {
                this.leaf.updateHeader();
                void this.app.workspace.requestSaveLayout();
                void this.render();
            },
            getAstronomyDisplay: () => this.astronomyDisplay,
            setAstronomyDisplay: (next) => {
                this.astronomyDisplay = next;
                void this.app.workspace.requestSaveLayout();
                void this.render();
            },
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
        const stateDict = (state ?? {}) as Record<string, unknown>;
        const config = this.codec.parseConfig(stateDict);
        const transient = this.codec.parseTransient(stateDict);

        this.applyConfig(config);

        if (transient.windowStart) {
            const parsedWindowStart = this.parseLocalDateString(transient.windowStart);
            if (parsedWindowStart) {
                const weekStart = this.getWeekStart(parsedWindowStart, this.plugin.settings.weekStartDay);
                this.windowStart = DateUtils.getLocalDateString(weekStart);
            }
        }

        await super.setState(state, result);
        await this.render();
    }

    private get codec(): ViewConfigCodec<MiniCalendarConfig, MiniCalendarTransient> {
        return codecFor(VIEW_TYPE_MINI_CALENDAR) as ViewConfigCodec<MiniCalendarConfig, MiniCalendarTransient>;
    }

    applyConfig(cfg: Partial<MiniCalendarConfig>): void {
        const next: Partial<MiniCalendarConfig> = { ...MiniCalendarSchema.defaults, ...cfg };
        this.filterMenu.setFilterState(next.filterState ?? createEmptyFilterState());
        this.customName = next.customName;
        this.astronomyDisplay = next.astronomyDisplay
            ? { ...next.astronomyDisplay }
            : undefined;
    }

    getCurrentConfig(): Partial<MiniCalendarConfig> {
        const filterState = this.filterMenu.getFilterState();
        return {
            customName: this.customName,
            filterState: hasConditions(filterState) ? filterState : undefined,
            astronomyDisplay: this.astronomyDisplay,
        };
    }

    getState(): Record<string, unknown> {
        return {
            ...this.codec.serializeConfig(this.getCurrentConfig()),
            ...this.codec.serializeTransient({ windowStart: this.windowStart }),
        };
    }

    async onOpen(): Promise<void> {
        logDebug(`[${this.getViewType()}] opened`);
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('mini-calendar-view');

        await this.render();

        this.unsubscribe = this.readService.onChange((_taskId, changes) => {
            if (!shouldRenderForChanges(changes)) return;
            void this.render();
        });
    }

    async onClose(): Promise<void> {
        logDebug(`[${this.getViewType()}] closed`);
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

        const grid = this.container.createDiv('cal-grid cal-grid--mini');
        this.renderWeekdayHeader(grid);

        const body = grid.createDiv('cal-grid__body cal-grid__body--mini');
        const track = body.createDiv('cal-grid__body-track');
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
            const weekEl = track.createDiv('cal-week-row cal-week-row--mini');
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
        const header = grid.createDiv('cal-weekday-header cal-weekday-header--mini');
        if (this.shouldShowWeekNumbers()) {
            header.addClass('has-week-numbers');
            header.createDiv({ cls: 'cal-weekday-cell cal-weekday-cell--mini', text: t('calendar.w') });
        }
        const weekdays = this.getWeekdayNames();
        weekdays.forEach((label) => {
            header.createDiv({ cls: 'cal-weekday-cell cal-weekday-cell--mini', text: label });
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
        const cell = weekEl.createDiv('cal-day-cell cal-day-cell--mini');
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
            cls: 'internal-link cal-day-cell__date-link',
        });
        link.dataset.href = linkTarget;
        link.setAttribute('href', linkTarget);
        link.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
        });

        link.createSpan({
            cls: 'cal-day-cell__date-label',
            text: String(date.getDate()),
        });

        const indicatorRow = link.createDiv({ cls: 'cal-day-cell__indicators' });
        // When the moon overlay is on, it fully replaces task indicator dots
        // at the same spot (per user choice — single visual slot, no overlap).
        const astronomyDisplay = getEffectiveAstronomyDisplay(
            this.astronomyDisplay,
            this.plugin.settings.astronomy,
        );
        if (astronomyDisplay.moonPhase) {
            attachMoonPhase(indicatorRow, DateUtils.getLocalDateString(date), {
                size: 12,
                modifier: 'moon-phase-inline--mini',
            });
        } else {
            if (indicatorState.hasIncomplete) {
                indicatorRow.createSpan({
                    cls: 'cal-day-cell__indicator cal-day-cell__indicator--incomplete'
                });
            }
            if (indicatorState.hasComplete) {
                indicatorRow.createSpan({
                    cls: 'cal-day-cell__indicator cal-day-cell__indicator--complete'
                });
            }
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
        return getCalendarDateRange(this.windowStart, this.plugin.settings.weekStartDay);
    }

    private getWeekStart(date: Date, weekStartDay: 0 | 1): Date {
        return getWeekStart(date, weekStartDay);
    }

    private getWeekdayNames(): string[] {
        const labels = t('calendar.weekdaysNarrow').split(',');
        if (this.plugin.settings.weekStartDay === 1) {
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
        const weekNumberEl = weekEl.createDiv('cal-week-number cal-week-number--mini');
        const weekNumber = withWeekStartDay(weekStartDate, this.plugin.settings.weekStartDay).week();

        const todayWeekStart = this.getWeekStart(new Date(), this.plugin.settings.weekStartDay);
        if (DateUtils.getLocalDateString(weekStartDate) === DateUtils.getLocalDateString(todayWeekStart)) {
            weekNumberEl.addClass('is-current-week');
        }

        const weekLinkTarget = DailyNoteUtils.getWeeklyNoteLinkTarget(this.plugin.settings, weekStartDate);
        const weekLink = weekNumberEl.createEl('a', { cls: 'internal-link' });
        weekLink.createSpan({
            cls: 'cal-week-number__label',
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
        this.toolbar.update();

        const body = this.container?.querySelector('.cal-grid__body--mini');
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
        return getNormalizedWindowStart(value, this.plugin.settings.weekStartDay);
    }

    private animateWeekSlide(body: HTMLElement, offset: number): void {
        const track = body.querySelector('.cal-grid__body-track');
        if (!(track instanceof HTMLElement)) {
            void this.render();
            return;
        }

        const weekRows = Array.from(track.querySelectorAll('.cal-week-row--mini'))
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
            track.querySelectorAll('.cal-week-row--mini').forEach((row) => {
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
                const firstWeek = track.querySelector('.cal-week-row--mini');
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
            const currentWeeks = track.querySelectorAll('.cal-week-row--mini');
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
        weekEl.addClass('cal-week-row', 'cal-week-row--mini');
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
