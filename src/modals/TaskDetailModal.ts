import { App, Modal } from 'obsidian';
import { Task, TaskViewerSettings } from '../types';
import { TaskCardRenderer } from '../views/taskcard/TaskCardRenderer';
import { TaskStyling } from '../views/sharedUI/TaskStyling';
import { MenuHandler } from '../interaction/menu/MenuHandler';
import type { TaskReadService } from '../services/data/TaskReadService';
import { toDisplayTask } from '../services/display/DisplayTaskConverter';

export class TaskDetailModal extends Modal {
    private unsubscribe: (() => void) | null = null;

    constructor(
        app: App,
        private task: Task,
        private taskRenderer: TaskCardRenderer,
        private menuHandler: MenuHandler,
        private settings: TaskViewerSettings,
        private readService: TaskReadService
    ) {
        super(app);
    }

    async onOpen(): Promise<void> {
        await this.renderCard();

        this.unsubscribe = this.readService.onChange(() => {
            const fresh = this.readService.getTask(this.task.id);
            if (fresh) {
                this.task = fresh;
                void this.renderCard();
            }
        });
    }

    private async renderCard(): Promise<void> {
        const { contentEl } = this;
        this.taskRenderer.disposeInside(contentEl);
        contentEl.empty();
        contentEl.addClass('task-detail-modal');

        const card = contentEl.createDiv('task-card');
        TaskStyling.applyTaskColor(card, this.task.color ?? null);
        TaskStyling.applyTaskLinestyle(card, this.task.linestyle ?? null);
        TaskStyling.applyReadOnly(card, this.task);
        const closeModal = () => this.close();
        this.menuHandler.addTaskContextMenu(card, this.task, { onDestructiveAction: closeModal });

        const dt = toDisplayTask(this.task, this.settings.startHour, (id) => this.readService.getTask(id));
        await this.taskRenderer.render(card, dt, this.settings, {
            cardInstanceId: `modal::detail::${dt.id}`,
            context: 'detail-modal',
            hooks: { onNavigate: closeModal },
        });
    }

    onClose(): void {
        this.unsubscribe?.();
        this.taskRenderer.disposeInside(this.contentEl);
        this.contentEl.empty();
    }
}
