import { Component, setIcon } from 'obsidian';
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

    public render(container: HTMLElement, owner: Component, visibleFiles: Set<string> | null) {
        const headerGrid = container.createDiv('future-section-grid');

        // Left: Toggle + Label
        const axisCell = headerGrid.createDiv('future-section__axis');

        const toggleBtn = axisCell.createEl('button', { cls: 'section-toggle-btn' });
        setIcon(toggleBtn, 'minus');
        toggleBtn.setAttribute('aria-label', 'Toggle Future section');

        const axisLabel = axisCell.createEl('span', { cls: 'future-section__label' });
        axisLabel.setText('Future');

        // Right: Content
        const contentCell = headerGrid.createDiv('future-section__content');

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
    }
}
