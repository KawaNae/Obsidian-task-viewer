import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { TaskViewerSettings } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { OverlayShell } from './OverlayShell';
import type { PopoverAnchor } from './PopoverShell';

/**
 * What a view hands the toolbar so the user can jump to any date, from a
 * double-click on Today or the "Go to date" command.
 */
export interface DateJumpOptions {
    getSettings: () => TaskViewerSettings;
    /**
     * Dates the view currently shows (YYYY-MM-DD, inclusive). The picker opens
     * on the month of `start` and marks the range, so the user sees where the
     * view is before choosing where to go.
     */
    getShownRange: () => { start: string; end: string };
    /** Move the view to `date` (YYYY-MM-DD). What "move" means is the view's call. */
    onJump: (date: string) => void;
}

/** Six weeks, the same grid Calendar draws, so every month fits. */
const GRID_DAYS = 42;

/**
 * The dates a month grid shows: six weeks starting from the week of the 1st.
 * Pure, for tests.
 */
export function monthGridDates(year: number, month: number, weekStartDay: 0 | 1): string[] {
    const start = DateUtils.getMonthGridStart(new Date(year, month, 1), weekStartDay);
    const dates: string[] = [];
    for (let i = 0; i < GRID_DAYS; i++) dates.push(DateUtils.addDays(start, i));
    return dates;
}

/**
 * A small month calendar anchored to the toolbar's Today button. Picking a day hands it
 * to `onJump` and closes. The month arrows only page the picker; the view does
 * not move until a day is picked.
 *
 * Root chrome and the phone bottom-sheet come from OverlayShell.
 */
export class DatePickerPopover {
    private readonly overlay = new OverlayShell();
    private year = 0;
    private month = 0;

    constructor(private readonly options: DateJumpOptions) {}

    open(anchor: PopoverAnchor): void {
        const { start } = this.options.getShownRange();
        this.year = parseInt(start.substring(0, 4), 10);
        this.month = parseInt(start.substring(5, 7), 10) - 1;
        this.overlay.open({
            mode: 'anchored',
            anchor,
            panelClass: 'tv-date-picker',
            build: (body) => this.build(body),
        });
    }

    close(): void {
        this.overlay.close();
    }

    private pageMonth(delta: number): void {
        const d = new Date(this.year, this.month + delta, 1);
        this.year = d.getFullYear();
        this.month = d.getMonth();
        this.overlay.refresh((body) => this.build(body));
    }

    private build(body: HTMLElement): void {
        const settings = this.options.getSettings();
        const { start, end } = this.options.getShownRange();
        const today = DateUtils.getVisualDateOfNow(settings.startHour);

        const header = body.createDiv('tv-date-picker__header');
        const prevBtn = header.createEl('button', { cls: 'tv-date-picker__nav' });
        setIcon(prevBtn, 'chevron-left');
        prevBtn.setAttribute('aria-label', t('toolbar.previousMonth'));
        prevBtn.onclick = () => this.pageMonth(-1);

        header.createSpan({
            cls: 'tv-date-picker__title',
            text: `${this.year} - ${String(this.month + 1).padStart(2, '0')}`,
        });

        const nextBtn = header.createEl('button', { cls: 'tv-date-picker__nav' });
        setIcon(nextBtn, 'chevron-right');
        nextBtn.setAttribute('aria-label', t('toolbar.nextMonth'));
        nextBtn.onclick = () => this.pageMonth(1);

        const grid = body.createDiv('tv-date-picker__grid');
        const weekdays = t('calendar.weekdaysNarrow').split(',');
        const ordered = settings.weekStartDay === 1 ? [...weekdays.slice(1), weekdays[0]] : weekdays;
        for (const label of ordered) {
            grid.createDiv({ cls: 'tv-date-picker__weekday', text: label });
        }

        for (const date of monthGridDates(this.year, this.month, settings.weekStartDay)) {
            const day = grid.createEl('button', {
                cls: 'tv-date-picker__day',
                text: String(parseInt(date.substring(8, 10), 10)),
            });
            day.setAttribute('aria-label', date);
            if (parseInt(date.substring(5, 7), 10) - 1 !== this.month) day.addClass('is-outside-month');
            if (date >= start && date <= end) day.addClass('is-shown');
            if (date === today) day.addClass('is-today');
            day.onclick = () => {
                this.close();
                this.options.onJump(date);
            };
        }
    }
}
