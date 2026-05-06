import type { App, HoverParent } from 'obsidian';
import TaskViewerPlugin from '../../main';
import { DateUtils } from '../../utils/DateUtils';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
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
    enableCompactBehavior: boolean;
    forceShortLabel: boolean;
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

// Compaction stages: full "yyyy-mm-dd ddd" → medium "mm-dd ddd" → short "dd ddd".
// Day + weekday are always present; only the year (then month) drop as the cell
// shrinks. Thresholds picked so each label has ~10-15px of breathing room over
// its measured ink width at the default 15px bold font.
const COMPACT_THRESHOLD_PX = 110;
const NARROW_THRESHOLD_PX = 70;

export class DateHeaderRenderer {
    private resizeObserver: ResizeObserver | null = null;

    constructor(private deps: DateHeaderRendererDeps) {}

    render(parent: HTMLElement, params: DateHeaderRenderParams): DateHeaderRenderResult {
        this.disconnectObserver();

        const { app, plugin, hoverParent, linkInteractionManager } = this.deps;
        const { dates, gridTemplateColumns, isOverdue, enableCompactBehavior, forceShortLabel } = params;

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
            // Display labels follow ISO chunks so the compaction is consistent —
            // weekday and day are always shown; only year, then month, drop. The
            // aria-label still uses linkLabel to preserve the daily-note format
            // hint for screen readers.
            const fullLabel = `${date} ${dayName}`;
            const mediumLabel = `${date.slice(5)} ${dayName}`;
            const shortLabel = `${date.slice(8)} ${dayName}`;

            const initialLabel = forceShortLabel ? shortLabel : fullLabel;
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

            if (forceShortLabel) {
                cell.addClass('is-narrow');
                cell.addClass('is-compact');
            }
        });

        if (!forceShortLabel && enableCompactBehavior) {
            this.applyResponsiveCompact(headerCells);
        }

        return { row, axisCell };
    }

    dispose(): void {
        this.disconnectObserver();
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
