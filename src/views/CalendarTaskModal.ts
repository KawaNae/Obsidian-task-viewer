import { App, Component, Modal } from 'obsidian';
import { MenuHandler } from '../interaction/menu/MenuHandler';
import { Task, TaskViewerSettings } from '../types';
import { ViewUtils } from './ViewUtils';
import { TaskCardRenderer } from './taskcard/TaskCardRenderer';

export class CalendarTaskModal extends Modal {
    constructor(
        app: App,
        private tasks: Task[],
        private dateStr: string,
        private taskRenderer: TaskCardRenderer,
        private ownerComponent: Component,
        private settings: TaskViewerSettings,
        private menuHandler: MenuHandler,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('calendar-task-modal');

        contentEl.createEl('h2', { text: `Tasks on ${this.dateStr}` });
        const taskList = contentEl.createDiv('calendar-modal-task-list');

        void this.renderTaskCards(taskList);
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private async renderTaskCards(taskList: HTMLElement): Promise<void> {
        for (const task of this.tasks) {
            const wrapper = taskList.createDiv('calendar-modal-task-wrapper');
            const card = wrapper.createDiv('task-card');
            card.addClass('calendar-task-card');
            if (!task.startTime) {
                card.addClass('task-card--allday');
            }

            ViewUtils.applyFileColor(this.app, card, task.file, this.settings.frontmatterTaskKeys.color);
            ViewUtils.applyFileLinestyle(this.app, card, task.file, this.settings.frontmatterTaskKeys.linestyle);
            this.menuHandler.addTaskContextMenu(card, task);
            await this.taskRenderer.render(card, task, this.ownerComponent, this.settings);
        }
    }
}
