import { Component } from 'obsidian';
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
        const headerGrid = container.createDiv('timeline-header-grid');

        // 1. Top Left: Spacer
        headerGrid.createDiv('header-grid-cell header-top-left');

        // 2. Top Right: Label
        const label = headerGrid.createDiv('header-grid-cell header-top-right');
        label.setText('Future / Unassigned');

        // 3. Bottom Left: Toggle
        const toggleCell = headerGrid.createDiv('header-grid-cell header-bottom-left');
        // const toggleBtn = toggleCell.createEl('button', { text: '-' }); // TODO: Implement toggle

        // 4. Bottom Right: Content
        const contentCell = headerGrid.createDiv('header-grid-cell header-bottom-right');
        const list = contentCell.createDiv('unassigned-task-list');

        // Get Future Tasks
        const futureTasks = this.taskIndex.getTasks().filter(t => t.isFuture);

        // Filter by visible files logic if active
        // Applying file filter to future tasks as well for consistency
        const filteredFutureTasks = visibleFiles
            ? futureTasks.filter(t => visibleFiles.has(t.file))
            : futureTasks;

        filteredFutureTasks.forEach(task => {
            const el = list.createDiv('task-card future-task-card');
            if (task.id === this.handleManager.getSelectedTaskId()) el.addClass('selected');
            el.dataset.id = task.id;

            ViewUtils.applyFileColor(this.plugin.app, el, task.file, this.plugin.settings.frontmatterColorKey);
            this.taskRenderer.render(el, task, owner, this.plugin.settings);
            this.menuHandler.addTaskContextMenu(el, task);
        });
    }
}
