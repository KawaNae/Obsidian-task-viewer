import { DateUtils } from '../../utils/DateUtils';
import { withWeekStartDay } from '../../utils/momentWeekLocale';
import { periodicNotes } from '../../utils/PeriodicNotes';
import type { TaskViewerSettings } from '../../types';
import { periodicNoteLink, type PeriodicLinkContext } from '../sharedUI/PeriodicNoteLink';
import { weekStartOf } from './CalendarGrid';

/**
 * The week number at the start of a week row of Calendar and MiniCalendar:
 * `W<nn>` in the week's numbering of the settings' week start, marked when
 * it is today's week. A click on it opens the weekly note.
 */
export function renderWeekNumberCell(
    weekRow: HTMLElement,
    weekStart: Date,
    today: string,
    settings: TaskViewerSettings,
    ctx: PeriodicLinkContext,
    options: { mini: boolean },
): void {
    const cell = weekRow.createDiv('cal-week-number');
    if (options.mini) cell.addClass('cal-week-number--mini');
    const weekStartKey = DateUtils.getLocalDateString(weekStart);
    if (weekStartKey === weekStartOf(today, settings.weekStartDay)) cell.addClass('is-current-week');

    const weekNumber = withWeekStartDay(weekStart, settings.weekStartDay).week();
    const link = periodicNoteLink(cell, ctx, periodicNotes(settings, 'weekly'), weekStartKey, { opensFrom: cell });
    link.createSpan({ cls: 'cal-week-number__label', text: `W${String(weekNumber).padStart(2, '0')}` });
}
