import { Component, setIcon } from 'obsidian';
import { ViewState, isCompleteStatusChar } from '../../../types';
import TaskViewerPlugin from '../../../main';
import { MenuHandler } from '../../../interaction/MenuHandler';
import { DateUtils } from '../../../utils/DateUtils';
import { HandleManager } from '../HandleManager';
import { DailyNoteUtils } from '../../../utils/DailyNoteUtils';

import { AllDaySectionRenderer } from './AllDaySectionRenderer';
import { TimelineSectionRenderer } from './TimelineSectionRenderer';
import { TaskIndex } from '../../../services/TaskIndex';

export class GridRenderer {
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
        dates.forEach(date => {
            const cell = headerRow.createDiv('date-header__cell');
            const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
            cell.setText(`${date} (${dayName})`);

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
                const dateObj = new Date(date);
                // Fix timezone offset for daily note creation
                const [y, m, d] = date.split('-').map(Number);
                dateObj.setFullYear(y, m - 1, d);
                dateObj.setHours(0, 0, 0, 0);

                let file = DailyNoteUtils.getDailyNote(this.plugin.app, dateObj);
                if (!file) {
                    file = await DailyNoteUtils.createDailyNote(this.plugin.app, dateObj);
                }
                if (file) {
                    await this.plugin.app.workspace.getLeaf(false).openFile(file);
                }
            });
        });

        // 2. All-Day Row (Merged All-Day & Long-Term)
        const allDayRow = grid.createDiv('timeline-row allday-section');
        allDayRow.style.gridTemplateColumns = colTemplate;

        // Time Axis All-Day (with toggle button)
        const axisCell = allDayRow.createDiv('allday-section__cell allday-section__axis');

        // Toggle button
        // Toggle button
        const toggleBtn = axisCell.createEl('button', { cls: 'section-toggle-btn' });
        setIcon(toggleBtn, 'minus');
        toggleBtn.setAttribute('aria-label', 'Toggle All Day section');

        // Label
        const axisLabel = axisCell.createEl('span', { cls: 'allday-section__label' });
        axisLabel.setText('All Day');

        axisCell.style.gridColumn = '1';
        axisCell.style.gridRow = '1 / span 50'; // Span all implicit rows

        // Toggle functionality
        toggleBtn.addEventListener('click', () => {
            const isCollapsed = allDayRow.hasClass('collapsed');
            if (isCollapsed) {
                allDayRow.removeClass('collapsed');
                setIcon(toggleBtn, 'minus');
            } else {
                allDayRow.addClass('collapsed');
                setIcon(toggleBtn, 'plus');
            }
        });

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
        const zoomLevel = this.plugin.settings.zoomLevel;

        for (let i = 0; i < 24; i++) {
            const label = container.createDiv('time-label');
            label.style.top = `${i * 60 * zoomLevel}px`;

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
        const dayCol = this.container.querySelector(`.day-timeline-column[data-date="${visualDateString}"]`) as HTMLElement;

        if (dayCol) {
            const indicator = dayCol.createDiv({ cls: 'current-time-indicator' });
            const zoomLevel = this.plugin.settings.zoomLevel;
            indicator.style.top = `${minutesFromStart * zoomLevel}px`;
        }
    }
}
