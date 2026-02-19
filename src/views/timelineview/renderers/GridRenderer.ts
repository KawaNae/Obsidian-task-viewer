import { Component, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import { ViewState, isCompleteStatusChar } from '../../../types';
import TaskViewerPlugin from '../../../main';
import { MenuHandler } from '../../../interaction/menu/MenuHandler';
import { DateUtils } from '../../../utils/DateUtils';
import { HandleManager } from '../HandleManager';
import { DailyNoteUtils } from '../../../utils/DailyNoteUtils';
import { TaskLinkInteractionManager } from '../../taskcard/TaskLinkInteractionManager';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../../constants/hover';

import { AllDaySectionRenderer } from './AllDaySectionRenderer';
import { TimelineSectionRenderer } from './TimelineSectionRenderer';
import { TaskIndex } from '../../../services/core/TaskIndex';
import { HabitTrackerRenderer } from './HabitTrackerRenderer';

type DateHeaderDisplayEntry = {
    cell: HTMLElement;
    linkEl: HTMLElement;
    fullLabel: string;
    mediumLabel: string;
    shortLabel: string;
};

export class GridRenderer {
    private isAllDayCollapsed: boolean = false;

    constructor(
        private container: HTMLElement,
        private viewState: ViewState,
        private plugin: TaskViewerPlugin,
        private menuHandler: MenuHandler,
        private taskIndex: TaskIndex
    ) { }

    public render(
        parentContainer: HTMLElement,
        allDayRenderer: AllDaySectionRenderer,
        timelineRenderer: TimelineSectionRenderer,
        habitRenderer: HabitTrackerRenderer,
        handleManager: HandleManager,
        getDatesToShow: () => string[],
        owner: Component,
        visibleFiles: Set<string> | null
    ) {
        // Use parentContainer for rendering the grid
        const grid = parentContainer.createDiv('timeline-grid');
        const dates = getDatesToShow();
        // Simple grid template - overlay scrollbar doesn't take space
        const colTemplate = `30px repeat(${this.viewState.daysToShow}, minmax(0, 1fr))`;

        // Set view start date for MenuHandler (for E, ED, D type implicit start display)
        this.menuHandler.setViewStartDate(dates[0]);



        // 1. Date Header Row
        const headerRow = grid.createDiv('timeline-row date-header');
        headerRow.style.gridTemplateColumns = colTemplate;

        // Time Axis Header
        headerRow.createDiv('date-header__cell').setText(' ');
        // Get today's visual date for highlighting
        const todayVisualDate = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);

        // Day Headers
        const headerCells: DateHeaderDisplayEntry[] = [];
        const dateLinkInteractionManager = new TaskLinkInteractionManager(this.plugin.app);
        dates.forEach(date => {
            const cell = headerRow.createDiv('date-header__cell');
            const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

            const dateObj = this.parseLocalDate(date);
            const linkTarget = DailyNoteUtils.getDailyNoteLinkTarget(this.plugin.app, dateObj);
            const linkLabel = DailyNoteUtils.getDailyNoteLabelForDate(this.plugin.app, dateObj);
            const fullLabel = `${linkLabel} ${dayName}`;
            const mediumLabel = linkLabel;
            const shortLabel = date.slice(5);

            const linkEl = cell.createEl('a', { cls: 'internal-link date-header__date-link', text: fullLabel });
            linkEl.dataset.href = linkTarget;
            linkEl.setAttribute('href', linkTarget);
            linkEl.setAttribute('aria-label', `Open daily note: ${fullLabel}`);
            linkEl.addEventListener('click', (event: MouseEvent) => {
                event.preventDefault();
            });

            dateLinkInteractionManager.bind(cell, {
                sourcePath: '',
                hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
                hoverParent: owner as unknown as HoverParent,
            }, { bindClick: false });

            headerCells.push({
                cell,
                linkEl,
                fullLabel,
                mediumLabel,
                shortLabel,
            });

            // Highlight today's date
            if (date === todayVisualDate) {
                cell.addClass('is-today');
            }

            // Check if this date has incomplete overdue tasks
            if (date < todayVisualDate) {
                const tasksForDate = this.taskIndex.getTasksForVisualDay(date, this.plugin.settings.startHour);
                const hasOverdueTasks = tasksForDate.some(t => !isCompleteStatusChar(t.statusChar, this.plugin.settings.completeStatusChars));
                if (hasOverdueTasks) {
                    cell.addClass('has-overdue');
                }
            }

            cell.dataset.date = date;

            // Add click listener to open daily note
            cell.addEventListener('click', async () => {
                let file = DailyNoteUtils.getDailyNote(this.plugin.app, dateObj);
                if (!file) {
                    file = await DailyNoteUtils.createDailyNote(this.plugin.app, dateObj);
                }
                if (file) {
                    await this.plugin.app.workspace.getLeaf(false).openFile(file);
                }
            });
        });
        this.applyDateHeaderCompactBehavior(headerCells);

        // 1.5. Habits Row (between date header and all-day)
        if (this.plugin.settings.habits.length > 0) {
            const habitsRow = grid.createDiv('timeline-row habits-section');
            habitsRow.style.gridTemplateColumns = colTemplate;
            habitRenderer.render(habitsRow, dates);
        }

        // 2. All-Day Row (Merged All-Day & Long-Term)
        const allDayRow = grid.createDiv('timeline-row allday-section');
        allDayRow.style.gridTemplateColumns = colTemplate;

        // Time Axis All-Day (with toggle button)
        const axisCell = allDayRow.createDiv('allday-section__cell allday-section__axis');
        axisCell.setAttribute('role', 'button');
        axisCell.setAttribute('tabindex', '0');
        axisCell.setAttribute('aria-label', 'Toggle All Day section');

        // Toggle button
        const toggleBtn = axisCell.createEl('button', { cls: 'section-toggle-btn' });
        toggleBtn.tabIndex = -1;
        toggleBtn.setAttribute('aria-hidden', 'true');

        // Label
        const axisLabel = axisCell.createEl('span', { cls: 'allday-section__label' });
        axisLabel.setText('All Day');

        axisCell.style.gridColumn = '1';
        axisCell.style.gridRow = '1 / span 50'; // Span all implicit rows

        const applyAllDayCollapsedState = () => {
            setIcon(toggleBtn, this.isAllDayCollapsed ? 'plus' : 'minus');
            allDayRow.toggleClass('collapsed', this.isAllDayCollapsed);
            axisCell.setAttribute('aria-expanded', (!this.isAllDayCollapsed).toString());
            axisCell.setAttribute('title', this.isAllDayCollapsed ? 'Expand All Day' : 'Collapse All Day');
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

        // Render Tasks (Overlaid)
        allDayRenderer.render(allDayRow, dates, owner, visibleFiles);

        // 3. Timeline Row (Scrollable)
        const scrollArea = grid.createDiv('timeline-row timeline-scroll-area');
        // Overlay scrollbar doesn't take space, so all rows use same template
        scrollArea.style.gridTemplateColumns = colTemplate;

        // Note: scroll/wheel listeners for handle position updates are no longer needed
        // since handles are now inside task cards and scroll with them naturally.

        // Time Axis Column
        const timeCol = scrollArea.createDiv('time-axis-column');
        this.renderTimeLabels(timeCol);

        // Day Columns
        dates.forEach(date => {
            const col = scrollArea.createDiv('day-timeline-column');
            col.dataset.date = date;
            timelineRenderer.render(col, date, owner, visibleFiles);

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
            const label = container.createDiv('time-label');
            label.style.setProperty('--label-hour', String(i));

            // Display hour adjusted by startHour
            let displayHour = startHour + i;
            if (displayHour >= 24) displayHour -= 24;

            label.setText(`${displayHour}`);
        }
    }

    private applyDateHeaderCompactBehavior(entries: DateHeaderDisplayEntry[]) {
        const compactThresholdPx = 120;
        const narrowThresholdPx = 90;
        const entryMap = new Map<HTMLElement, DateHeaderDisplayEntry>();
        entries.forEach((entry) => entryMap.set(entry.cell, entry));

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const cell = entry.target as HTMLElement;
                const displayEntry = entryMap.get(cell);
                if (!displayEntry) {
                    continue;
                }

                const isCompact = entry.contentRect.width < compactThresholdPx;
                const isNarrow = entry.contentRect.width < narrowThresholdPx;
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
        entries.forEach((entry) => observer.observe(entry.cell));
    }

    private parseLocalDate(date: string): Date {
        const [year, month, day] = date.split('-').map(Number);
        return new Date(year, month - 1, day, 0, 0, 0, 0);
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
        const dayCol = this.container.querySelector(`.day-timeline-column[data-date="${visualDateString}"]`) as HTMLElement;

        if (dayCol) {
            const indicator = dayCol.createDiv({ cls: 'current-time-indicator' });
            indicator.style.setProperty('--indicator-minutes', String(minutesFromStart));
        }
    }
}
