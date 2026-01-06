import { Component, setIcon, Menu } from 'obsidian';
import TaskViewerPlugin from '../../../main';
import { MenuHandler } from '../../../interaction/MenuHandler';
import { ViewUtils } from '../../ViewUtils';
import { TaskIndex } from '../../../services/TaskIndex';
import { TaskRenderer } from '../../TaskRenderer';
import { HandleManager } from '../HandleManager';


export class FutureSectionRenderer {
    constructor(
        private taskIndex: TaskIndex,
        private plugin: TaskViewerPlugin,
        private menuHandler: MenuHandler,
        private handleManager: HandleManager,
        private taskRenderer: TaskRenderer
    ) { }

    public render(container: HTMLElement, owner: Component, visibleFiles: Set<string> | null, colTemplate: string, dates: string[]) {
        const headerGrid = container.createDiv('future-section-grid');
        // Use the same grid template as timeline/allday to align borders
        headerGrid.style.gridTemplateColumns = colTemplate;

        // Background Cells (Grid Lines)
        // Similar logic to AllDay section to ensure alignment
        dates.forEach((date, i) => {
            const cell = headerGrid.createDiv('future-section__cell');
            if (i === 0) {
                cell.addClass('is-first-cell');
            }
            if (i === dates.length - 1) {
                cell.addClass('is-last-cell');
            }
            // cell.dataset.date = date; // Removed as requested
            cell.style.gridColumn = `${i + 2}`; // +2 because 1 is axis
            cell.style.gridRow = '1';
            cell.style.zIndex = '0'; // Behind content
        });

        // Left: Toggle + Label
        const axisCell = headerGrid.createDiv('future-section__axis');
        // Axis is implicitly grid-column: 1

        const toggleBtn = axisCell.createEl('button', { cls: 'section-toggle-btn' });
        setIcon(toggleBtn, 'minus');
        toggleBtn.setAttribute('aria-label', 'Toggle Future section');

        const axisLabel = axisCell.createEl('span', { cls: 'future-section__label' });
        axisLabel.setText('Future');

        // Right: Content
        const contentCell = headerGrid.createDiv('future-section__content');
        // Span across all date columns
        contentCell.style.gridColumn = '2 / -1';
        contentCell.style.zIndex = '1'; // Above cells

        // Toggle functionality
        toggleBtn.addEventListener('click', () => {
            const isCollapsed = headerGrid.hasClass('collapsed');
            if (isCollapsed) {
                headerGrid.removeClass('collapsed');
                setIcon(toggleBtn, 'minus');
            } else {
                headerGrid.addClass('collapsed');
                setIcon(toggleBtn, 'plus');
            }
        });

        const list = contentCell.createDiv('future-section__list');

        // Get Future Tasks
        const futureTasks = this.taskIndex.getTasks().filter(t => t.isFuture);

        // Filter by visible files logic if active
        // Applying file filter to future tasks as well for consistency
        const filteredFutureTasks = visibleFiles
            ? futureTasks.filter(t => visibleFiles.has(t.file))
            : futureTasks;

        filteredFutureTasks.forEach(task => {
            const el = list.createDiv('task-card task-card--future');
            if (task.id === this.handleManager.getSelectedTaskId()) el.addClass('selected');
            el.dataset.id = task.id;

            ViewUtils.applyFileColor(this.plugin.app, el, task.file, this.plugin.settings.frontmatterColorKey);
            this.taskRenderer.render(el, task, owner, this.plugin.settings);
            this.menuHandler.addTaskContextMenu(el, task);
        });

        // Add context menu for empty space in Future section (on contentCell for better hit area)
        this.addEmptySpaceContextMenu(contentCell);
    }

    /** Add context menu listeners to Future section content area */
    public addEmptySpaceContextMenu(contentArea: HTMLElement) {
        contentArea.addEventListener('contextmenu', (e) => {
            // Only show menu when clicking on empty space (not on task cards)
            const target = e.target as HTMLElement;
            if (!target.closest('.task-card')) {
                e.preventDefault();
                e.stopPropagation();
                this.showEmptySpaceMenu(e.pageX, e.pageY);
            }
        });
    }

    /** Show context menu for empty space click */
    private showEmptySpaceMenu(x: number, y: number) {
        const menu = new Menu();

        // Create Future Task
        menu.addItem((item) => {
            item.setTitle('Create Future Task')
                .setIcon('plus')
                .onClick(() => this.handleCreateFutureTask());
        });

        menu.showAtPosition({ x, y });
    }

    /** Create a future task (F type: no date) */
    private handleCreateFutureTask() {
        const { CreateTaskModal } = require('../../../modals/CreateTaskModal');
        new CreateTaskModal(this.plugin.app, async (content: string) => {
            // Create future task (F type: no date, marked as future)
            const taskLine = `- [ ] ${content} @future`;

            // Add to today's daily note
            const today = new Date();
            const { DailyNoteUtils } = await import('../../../utils/DailyNoteUtils');
            await DailyNoteUtils.appendLineToDailyNote(
                this.plugin.app,
                today,
                taskLine,
                this.plugin.settings.dailyNoteHeader,
                this.plugin.settings.dailyNoteHeaderLevel
            );
        }).open();
    }
}
