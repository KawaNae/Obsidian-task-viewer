import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import { Task, isCompleteStatusChar } from '../types';
import { TaskIndex } from '../services/core/TaskIndex';
import { DateUtils } from '../utils/DateUtils';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import TaskViewerPlugin from '../main';
import { TaskLinkInteractionManager } from './taskcard/TaskLinkInteractionManager';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../constants/hover';
import { VIEW_META_MINI_CALENDAR } from '../constants/viewRegistry';

export const VIEW_TYPE_MINI_CALENDAR = VIEW_META_MINI_CALENDAR.type;

type IndicatorState = 'none' | 'complete-only' | 'incomplete';

export class MiniCalendarView extends ItemView {
    private readonly taskIndex: TaskIndex;
    private readonly plugin: TaskViewerPlugin;
    private readonly linkInteractionManager: TaskLinkInteractionManager;

    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private windowStart: string;
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

        this.container.empty();

        this.renderToolbar();

        const grid = this.container.createDiv('mini-calendar-grid');
        this.renderWeekdayHeader(grid);

        const body = grid.createDiv('mini-calendar-body');
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

        const cursor = new Date(startDate);
        for (let weekIndex = 0; weekIndex < 6; weekIndex++) {
            const weekEl = body.createDiv('mini-calendar-week');
            for (let colIndex = 1; colIndex <= 7; colIndex++) {
                const date = new Date(cursor);
                const dateKey = DateUtils.getLocalDateString(date);
                this.renderCell(weekEl, date, dateKey, colIndex, referenceMonth, indicators.get(dateKey) ?? 'none');
                cursor.setDate(cursor.getDate() + 1);
            }
        }
    }

    private renderToolbar(): void {
        const toolbar = this.container.createDiv('view-toolbar mini-calendar-toolbar');

        const prevBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(prevBtn, 'chevron-left');
        prevBtn.setAttribute('aria-label', 'Previous week');
        prevBtn.setAttribute('title', 'Previous week');
        prevBtn.addEventListener('click', () => this.navigateWeek(-1));

        const monthLabel = toolbar.createSpan({ cls: 'mini-calendar-month-label' });
        monthLabel.setText(this.formatWindowLabel());

        const todayBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--today mini-calendar-toolbar__today', text: '今日' });
        todayBtn.setAttribute('aria-label', 'Today');
        todayBtn.setAttribute('title', 'Today');
        todayBtn.addEventListener('click', () => {
            const today = new Date();
            const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
            const weekStart = this.getWeekStart(monthStart, this.plugin.settings.calendarWeekStartDay);
            this.windowStart = DateUtils.getLocalDateString(weekStart);
            void this.app.workspace.requestSaveLayout();
            void this.render();
        });

        const nextBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(nextBtn, 'chevron-right');
        nextBtn.setAttribute('aria-label', 'Next week');
        nextBtn.setAttribute('title', 'Next week');
        nextBtn.addEventListener('click', () => this.navigateWeek(1));
    }

    private renderWeekdayHeader(grid: HTMLElement): void {
        const header = grid.createDiv('mini-calendar-weekday-header');
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
        indicatorState: IndicatorState,
    ): void {
        const cell = weekEl.createDiv('mini-calendar-cell');
        cell.style.gridColumn = `${colIndex}`;
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

        if (indicatorState !== 'none') {
            const indicator = link.createSpan({ cls: 'mini-calendar-cell__indicator' });
            if (indicatorState === 'incomplete') {
                indicator.addClass('mini-calendar-cell__indicator--incomplete');
            } else {
                indicator.addClass('mini-calendar-cell__indicator--complete');
            }
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
                const currentState = indicatorMap.get(dateCursor) ?? 'none';
                indicatorMap.set(dateCursor, this.mergeIndicatorState(currentState, isCompleted));
                dateCursor = DateUtils.addDays(dateCursor, 1);
            }
        }

        return indicatorMap;
    }

    private mergeIndicatorState(current: IndicatorState, isCompleted: boolean): IndicatorState {
        if (current === 'incomplete') {
            return current;
        }
        if (!isCompleted) {
            return 'incomplete';
        }
        if (current === 'none') {
            return 'complete-only';
        }
        return current;
    }

    private getTaskDateRange(task: Task): { effectiveStart: string | null; effectiveEnd: string | null } {
        if (!task.startDate) {
            return { effectiveStart: null, effectiveEnd: null };
        }

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
        const labels = ['日', '月', '火', '水', '木', '金', '土'];
        if (this.plugin.settings.calendarWeekStartDay === 1) {
            return [...labels.slice(1), labels[0]];
        }
        return labels;
    }

    private formatWindowLabel(): string {
        const reference = this.getReferenceMonth();
        return `${reference.month + 1}月 ${reference.year}`;
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
}
