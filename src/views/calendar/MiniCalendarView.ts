import type { WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type { DisplayTask } from '../../types';
import { attachMoonPhase } from '../sharedUI/AstronomyCellAdorner';
import { getEffectiveAstronomyDisplay } from '../../services/astronomy/AstronomyService';
import { DateUtils } from '../../utils/DateUtils';
import { getTaskDateRange } from '../../services/display/VisualDateRange';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { IndexReads } from '../../services/core/TaskIndex';
import { dailyNotes } from '../../utils/PeriodicNotes';
import { periodicNoteLink, type PeriodicLinkContext } from '../sharedUI/PeriodicNoteLink';
import { renderWeekNumberCell } from './WeekNumberCell';
import { isTaskCompleted as isTaskCompletedUtil } from '../../services/display/TaskStatusQuery';
import { getGridColumnForDay } from './CalendarDateUtils';
import { gridFollowingToday, gridRange, gridShifted, referenceMonth } from './CalendarGrid';
import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { MiniCalendarCodec, type MiniCalendarConfig, type MiniCalendarTransient } from './MiniCalendarSchema';
import { hasConditions } from '../../services/filter/FilterTypes';
import { MiniCalendarToolbar } from './MiniCalendarToolbar';
import { hostWindow } from '../../utils/HostWindow';
import { TaskViewerView } from '../base/TaskViewerView';


interface IndicatorState {
    hasIncomplete: boolean;
    hasComplete: boolean;
}

/**
 * MiniCalendar View - six weeks of days with a dot for the tasks on each.
 *
 * Its state is MiniCalendarSchema's config and transient fields, held in the
 * base's store. The weeks it draws are read from where it is (`date`,
 * absent while it follows today, and `weekOffset`) by `CalendarGrid`, as
 * Calendar's.
 */
export class MiniCalendarView extends TaskViewerView<MiniCalendarConfig, MiniCalendarTransient> {
    private readonly readService: TaskReadService;
    /** The index's copies and changes (`PluginContext.getIndex`). */
    private readonly index: IndexReads;
    private readonly linkInteractionManager: TaskLinkInteractionManager;
    private readonly toolbar: MiniCalendarToolbar;

    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private isAnimating: boolean = false;
    private navigateWeekDebounceTimer: number | null = null;
    private pendingWeekOffset: number = 0;
    private readonly hoverParent = new TaskViewHoverParent();

    getViewType(): string {
        return MiniCalendarCodec.schema.viewType;
    }

    constructor(leaf: WorkspaceLeaf, plugin: PluginContext & TimerHost) {
        super(leaf, plugin, MiniCalendarCodec);
        this.readService = this.plugin.getTaskReadService();
        this.index = this.plugin.getIndex();
        this.linkInteractionManager = new TaskLinkInteractionManager(this.app, () => this.plugin.settings);

        this.toolbar = new MiniCalendarToolbar({
            host: this.toolbarHost(),
            commands: {
                navigateWeeks: (n) => this.navigateWeeks(n),
                today: () => {
                    if (this.isAnimating) return;
                    this.update(gridFollowingToday());
                },
                referenceMonth: () => referenceMonth(this.gridRange().start),
            },
            linkInteractionManager: this.linkInteractionManager,
            hoverParent: this.hoverParent,
        });
    }

    /** The days the grid draws, read from where the view is and the week start of the settings. */
    private gridRange(): { start: string; end: string } {
        return gridRange(this.state, this.visualToday(), this.plugin.settings.weekStartDay);
    }

    protected openView(): void {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('mini-calendar-view');

        this.unsubscribe = this.index.onChange((taskId, changes) => {
            this.renderScheduler.handleChange(taskId, changes);
        });
    }

    protected closeView(): void {
        this.hoverParent.dispose();
        this.toolbar.close();
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

    protected draw(): void {
        this.isAnimating = false;

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

        const { start, end } = this.gridRange();
        const indicators = this.computeIndicators(start, end);
        const month = referenceMonth(start);
        const showWeekNumbers = this.shouldShowWeekNumbers();
        const today = this.visualToday();

        const cursor = DateUtils.parseDate(start);
        for (let weekIndex = 0; weekIndex < 6; weekIndex++) {
            const weekStartDate = new Date(cursor);
            const weekEl = track.createDiv('cal-week-row cal-week-row--mini');
            if (showWeekNumbers) {
                weekEl.addClass('has-week-numbers');
                renderWeekNumberCell(weekEl, weekStartDate, today, this.plugin.settings, this.periodicLinks(), { mini: true });
            }
            for (let colIndex = 1; colIndex <= 7; colIndex++) {
                const date = new Date(cursor);
                const dateKey = DateUtils.getLocalDateString(date);
                this.renderCell(
                    weekEl,
                    date,
                    dateKey,
                    colIndex,
                    month,
                    indicators.get(dateKey) ?? { hasIncomplete: false, hasComplete: false },
                    today,
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
        indicatorState: IndicatorState,
        today: string,
    ): void {
        const cell = weekEl.createDiv('cal-day-cell cal-day-cell--mini');
        cell.style.gridColumn = `${getGridColumnForDay(colIndex, this.shouldShowWeekNumbers())}`;
        cell.dataset.date = dateKey;

        if (date.getFullYear() !== referenceMonth.year || date.getMonth() !== referenceMonth.month) {
            cell.addClass('is-outside-month');
        }
        if (dateKey === today) {
            cell.addClass('is-today');
        }

        const link = periodicNoteLink(cell, this.periodicLinks(), dailyNotes(this.app), dateKey, {
            cls: 'cal-day-cell__date-link',
            opensFrom: cell,
        });
        link.createSpan({
            cls: 'cal-day-cell__date-label',
            text: String(date.getDate()),
        });

        const indicatorRow = link.createDiv({ cls: 'cal-day-cell__indicators' });
        // When the moon overlay is on, it fully replaces task indicator dots
        // at the same spot (per user choice — single visual slot, no overlap).
        const astronomyDisplay = getEffectiveAstronomyDisplay(
            this.state.astronomyDisplay,
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
    }

    /** What the grid's links to the daily and weekly notes open and preview with. */
    private periodicLinks(): PeriodicLinkContext {
        return {
            app: this.app,
            notes: this.plugin.getOperations(),
            links: this.linkInteractionManager,
            hoverParent: this.hoverParent,
        };
    }

    private computeIndicators(rangeStart: string, rangeEnd: string): Map<string, IndicatorState> {
        const indicatorMap = new Map<string, IndicatorState>();
        const filterState = this.state.filterState;
        const filter = filterState && hasConditions(filterState) ? filterState : undefined;

        const allTasks = this.readService.getTasksForDateRange(rangeStart, rangeEnd, filter);
        const startHour = this.plugin.settings.startHour;

        for (const dt of allTasks) {
            const dates = getTaskDateRange(dt, startHour);
            const visualStart = dates.effectiveStart || dt.effectiveStartDate;
            const visualEnd = dates.effectiveEnd || visualStart;
            const duePart = DateUtils.dueDatePart(dt.effectiveDue);

            const completed = this.isTaskCompleted(dt);

            if (!visualStart && duePart) {
                const entry = indicatorMap.get(duePart) ?? { hasIncomplete: false, hasComplete: false };
                if (completed) entry.hasComplete = true; else entry.hasIncomplete = true;
                indicatorMap.set(duePart, entry);
                continue;
            }

            if (!visualStart) continue;

            let cursor = visualStart < rangeStart ? rangeStart : visualStart;
            const end = visualEnd > rangeEnd ? rangeEnd : visualEnd;
            while (cursor <= end) {
                const entry = indicatorMap.get(cursor) ?? { hasIncomplete: false, hasComplete: false };
                if (completed) entry.hasComplete = true; else entry.hasIncomplete = true;
                indicatorMap.set(cursor, entry);
                cursor = DateUtils.addDays(cursor, 1);
            }
        }

        return indicatorMap;
    }

    private isTaskCompleted(task: DisplayTask): boolean {
        return isTaskCompletedUtil(task, this.plugin.settings.statusDefinitions, this.readService);
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

    /**
     * Slide the grid by `offset` weeks: the offset moves (a view following
     * today fixes it), and the slide shows the change before the draw that
     * ends it.
     */
    private navigateWeeks(offset: number): void {
        if (offset === 0 || this.isAnimating) {
            return;
        }

        this.update(gridShifted(this.state, this.visualToday(), offset), { draw: false });

        const body = this.container?.querySelector('.cal-grid__body--mini');
        if (!(body instanceof HTMLElement)) {
            this.requestDraw();
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
                // container の window のフレームで走らせる（popout の週送り）。
                hostWindow(this.container).requestAnimationFrame(() => this.navigateWeeks(nextOffset));
            }
        }, 50);
    }

    private animateWeekSlide(body: HTMLElement, offset: number): void {
        const track = body.querySelector('.cal-grid__body-track');
        if (!(track instanceof HTMLElement)) {
            this.requestDraw();
            return;
        }

        const weekRows = Array.from(track.querySelectorAll('.cal-week-row--mini'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement);
        if (weekRows.length !== 6) {
            this.requestDraw();
            return;
        }

        const rowHeight = body.clientHeight / 6;
        if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
            this.requestDraw();
            return;
        }

        const { start, end } = this.gridRange();
        const indicators = this.computeIndicators(start, end);
        const month = referenceMonth(start);
        const today = this.visualToday();

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
            this.requestDraw();
        };

        this.isAnimating = true;

        if (offset > 0) {
            const incomingWeekStart = DateUtils.addDays(start, 35);
            const incomingWeek = this.createWeekRow(incomingWeekStart, indicators, month, rowHeight, today);
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

        const incomingWeekStart = start;
        const incomingWeek = this.createWeekRow(incomingWeekStart, indicators, month, rowHeight, today);
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
        today: string,
    ): HTMLElement {
        const weekEl = document.createElement('div');
        weekEl.addClass('cal-week-row', 'cal-week-row--mini');
        if (this.shouldShowWeekNumbers()) {
            weekEl.addClass('has-week-numbers');
        }
        weekEl.style.height = `${rowHeight}px`;
        weekEl.style.flex = 'none';

        const startDate = DateUtils.readDate(weekStart);
        if (!startDate) {
            return weekEl;
        }

        if (this.shouldShowWeekNumbers()) {
            renderWeekNumberCell(weekEl, startDate, today, this.plugin.settings, this.periodicLinks(), { mini: true });
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
                indicators.get(dateKey) ?? { hasIncomplete: false, hasComplete: false },
                today,
            );
            cursor.setDate(cursor.getDate() + 1);
        }

        return weekEl;
    }
}
