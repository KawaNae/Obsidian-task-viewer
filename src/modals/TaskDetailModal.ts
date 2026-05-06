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
        // Obsidian の Modal.open() は最初の focusable 子要素 (= タスクカード
        // 内の checkbox) へ自動フォーカスする。modalEl 自身は既定では
        // tabindex 属性を持たず programmatic に focus 不可なので、tabindex="-1"
        // を付与した上で、Obsidian の auto-focus 後に rAF で focus を奪い返す。
        this.modalEl.setAttribute('tabindex', '-1');
        requestAnimationFrame(() => this.modalEl.focus());

        // CSS hook for the shared close-animation fix (`mod-tv-modal`).
        // 中央配置で `modal.height < viewport / 3` の小さいモーダルは Obsidian の
        // slide-down (距離 = modal.height 固定) では viewport を抜けきれず画面
        // 中央で DOM 削除される。`_modal.css` の `.mod-tv-modal` rule で
        // close 時に opacity fade を重ね、DOM 削除時点で必ず opacity ≈ 0 に
        // する不変条件を保証する。
        this.containerEl.addClass('mod-tv-modal');

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
        card.createDiv('task-card__shape');
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
