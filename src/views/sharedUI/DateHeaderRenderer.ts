import type { App, HoverParent } from 'obsidian';
import type { PluginContext } from '../../PluginContext';
import { DateUtils } from '../../utils/DateUtils';
import { dailyNotes, label as noteLabel } from '../../utils/PeriodicNotes';
import { periodicNoteLink } from './PeriodicNoteLink';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { t } from '../../i18n';

interface DateHeaderRendererDeps {
    app: App;
    plugin: PluginContext;
    hoverParent: HoverParent;
    linkInteractionManager: TaskLinkInteractionManager;
}

export interface DateHeaderRenderParams {
    dates: string[];
    gridTemplateColumns: string;
    isOverdue: (date: string) => boolean;
    /**
     * Reference year-month from the toolbar date label. A date inside it shows
     * "DD dow", one in another month "MM-DD dow", one in another year the full
     * "YYYY-MM-DD dow" — the label says only as much as the header does not.
     */
    referenceYearMonth: { year: number; month: number };
}

export interface DateHeaderRenderResult {
    row: HTMLElement;
    axisCell: HTMLElement;
}

/**
 * How much of the date a header cell has to spell out. The toolbar already
 * names the year and month, so a date inside them needs only its day; a date
 * that has drifted out of them says as much as it takes to be unambiguous.
 *
 * This is the whole rule now. It used to share the job with a ResizeObserver
 * that shortened labels by cell width, but that path was unreachable from
 * `4ad2762a` onward — both callers pass a reference month — and is gone.
 */
export function contextualDateLabel(
    date: string,
    ref: { year: number; month: number },
    dayName: string,
): string {
    const dateYear = parseInt(date.substring(0, 4), 10);
    const dateMonth = parseInt(date.substring(5, 7), 10) - 1;
    if (dateYear !== ref.year) return `${date} ${dayName}`;
    if (dateMonth !== ref.month) return `${date.slice(5)} ${dayName}`;
    return `${date.slice(8)} ${dayName}`;
}

export class DateHeaderRenderer {
    constructor(private deps: DateHeaderRendererDeps) {}

    render(parent: HTMLElement, params: DateHeaderRenderParams): DateHeaderRenderResult {
        const { app, plugin, hoverParent, linkInteractionManager } = this.deps;
        const { dates, gridTemplateColumns, isOverdue, referenceYearMonth } = params;

        const row = parent.createDiv('tv-grid-row date-header');
        row.style.gridTemplateColumns = gridTemplateColumns;

        const axisCell = row.createDiv('date-header__cell');
        axisCell.setText(' ');

        const todayVisualDate = DateUtils.getVisualDateOfNow(plugin.settings.startHour);
        const weekdays = t('calendar.weekdaysShort').split(',');

        dates.forEach(date => {
            const cell = row.createDiv('date-header__cell');
            const dayName = weekdays[DateUtils.weekdayOf(date)];

            const daily = dailyNotes(app);
            periodicNoteLink(cell, { app, notes: plugin.getOperations(), links: linkInteractionManager, hoverParent }, daily, date, {
                cls: 'date-header__date-link',
                text: contextualDateLabel(date, referenceYearMonth, dayName),
                ariaLabel: t('aria.openDailyNote', { label: `${noteLabel(daily, date)} ${dayName}` }),
                opensFrom: cell,
            });

            if (date === todayVisualDate) {
                cell.addClass('is-today');
            }
            if (isOverdue(date)) {
                cell.addClass('has-overdue');
            }

            cell.dataset.date = date;

        });

        return { row, axisCell };
    }
}
