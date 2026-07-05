import { App, Modal, Platform, setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { Task } from '../../types';
import type TaskViewerPlugin from '../../main';
import { TaskCardRenderer } from '../../views/taskcard/TaskCardRenderer';
import { TaskStyling } from '../../views/sharedUI/TaskStyling';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { TaskWriteService } from '../../services/data/TaskWriteService';
import { toDisplayTask, getOriginalTaskId } from '../../services/display/DisplayTaskConverter';
import { getEffectiveColor, getEffectiveLinestyle } from '../../services/data/EffectiveProperties';
import { TaskHubForm, type TaskHubFocusField } from './TaskHubForm';

export interface TaskHubDeps {
    taskRenderer: TaskCardRenderer;
    menuHandler: MenuHandler;
    readService: TaskReadService;
    writeService: TaskWriteService;
    plugin: TaskViewerPlugin;
}

export interface TaskHubModalOptions {
    /** 開いた直後にフォーカスするフォームフィールド */
    focusField?: TaskHubFocusField;
}

/**
 * タスクハブモーダル — 「タスクを開く」の単一の目的地。
 * 上部にカードプレビュー（旧 TaskDetailModal 相当、readService.onChange で
 * ライブ再描画）、下部にプロパティ編集フォーム（フィールド確定で即保存）を
 * 持つ。read-only タスク（外部プラグイン記法）はプレビューのみに縮退する。
 */
export class TaskHubModal extends Modal {
    private unsubscribe: (() => void) | null = null;
    private task: Task;
    private previewEl: HTMLElement | null = null;
    private form: TaskHubForm | null = null;

    constructor(
        app: App,
        task: Task,
        private deps: TaskHubDeps,
        private options: TaskHubModalOptions = {},
    ) {
        super(app);
        // split segment → original 解決（MenuHandler.showContextMenu と同規約）
        const originalId = getOriginalTaskId(task);
        this.task = deps.readService.getTask(originalId) ?? task;
    }

    async onOpen(): Promise<void> {
        // Obsidian の Modal.open() は最初の focusable 子要素 (= プレビュー
        // カード内の checkbox) へ自動フォーカスする。modalEl 自身は既定では
        // tabindex 属性を持たず programmatic に focus 不可なので、tabindex="-1"
        // を付与した上で、auto-focus 後に rAF で focus を制御する。
        this.modalEl.setAttribute('tabindex', '-1');
        this.modalEl.addClass('tv-hub-modal');

        // CSS hook for the shared close-animation fix (`mod-tv-modal`);
        // see `_modal.css`.
        this.containerEl.addClass('mod-tv-modal');

        const { contentEl } = this;
        contentEl.addClass('task-hub-modal');

        // モバイル: プレビュー折りたたみトグル（初期展開）。縦空間が限られる
        // phone でフォームの視認領域を確保する。
        if (Platform.isPhone) {
            const toggle = contentEl.createDiv({ cls: 'task-hub-modal__preview-toggle' });
            setIcon(toggle.createSpan(), 'chevron-up');
            toggle.setAttribute('aria-label', t('modal.hub.togglePreview'));
            toggle.addEventListener('click', () => {
                const collapsed = !this.previewEl?.hasClass('is-collapsed');
                this.previewEl?.toggleClass('is-collapsed', collapsed);
                toggle.toggleClass('is-collapsed', collapsed);
            });
        }

        this.previewEl = contentEl.createDiv('task-hub-modal__preview');
        const formHost = contentEl.createDiv('task-hub-modal__form');

        await this.renderPreview();

        if (this.task.isReadOnly) {
            formHost.createDiv({
                cls: 'task-hub-modal__read-only-notice',
                text: t('modal.hub.readOnlyNotice'),
            });
        } else {
            this.form = new TaskHubForm(formHost, this.task, {
                app: this.app,
                plugin: this.deps.plugin,
                readService: this.deps.readService,
                writeService: this.deps.writeService,
                onNavigate: () => this.close(),
            });
        }

        requestAnimationFrame(() => {
            if (this.options.focusField && this.form) {
                this.form.focusField(this.options.focusField);
            } else {
                this.modalEl.focus();
            }
        });

        this.unsubscribe = this.deps.readService.onChange(() => {
            const fresh = this.deps.readService.getTask(this.task.id);
            if (fresh) {
                this.task = fresh;
                void this.renderPreview();
                this.form?.refresh(fresh);
            } else {
                this.form?.setMissing();
            }
        });
    }

    private async renderPreview(): Promise<void> {
        if (!this.previewEl) return;
        const settings = this.deps.plugin.settings;

        this.deps.taskRenderer.disposeInside(this.previewEl);
        this.previewEl.empty();

        const card = this.previewEl.createDiv('task-card');
        TaskStyling.applyTaskColor(card, getEffectiveColor(this.task) ?? null);
        TaskStyling.applyTaskLinestyle(card, getEffectiveLinestyle(this.task) ?? null);
        TaskStyling.applyReadOnly(card, this.task);

        const closeModal = () => this.close();
        this.deps.menuHandler.addTaskContextMenu(card, this.task, {
            onDestructiveAction: closeModal,
            // hub 内メニューの Properties 項目は modal を積まず自フォームへ focus
            onOpenPropertiesFocus: (field) => this.form?.focusField(field),
        });

        const dt = toDisplayTask(this.task, settings.startHour, (id) => this.deps.readService.getTask(id));
        await this.deps.taskRenderer.render(card, dt, settings, {
            cardInstanceId: `modal::hub::${dt.id}`,
            context: 'detail-modal',
            hooks: { onNavigate: closeModal },
        });
    }

    onClose(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        if (this.previewEl) this.deps.taskRenderer.disposeInside(this.previewEl);
        this.contentEl.empty();
    }
}
