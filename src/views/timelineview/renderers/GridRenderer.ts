import type { HoverParent } from 'obsidian';
import type { TimelineState } from '../TimelineSchema';
import type { PluginContext } from '../../../PluginContext';
import type { MenuHandler } from '../../../interaction/menu/MenuHandler';
import { DateUtils } from '../../../utils/DateUtils';
import { t } from '../../../i18n';

import type { AllDaySectionRenderer } from '../../sharedUI/AllDaySectionRenderer';
import type { TimelineSectionRenderer } from './TimelineSectionRenderer';
import { daysWindow } from '../../../utils/DayWindow';
import { overlaps } from '../../../utils/SpanRelation';
import type { DisplayTask } from '../../../types';
import type { MoonPhaseRenderer } from '../../sharedUI/MoonPhaseRenderer';
import { getEffectiveAstronomyDisplay } from '../../../services/astronomy/AstronomyService';
import { attachSunAxisArrows } from '../../sharedUI/AstronomyCellAdorner';
import { splitTasks } from '../../../services/display/TaskSplitter';
import { categorizeTasksByDate } from '../../../services/display/TaskDateCategorizer';
import { bucketBySection } from '../../../services/display/SectionClassifier';
import type { DateHeaderRenderer } from '../../sharedUI/DateHeaderRenderer';
import type { PeriodicHeaderRenderer } from '../../sharedUI/PeriodicHeaderRenderer';
import type { CardReconciler } from '../../sharedUI/CardReconciler';
import { getOverdueLevel } from '../../../services/display/TaskStatusQuery';

export class GridRenderer {
    constructor(
        private container: HTMLElement,
        private getState: () => Readonly<TimelineState>,
        private plugin: PluginContext,
        private menuHandler: MenuHandler,
        private hoverParent: HoverParent,
        private dateHeaderRenderer: DateHeaderRenderer,
        private periodicHeaderRenderer: PeriodicHeaderRenderer,
    ) {}

    public render(
        parentContainer: HTMLElement,
        allDayRenderer: AllDaySectionRenderer,
        timelineRenderer: TimelineSectionRenderer,
        moonRenderer: MoonPhaseRenderer,
        dates: string[],
        filteredTasks: DisplayTask[],
        reconciler: CardReconciler,
    ) {
        const grid = parentContainer.createDiv('timeline-grid');
        const state = this.getState();
        const colTemplate = `30px repeat(${dates.length}, minmax(0, 1fr))`;

        this.menuHandler.setViewStartDate(dates[0]);

        const startHour = this.plugin.settings.startHour;

        // 1. Pre-compute overdue dates
        const todayVisualDate = DateUtils.getVisualDateOfNow(startHour);
        const readService = this.plugin.getTaskReadService();
        const defs = this.plugin.settings.statusDefinitions;
        const overdueDates = new Set<string>();
        for (const dt of filteredTasks) {
            if (getOverdueLevel(dt, startHour, defs, readService) === 'none') continue;
            for (const date of dates) {
                if (date >= todayVisualDate) continue;
                if (dt.span && overlaps(dt.span, daysWindow(date, date, startHour))) {
                    overdueDates.add(date);
                }
            }
        }

        // 2. Periodic header (week row only, controlled by setting)
        this.periodicHeaderRenderer.render(grid, {
            dates,
            gridTemplateColumns: colTemplate,
        });

        // 3. Date header — reference year-month from the first day drawn, for contextual labels
        const refYear = parseInt(dates[0].substring(0, 4), 10);
        const refMonth = parseInt(dates[0].substring(5, 7), 10) - 1;

        this.dateHeaderRenderer.render(grid, {
            dates,
            gridTemplateColumns: colTemplate,
            isOverdue: (date) => overdueDates.has(date),
            referenceYearMonth: { year: refYear, month: refMonth },
        });

        // 4. Moon Phase Row
        const astronomyDisplay = getEffectiveAstronomyDisplay(
            state.astronomyDisplay,
            this.plugin.settings.astronomy,
        );
        grid.toggleClass('is-sun-front', astronomyDisplay.sunTimes && astronomyDisplay.sunTimesInFront);
        if (astronomyDisplay.moonPhase) {
            const moonRow = grid.createDiv('tv-grid-row moon-section');
            moonRow.style.gridTemplateColumns = colTemplate;
            moonRenderer.render(moonRow, dates);
        }

        const showAllDay = state.showAllDay ?? this.plugin.settings.showAllDay;
        const showTimeline = state.showTimeline ?? this.plugin.settings.showTimeline;

        // 5. Scroll Area (allday + timeline grid)
        const scrollArea = grid.createDiv('timeline-scroll-area');
        // Timeline draws two of the three sections: the all-day lane and the
        // time grid. A task with only a due is in neither (`dueOnly`): it has
        // no span to draw, and Timeline does not draw it (Schedule does).
        const { allDay, timed } = bucketBySection(filteredTasks);

        // 5.1. All-Day Row
        if (showAllDay) {
            const allDayRow = scrollArea.createDiv('tv-grid-row allday-section');
            allDayRow.style.gridTemplateColumns = colTemplate;

            const axisCell = allDayRow.createDiv('allday-section__cell allday-section__axis');
            axisCell.setAttribute('aria-label', t('allDaySection.allDay'));
            const axisLabel = axisCell.createEl('span', { cls: 'allday-section__label' });
            axisLabel.setText(t('allDaySection.allDay'));
            axisCell.style.gridColumn = '1';

            const dateCells: HTMLElement[] = [];
            dates.forEach((date, i) => {
                const cell = allDayRow.createDiv('allday-section__cell');
                if (i === 0) cell.addClass('is-first-cell');
                if (i === dates.length - 1) cell.addClass('is-last-cell');
                cell.dataset.date = date;
                cell.style.gridColumn = `${i + 2}`;
                allDayRenderer.addEmptySpaceContextMenu(cell, date);
                dateCells.push(cell);
            });

            const laneCount = allDayRenderer.render(allDayRow, dates, allDay, reconciler);
            const rowSpan = Math.max(laneCount + 2, 2);
            axisCell.style.gridRow = `1 / span ${rowSpan}`;
            for (const cell of dateCells) {
                cell.style.gridRow = `1 / span ${rowSpan}`;
            }
        }

        // 5.2. Timeline Grid (time axis + day columns)
        if (showTimeline) {
            const timelineGrid = scrollArea.createDiv('tv-grid-row timeline-scroll-area__grid');
            timelineGrid.style.gridTemplateColumns = colTemplate;

            const timeCol = timelineGrid.createDiv('timeline-scroll-area__axis');
            this.renderTimeLabels(timeCol);

            if (astronomyDisplay.sunTimes && dates.length > 0) {
                const { latitude, longitude } = this.plugin.settings.astronomy.location;
                attachSunAxisArrows(timeCol, dates[0], { startHour, latitude, longitude });
            }

            const splitResult = splitTasks(timed, { type: 'visual-date', startHour });
            const categorizedByDate = categorizeTasksByDate(splitResult, dates, startHour);
            dates.forEach(date => {
                const col = timelineGrid.createDiv('timeline-scroll-area__day-column');
                col.dataset.date = date;
                const timedTasks = categorizedByDate.get(date)?.timed ?? [];
                timelineRenderer.render(col, date, timedTasks, reconciler, {
                    showSunTimes: astronomyDisplay.sunTimes,
                });
                timelineRenderer.addCreateTaskListeners(col, date);
            });
        }
    }

    private renderTimeLabels(container: HTMLElement) {
        const startHour = this.plugin.settings.startHour;

        for (let i = 0; i < 24; i++) {
            const label = container.createDiv('timeline-scroll-area__time-label');
            label.style.setProperty('--label-hour', String(i));

            let displayHour = startHour + i;
            if (displayHour >= 24) displayHour -= 24;

            label.setText(`${displayHour}`);
        }
    }

    public renderCurrentTimeIndicator() {
        const existingIndicators = this.container.querySelectorAll('.current-time-indicator');
        existingIndicators.forEach(el => el.remove());

        const now = new Date();
        const startHour = this.plugin.settings.startHour;
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        let minutesFromStart = currentMinutes - (startHour * 60);
        if (minutesFromStart < 0) {
            minutesFromStart += 24 * 60;
        }

        const visualDateString = DateUtils.getVisualDateOfNow(startHour);
        const dayCol = this.container.querySelector(`.timeline-scroll-area__day-column[data-date="${visualDateString}"]`) as HTMLElement;

        if (dayCol) {
            const indicator = dayCol.createDiv({ cls: 'current-time-indicator' });
            indicator.style.setProperty('--indicator-minutes', String(minutesFromStart));
        }
    }
}
