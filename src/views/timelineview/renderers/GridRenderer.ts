import { setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import { ViewState, isCompleteStatusChar } from '../../../types';
import TaskViewerPlugin from '../../../main';
import { MenuHandler } from '../../../interaction/menu/MenuHandler';
import { DateUtils } from '../../../utils/DateUtils';
import { HandleManager } from '../HandleManager';
import { t } from '../../../i18n';

import { AllDaySectionRenderer } from '../../sharedUI/AllDaySectionRenderer';
import { TimelineSectionRenderer } from './TimelineSectionRenderer';
import { isDisplayTaskOnVisualDate } from '../../../services/display/DisplayTaskConverter';
import type { DisplayTask } from '../../../types';
import { HabitTrackerRenderer } from '../../sharedUI/HabitTrackerRenderer';
import { MoonPhaseRenderer } from '../../sharedUI/MoonPhaseRenderer';
import { getEffectiveAstronomyDisplay } from '../../../services/astronomy/AstronomyService';
import { attachSunAxisArrows } from '../../sharedUI/AstronomyCellAdorner';
import { splitTasks } from '../../../services/display/TaskSplitter';
import { categorizeTasksByDate } from '../../../services/display/TaskDateCategorizer';
import { bucketBySection } from '../../../services/display/SectionClassifier';
import { DateHeaderRenderer } from '../../sharedUI/DateHeaderRenderer';
import { PeriodicHeaderRenderer } from '../../sharedUI/PeriodicHeaderRenderer';
import { CardReconciler } from '../../sharedUI/CardReconciler';

export class GridRenderer {
    private isAllDayCollapsed: boolean = false;

    constructor(
        private container: HTMLElement,
        private viewState: ViewState,
        private plugin: TaskViewerPlugin,
        private menuHandler: MenuHandler,
        private hoverParent: HoverParent,
        private dateHeaderRenderer: DateHeaderRenderer,
        private periodicHeaderRenderer: PeriodicHeaderRenderer,
        private onPeriodicHeaderToggle: () => void,
    ) {}

    public render(
        parentContainer: HTMLElement,
        allDayRenderer: AllDaySectionRenderer,
        timelineRenderer: TimelineSectionRenderer,
        habitRenderer: HabitTrackerRenderer,
        moonRenderer: MoonPhaseRenderer,
        handleManager: HandleManager,
        dates: string[],
        filteredTasks: DisplayTask[],
        reconciler: CardReconciler,
    ) {
        // Use parentContainer for rendering the grid
        const grid = parentContainer.createDiv('timeline-grid');
        // Simple grid template - overlay scrollbar doesn't take space
        const colTemplate = `30px repeat(${this.viewState.daysToShow}, minmax(0, 1fr))`;

        // Set view start date for MenuHandler (for E, ED, D type implicit start display)
        this.menuHandler.setViewStartDate(dates[0]);

        const startHour = this.plugin.settings.startHour;

        // 1. Date Header Row — pre-compute overdue dates and delegate to shared renderer
        const todayVisualDate = DateUtils.getVisualDateOfNow(startHour);
        const completeChars = this.plugin.settings.statusDefinitions;
        const overdueDates = new Set<string>();
        for (const dt of filteredTasks) {
            if (isCompleteStatusChar(dt.statusChar, completeChars)) continue;
            for (const date of dates) {
                if (date >= todayVisualDate) continue;
                if (isDisplayTaskOnVisualDate(dt, date, startHour)) {
                    overdueDates.add(date);
                }
            }
        }

        const periodicCollapsed = this.viewState.periodicHeaderCollapsed ?? true;

        const periodicHeader = this.periodicHeaderRenderer.render(grid, {
            dates,
            gridTemplateColumns: colTemplate,
            collapsed: periodicCollapsed,
            onToggle: this.onPeriodicHeaderToggle,
        });

        const dateHeaderResult = this.dateHeaderRenderer.render(grid, {
            dates,
            gridTemplateColumns: colTemplate,
            isOverdue: (date) => overdueDates.has(date),
            enableCompactBehavior: true,
            forceShortLabel: !periodicCollapsed,
        });

        periodicHeader.mountInAxisCell(dateHeaderResult.axisCell);

        // 2a. Moon Phase Row (fixed, sits above habits). Only created when
        // the *effective* display flag is on — keeps the row absent entirely
        // otherwise so the grid stays compact.
        const astronomyDisplay = getEffectiveAstronomyDisplay(
            this.viewState.astronomyDisplay,
            this.plugin.settings.astronomy,
        );
        // Raise sun lines above task cards when the per-view setting asks for it.
        grid.toggleClass('is-sun-front', astronomyDisplay.sunTimes && astronomyDisplay.sunTimesInFront);
        if (astronomyDisplay.moonPhase) {
            const moonRow = grid.createDiv('tv-grid-row moon-section');
            moonRow.style.gridTemplateColumns = colTemplate;
            moonRenderer.render(moonRow, dates);
        }

        // 2b. Habits Row (fixed, outside scroll area — always visible)
        const habitsRow = grid.createDiv('tv-grid-row habits-section');
        habitsRow.style.gridTemplateColumns = colTemplate;
        habitRenderer.render(habitsRow, dates);

        // 3. Scroll Area (allday + timeline grid)
        const scrollArea = grid.createDiv('timeline-scroll-area');

        // 3.1. All-Day Row (sticky on PC, scrolls on mobile via CSS)
        const allDayRow = scrollArea.createDiv('tv-grid-row allday-section');
        allDayRow.style.gridTemplateColumns = colTemplate;

        // Time Axis All-Day (with toggle button)
        const axisCell = allDayRow.createDiv('allday-section__cell allday-section__axis');
        axisCell.setAttribute('role', 'button');
        axisCell.setAttribute('tabindex', '0');
        axisCell.setAttribute('aria-label', t('allDaySection.toggleAllDay'));

        // Toggle button
        const toggleBtn = axisCell.createEl('button', { cls: 'tv-section-toggle tv-section-toggle--axis' });
        toggleBtn.tabIndex = -1;

        // Label
        const axisLabel = axisCell.createEl('span', { cls: 'allday-section__label' });
        axisLabel.setText(t('allDaySection.allDay'));

        axisCell.style.gridColumn = '1';
        axisCell.style.gridRow = '1 / span 50'; // Span all implicit rows

        const applyAllDayCollapsedState = () => {
            setIcon(toggleBtn, this.isAllDayCollapsed ? 'plus' : 'minus');
            allDayRow.toggleClass('allday-section--collapsed', this.isAllDayCollapsed);
            axisCell.setAttribute('aria-expanded', (!this.isAllDayCollapsed).toString());
            axisCell.setAttribute('aria-label', this.isAllDayCollapsed ? t('allDaySection.expandAllDay') : t('allDaySection.collapseAllDay'));
        };

        const toggleAllDayCollapsed = () => {
            this.isAllDayCollapsed = !this.isAllDayCollapsed;
            applyAllDayCollapsedState();
        };

        // Toggle functionality
        axisCell.addEventListener('click', () => {
            toggleAllDayCollapsed();
        });

        axisCell.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleAllDayCollapsed();
            }
        });

        // Apply initial collapsed state
        applyAllDayCollapsedState();

        // Background Cells (Grid Lines)
        dates.forEach((date, i) => {
            const cell = allDayRow.createDiv('allday-section__cell');
            if (i === 0) {
                cell.addClass('is-first-cell');
                cell.dataset.collapsedLabel = t('allDaySection.allDay');
            }
            if (i === dates.length - 1) {
                cell.addClass('is-last-cell');
            }
            cell.dataset.date = date;
            cell.style.gridColumn = `${i + 2}`; // +2 because 1 is axis
            cell.style.gridRow = '1 / span 50'; // Span implicit rows (large enough number)
            cell.style.zIndex = '0';

            // Add context menu for empty space
            allDayRenderer.addEmptySpaceContextMenu(cell, date);
        });

        // セクション間で同じ task.id が両方に流れ込まないよう、ここで一度だけ
        // 振り分ける。AllDay と Timeline の両方に同一カードが描画されるバグの根治。
        const buckets = bucketBySection(filteredTasks, startHour);

        // Render Tasks (Overlaid) — allday バケツのみ渡す
        allDayRenderer.render(allDayRow, dates, buckets.allday, reconciler);

        // 3.2. Timeline Grid (time axis + day columns)
        const timelineGrid = scrollArea.createDiv('tv-grid-row timeline-scroll-area__grid');
        timelineGrid.style.gridTemplateColumns = colTemplate;

        // Time Axis Column
        const timeCol = timelineGrid.createDiv('timeline-scroll-area__axis');
        this.renderTimeLabels(timeCol);

        // Sun arrows on the time-axis right border (anchor for the per-day
        // sun lines). The axis is shared across all visible day columns, so
        // we anchor to the first visible date — sun times shift by < 2 min/day,
        // imperceptible at axis-arrow resolution.
        if (astronomyDisplay.sunTimes && dates.length > 0) {
            const { latitude, longitude } = this.plugin.settings.astronomy.location;
            attachSunAxisArrows(timeCol, dates[0], { startHour, latitude, longitude });
        }

        // Day Columns — timed + dueOnly のみ。split で segment を生成してから日付分類。
        const timelineInput = [...buckets.timed, ...buckets.dueOnly];
        const splitResult = splitTasks(timelineInput, { type: 'visual-date', startHour });
        const categorizedByDate = categorizeTasksByDate(splitResult, dates, startHour);
        dates.forEach(date => {
            const col = timelineGrid.createDiv('timeline-scroll-area__day-column');
            col.dataset.date = date;
            const timedTasks = categorizedByDate.get(date)?.timed ?? [];
            timelineRenderer.render(col, date, timedTasks, reconciler, {
                showSunTimes: astronomyDisplay.sunTimes,
            });

            // Add interaction listeners for creating tasks
            timelineRenderer.addCreateTaskListeners(col, date);
        });

        // Restore scroll position (To be handled by caller or via specific method if passed)
        // For now, TimelineView handles restoring scroll position via its lastScrollTop property logic, 
        // which might need to happen after this render returns.
    }

    private renderTimeLabels(container: HTMLElement) {
        const startHour = this.plugin.settings.startHour;

        for (let i = 0; i < 24; i++) {
            const label = container.createDiv('timeline-scroll-area__time-label');
            label.style.setProperty('--label-hour', String(i));

            // Display hour adjusted by startHour
            let displayHour = startHour + i;
            if (displayHour >= 24) displayHour -= 24;

            label.setText(`${displayHour}`);
        }
    }

    public renderCurrentTimeIndicator() {
        // Remove existing indicators
        const existingIndicators = this.container.querySelectorAll('.current-time-indicator');
        existingIndicators.forEach(el => el.remove());

        const now = new Date();
        const startHour = this.plugin.settings.startHour;

        // Calculate current time in minutes from midnight
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        // Calculate minutes relative to the visual day start
        let minutesFromStart = currentMinutes - (startHour * 60);
        if (minutesFromStart < 0) {
            minutesFromStart += 24 * 60;
        }

        // Use local date string to match the column data-date (which assumes local dates)
        const visualDateString = DateUtils.getVisualDateOfNow(startHour);

        // Find the column for this visual date
        const dayCol = this.container.querySelector(`.timeline-scroll-area__day-column[data-date="${visualDateString}"]`) as HTMLElement;

        if (dayCol) {
            const indicator = dayCol.createDiv({ cls: 'current-time-indicator' });
            indicator.style.setProperty('--indicator-minutes', String(minutesFromStart));
        }
    }
}
