import type { App, HoverParent } from 'obsidian';
import type TaskViewerPlugin from '../../main';
import { DateUtils } from '../../utils/DateUtils';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { t } from '../../i18n';

interface DateHeaderRendererDeps {
    app: App;
    plugin: TaskViewerPlugin;
    hoverParent: HoverParent;
    linkInteractionManager: TaskLinkInteractionManager;
}

export interface DateHeaderRenderParams {
    dates: string[];
    gridTemplateColumns: string;
    isOverdue: (date: string) => boolean;
    /**
     * Reference year-month from the toolbar date label.
     * When provided, dates matching this year-month show "DD dow" only;
     * dates in a different month show "MM-DD dow";
     * dates in a different year show "YYYY-MM-DD dow".
     * When omitted, falls back to responsive compaction via ResizeObserver.
     */
    referenceYearMonth?: { year: number; month: number };
}

export interface DateHeaderRenderResult {
    row: HTMLElement;
    axisCell: HTMLElement;
}

type DateHeaderDisplayEntry = {
    cell: HTMLElement;
    linkEl: HTMLElement;
    fullLabel: string;
    mediumLabel: string;
    shortLabel: string;
};

const COMPACT_THRESHOLD_PX = 110;
const NARROW_THRESHOLD_PX = 70;

export class DateHeaderRenderer {
    private resizeObserver: ResizeObserver | null = null;

    constructor(private deps: DateHeaderRendererDeps) {}

    render(parent: HTMLElement, params: DateHeaderRenderParams): DateHeaderRenderResult {
        this.disconnectObserver();

        const { app, plugin, hoverParent, linkInteractionManager } = this.deps;
        const { dates, gridTemplateColumns, isOverdue, referenceYearMonth } = params;

        const row = parent.createDiv('tv-grid-row date-header');
        row.style.gridTemplateColumns = gridTemplateColumns;

        const axisCell = row.createDiv('date-header__cell');
        axisCell.setText(' ');

        const todayVisualDate = DateUtils.getVisualDateOfNow(plugin.settings.startHour);
        const weekdays = t('calendar.weekdaysShort').split(',');

        const headerCells: DateHeaderDisplayEntry[] = [];
        dates.forEach(date => {
            const cell = row.createDiv('date-header__cell');
            const dayName = weekdays[new Date(date + 'T00:00:00Z').getUTCDay()];

            const dateObj = this.parseLocalDate(date);
            const linkTarget = DailyNoteUtils.getDailyNoteLinkTarget(app, dateObj);
            const linkLabel = DailyNoteUtils.getDailyNoteLabelForDate(app, dateObj);

            const fullLabel = `${date} ${dayName}`;
            const mediumLabel = `${date.slice(5)} ${dayName}`;
            const shortLabel = `${date.slice(8)} ${dayName}`;

            const initialLabel = referenceYearMonth
                ? this.pickContextualLabel(date, referenceYearMonth, fullLabel, mediumLabel, shortLabel)
                : fullLabel;

            const linkEl = cell.createEl('a', { cls: 'internal-link date-header__date-link', text: initialLabel });
            linkEl.dataset.href = linkTarget;
            linkEl.setAttribute('href', linkTarget);
            linkEl.setAttribute('aria-label', `Open daily note: ${linkLabel} ${dayName}`);
            linkEl.addEventListener('click', (event: MouseEvent) => {
                event.preventDefault();
            });

            linkInteractionManager.bind(cell, {
                sourcePath: '',
                hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
                hoverParent,
            }, { bindClick: false });

            headerCells.push({ cell, linkEl, fullLabel, mediumLabel, shortLabel });

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

            if (referenceYearMonth) {
                cell.addClass('is-compact');
                cell.addClass('is-narrow');
            }
        });

        if (!referenceYearMonth) {
            this.applyResponsiveCompact(headerCells);
        }

        return { row, axisCell };
    }

    dispose(): void {
        this.disconnectObserver();
    }

    private pickContextualLabel(
        date: string,
        ref: { year: number; month: number },
        fullLabel: string,
        mediumLabel: string,
        shortLabel: string,
    ): string {
        const dateYear = parseInt(date.substring(0, 4), 10);
        const dateMonth = parseInt(date.substring(5, 7), 10) - 1;
        if (dateYear !== ref.year) return fullLabel;
        if (dateMonth !== ref.month) return mediumLabel;
        return shortLabel;
    }

    private disconnectObserver(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
    }

    private applyResponsiveCompact(entries: DateHeaderDisplayEntry[]): void {
        const entryMap = new Map<HTMLElement, DateHeaderDisplayEntry>();
        entries.forEach((entry) => entryMap.set(entry.cell, entry));

        this.resizeObserver = new ResizeObserver((observed) => {
            for (const entry of observed) {
                const cell = entry.target as HTMLElement;
                const displayEntry = entryMap.get(cell);
                if (!displayEntry) continue;

                const isCompact = entry.contentRect.width < COMPACT_THRESHOLD_PX;
                const isNarrow = entry.contentRect.width < NARROW_THRESHOLD_PX;
                cell.toggleClass('is-compact', isCompact);
                cell.toggleClass('is-narrow', isNarrow);

                const nextLabel = isNarrow
                    ? displayEntry.shortLabel
                    : isCompact
                        ? displayEntry.mediumLabel
                        : displayEntry.fullLabel;

                if (displayEntry.linkEl.textContent !== nextLabel) {
                    displayEntry.linkEl.textContent = nextLabel;
                }
            }
        });
        entries.forEach((entry) => this.resizeObserver!.observe(entry.cell));
    }

    private parseLocalDate(date: string): Date {
        const [year, month, day] = date.split('-').map(Number);
        return new Date(year, month - 1, day, 0, 0, 0, 0);
    }
}
