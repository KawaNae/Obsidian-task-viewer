import type { App, HoverParent } from 'obsidian';
import type { PluginContext } from '../../PluginContext';
import { DateUtils } from '../../utils/DateUtils';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
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
            const dayName = weekdays[new Date(date + 'T00:00:00Z').getUTCDay()];

            const dateObj = this.parseLocalDate(date);
            const linkTarget = DailyNoteUtils.getDailyNoteLinkTarget(app, dateObj);
            const linkLabel = DailyNoteUtils.getDailyNoteLabelForDate(app, dateObj);

            const label = contextualDateLabel(date, referenceYearMonth, dayName);

            const linkEl = cell.createEl('a', { cls: 'internal-link date-header__date-link', text: label });
            linkEl.dataset.href = linkTarget;
            linkEl.setAttribute('href', linkTarget);
            linkEl.setAttribute('aria-label', t('aria.openDailyNote', { label: `${linkLabel} ${dayName}` }));
            linkEl.addEventListener('click', (event: MouseEvent) => {
                event.preventDefault();
            });

            linkInteractionManager.bind(cell, {
                sourcePath: '',
                hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
                hoverParent,
            }, { bindClick: false });

            if (date === todayVisualDate) {
                cell.addClass('is-today');
            }
            if (isOverdue(date)) {
                cell.addClass('has-overdue');
            }

            cell.dataset.date = date;

            cell.addEventListener('click', async () => {
                let file = DailyNoteUtils.getDailyNote(app, dateObj);
                if (!file) {
                    file = await DailyNoteUtils.createDailyNote(app, dateObj);
                }
                if (file) {
                    await app.workspace.getLeaf(false).openFile(file);
                }
            });

        });

        return { row, axisCell };
    }

    private parseLocalDate(date: string): Date {
        const [year, month, day] = date.split('-').map(Number);
        return new Date(year, month - 1, day, 0, 0, 0, 0);
    }
}
