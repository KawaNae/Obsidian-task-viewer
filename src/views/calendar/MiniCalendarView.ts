import { ItemView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import { Task } from '../../types';
import { TaskIndex } from '../../services/core/TaskIndex';
import { DateUtils } from '../../utils/DateUtils';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import {
    getTaskDateRange,
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
import { VIEW_META_MINI_CALENDAR } from '../../constants/viewRegistry';

export const VIEW_TYPE_MINI_CALENDAR = VIEW_META_MINI_CALENDAR.type;

interface IndicatorState {
    hasIncomplete: boolean;
    hasComplete: boolean;
}

export class MiniCalendarView extends ItemView {
    private readonly taskIndex: TaskIndex;
    private readonly plugin: TaskViewerPlugin;
    private readonly linkInteractionManager: TaskLinkInteractionManager;

    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private windowStart: string;
    private isAnimating: boolean = false;
    private navigateWeekDebounceTimer: number | null = null;
    private pendingWeekOffset: number = 0;

    constructor(leaf: WorkspaceLeaf, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        super(leaf);
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.linkInteractionManager = new TaskLinkInteractionManager(this.app);

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const weekStart = this.getWeekStart(monthStart, this.plugin.settings.calendarWeekStartDay);
        this.windowStart = DateUtils.getLocalDateString(weekStart);
    }

    getViewType(): string {
        return VIEW_TYPE_MINI_CALENDAR;
    }

    getDisplayText(): string {
        return VIEW_META_MINI_CALENDAR.displayText;
    }

    getIcon(): string {
        return VIEW_META_MINI_CALENDAR.icon;
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

        await super.setState(state, result);
        await this.render();
    }

    getState(): Record<string, unknown> {
        return {
            windowStart: this.windowStart,
        };
    }

    async onOpen(): Promise<void> {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('mini-calendar-view');

        await this.render();

        this.unsubscribe = this.taskIndex.onChange(() => {
            void this.render();
        });
    }

    async onClose(): Promise<void> {
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

        this.container.empty();

        this.renderToolbar();

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

    private renderToolbar(): void {
        const toolbar = this.container.createDiv('view-toolbar mini-calendar-toolbar');

        const labelGroup = toolbar.createDiv('mini-calendar-toolbar__label');
        const referenceMonth = this.getReferenceMonth();
        const now = new Date();
        const isCurrentYear = referenceMonth.year === now.getFullYear();
        const isCurrentMonth = isCurrentYear && referenceMonth.month === now.getMonth();

        const yearDate = new Date(referenceMonth.year, 0, 1);
        const yearLinkTarget = DailyNoteUtils.getYearlyNoteLinkTarget(this.plugin.settings, yearDate);
        const yearWrapper = labelGroup.createSpan({ cls: 'mini-calendar-toolbar__year' });
        const yearLink = yearWrapper.createEl('a', {
            cls: 'internal-link',
            text: `${referenceMonth.year}`,
        });
        yearLink.dataset.href = yearLinkTarget;
        yearLink.setAttribute('href', yearLinkTarget);
        yearWrapper.toggleClass('is-current', isCurrentYear);
        yearLink.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
        });
        this.linkInteractionManager.bind(yearWrapper, {
            sourcePath: '',
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            hoverParent: this.leaf as HoverParent,
        }, { bindClick: false });
        yearWrapper.addEventListener('click', () => {
            void this.openOrCreatePeriodicNote('yearly', yearDate);
        });

        labelGroup.createSpan({ cls: 'mini-calendar-toolbar__separator', text: '-' });

        const monthDate = new Date(referenceMonth.year, referenceMonth.month, 1);
        const monthLinkTarget = DailyNoteUtils.getMonthlyNoteLinkTarget(this.plugin.settings, monthDate);
        const monthWrapper = labelGroup.createSpan({ cls: 'mini-calendar-toolbar__month' });
        const monthLink = monthWrapper.createEl('a', {
            cls: 'internal-link',
            text: `${String(referenceMonth.month + 1).padStart(2, '0')}`,
        });
        monthLink.dataset.href = monthLinkTarget;
        monthLink.setAttribute('href', monthLinkTarget);
        monthWrapper.toggleClass('is-current', isCurrentMonth);
        monthLink.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
        });
        this.linkInteractionManager.bind(monthWrapper, {
            sourcePath: '',
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            hoverParent: this.leaf as HoverParent,
        }, { bindClick: false });
        monthWrapper.addEventListener('click', () => {
            void this.openOrCreatePeriodicNote('monthly', monthDate);
        });

        toolbar.createDiv('view-toolbar__spacer');
        const navGroup = toolbar.createDiv('mini-calendar-toolbar__nav');

        const prevBtn = navGroup.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(prevBtn, 'chevron-up');
        prevBtn.setAttribute('aria-label', 'Previous week');
        prevBtn.addEventListener('click', () => this.navigateWeek(-1));

        const todayBtn = navGroup.createEl('button', { cls: 'view-toolbar__btn--today mini-calendar-toolbar__today', text: 'Today' });
        todayBtn.setAttribute('aria-label', 'Today');
        todayBtn.addEventListener('click', () => {
            if (this.isAnimating) {
                return;
            }
            const today = new Date();
            const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
            const weekStart = this.getWeekStart(monthStart, this.plugin.settings.calendarWeekStartDay);
            this.windowStart = DateUtils.getLocalDateString(weekStart);
            void this.app.workspace.requestSaveLayout();
            void this.render();
        });

        const nextBtn = navGroup.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(nextBtn, 'chevron-down');
        nextBtn.setAttribute('aria-label', 'Next week');
        nextBtn.addEventListener('click', () => this.navigateWeek(1));
    }
    private renderWeekdayHeader(grid: HTMLElement): void {
        const header = grid.createDiv('mini-calendar-weekday-header');
        if (this.shouldShowWeekNumbers()) {
            header.addClass('has-week-numbers');
            header.createDiv({ cls: 'mini-calendar-weekday-cell', text: 'W' });
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
            hoverParent: this.leaf as HoverParent,
        }, { bindClick: false });

        cell.addEventListener('click', () => {
            void this.openOrCreateDailyNote(date);
        });
    }

    private computeIndicators(rangeStart: string, rangeEnd: string): Map<string, IndicatorState> {
        const indicatorMap = new Map<string, IndicatorState>();
        const allTasks = this.taskIndex.getTasks();

        for (const task of allTasks) {
            const { effectiveStart, effectiveEnd } = this.getTaskDateRange(task);
            if (!effectiveStart) {
                continue;
            }

            const taskEnd = effectiveEnd || effectiveStart;
            if (effectiveStart > rangeEnd || taskEnd < rangeStart) {
                continue;
            }

            const clippedStart = effectiveStart < rangeStart ? rangeStart : effectiveStart;
            const clippedEnd = taskEnd > rangeEnd ? rangeEnd : taskEnd;
            const isCompleted = this.isTaskCompleted(task);

            let dateCursor = clippedStart;
            while (dateCursor <= clippedEnd) {
                const currentState = indicatorMap.get(dateCursor) ?? { hasIncomplete: false, hasComplete: false };
                indicatorMap.set(dateCursor, {
                    hasIncomplete: currentState.hasIncomplete || !isCompleted,
                    hasComplete: currentState.hasComplete || isCompleted,
                });
                dateCursor = DateUtils.addDays(dateCursor, 1);
            }
        }

        return indicatorMap;
    }

    private getTaskDateRange(task: Task): { effectiveStart: string | null; effectiveEnd: string | null } {
        return getTaskDateRange(task, this.plugin.settings.startHour);
    }

    private isTaskCompleted(task: Task): boolean {
        return isTaskCompletedUtil(task, this.plugin.settings.completeStatusChars);
    }

    private getCalendarDateRange(): { startDate: Date; endDate: Date } {
        return getCalendarDateRange(this.windowStart, this.plugin.settings.calendarWeekStartDay);
    }

    private getWeekStart(date: Date, weekStartDay: 0 | 1): Date {
        return getWeekStart(date, weekStartDay);
    }

    private getWeekdayNames(): string[] {
        const labels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
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
            hoverParent: this.leaf as HoverParent,
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
                this.navigateWeek(nextOffset);
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
            monthEl.setText(`${String(referenceMonth.month + 1).padStart(2, '0')}`);
            monthEl.toggleClass('is-current', isCurrentMonth);
        }

        if (yearEl instanceof HTMLElement) {
            yearEl.setText(`${referenceMonth.year}`);
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
