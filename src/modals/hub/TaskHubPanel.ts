import { App, setIcon, TFile, type EventRef } from 'obsidian';
import { t } from '../../i18n';
import type { Task } from '../../types';
import type TaskViewerPlugin from '../../main';
import { TaskCardRenderer } from '../../views/taskcard/TaskCardRenderer';
import { TaskStyling } from '../../views/sharedUI/TaskStyling';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { TaskWriteService } from '../../services/data/TaskWriteService';
import { toDisplayTask, getOriginalTaskId } from '../../services/display/DisplayTaskConverter';
import { TaskIdGenerator } from '../../services/display/TaskIdGenerator';
import { getEffectiveColor, getEffectiveLinestyle } from '../../services/data/EffectiveProperties';
import { PopoverStack } from '../../views/sharedUI/PopoverStack';
import { OverlayShell } from '../../views/sharedUI/OverlayShell';
import { TaskHubForm, type TaskHubFocusField } from './TaskHubForm';

export interface TaskHubDeps {
    taskRenderer: TaskCardRenderer;
    menuHandler: MenuHandler;
    readService: TaskReadService;
    writeService: TaskWriteService;
    plugin: TaskViewerPlugin;
}

export interface TaskHubPanelOptions {
    focusField?: TaskHubFocusField;
}

/**
 * タスクハブパネル — 「タスクを開く」の単一の目的地。
 *
 * 上部にカードプレビュー（readService.onChange でライブ再描画）、下部に
 * プロパティ編集フォーム（フィールド確定で即保存）。read-only タスクは
 * プレビューのみに縮退。
 *
 * DOM スケルトン・swipe dismiss・close animation・keyboard awareness・
 * escape handling は OverlayShell (mode: 'centered') に委譲。
 * このクラスは domain logic（singleton・live update・preview・form）のみ。
 */
export class TaskHubPanel {
    private static active: TaskHubPanel | null = null;

    private task: Task;
    private overlay = new OverlayShell();
    readonly stack = new PopoverStack();
    private previewEl: HTMLElement | null = null;
    private form: TaskHubForm | null = null;
    private unsubscribe: (() => void) | null = null;
    private renameRef: EventRef | null = null;

    constructor(
        private app: App,
        task: Task,
        private deps: TaskHubDeps,
        private options: TaskHubPanelOptions = {},
    ) {
        const originalId = getOriginalTaskId(task);
        this.task = deps.readService.getTask(originalId) ?? task;
    }

    open(): void {
        if (this.overlay.isOpen()) return;
        TaskHubPanel.active?.close();
        TaskHubPanel.active = this;

        this.overlay.open({
            mode: 'centered',
            panelClass: 'task-hub',
            childStack: this.stack,
            build: (bodyEl) => this.buildContent(bodyEl),
            onClose: () => this.teardown(),
        });

        if (this.options.focusField && this.form) {
            const field = this.options.focusField;
            requestAnimationFrame(() => this.form?.focusField(field));
        }

        this.setupLiveUpdates();
    }

    private buildContent(bodyEl: HTMLElement): void {
        const toggle = bodyEl.createDiv({ cls: 'task-hub__preview-toggle' });
        setIcon(toggle.createSpan(), 'chevron-up');
        toggle.setAttribute('aria-label', t('modal.hub.togglePreview'));
        toggle.addEventListener('click', () => {
            const collapsed = !this.previewEl?.hasClass('is-collapsed');
            this.previewEl?.toggleClass('is-collapsed', collapsed);
            toggle.toggleClass('is-collapsed', collapsed);
        });

        this.previewEl = bodyEl.createDiv({ cls: 'task-hub__preview' });
        const formHost = bodyEl.createDiv({ cls: 'task-hub__form' });

        void this.renderPreview();

        if (this.task.isReadOnly) {
            formHost.createDiv({
                cls: 'task-hub__read-only-notice',
                text: t('modal.hub.readOnlyNotice'),
            });
        } else {
            this.form = new TaskHubForm(formHost, this.task, {
                app: this.app,
                plugin: this.deps.plugin,
                readService: this.deps.readService,
                writeService: this.deps.writeService,
                stack: this.stack,
                onNavigate: () => this.close(),
            });
        }
    }

    private setupLiveUpdates(): void {
        this.unsubscribe = this.deps.readService.onChange((taskId) => {
            if (taskId !== undefined && taskId !== this.task.id) return;
            const fresh = this.deps.readService.getTask(this.task.id);
            if (fresh) {
                this.task = fresh;
                void this.renderPreview();
                this.form?.refresh(fresh);
            } else {
                this.form?.setMissing();
            }
        });

        this.renameRef = this.app.vault.on('rename', (file, oldPath) => {
            if (!(file instanceof TFile) || file.extension !== 'md') return;
            const newId = TaskIdGenerator.renameFile(this.task.id, oldPath, file.path);
            if (newId === this.task.id) return;
            this.task = { ...this.task, id: newId, file: file.path };
            this.form?.handleFileRename(newId, file.path);
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

        const closePanel = () => this.close();
        this.deps.menuHandler.addTaskContextMenu(card, this.task, {
            onDestructiveAction: closePanel,
            onOpenPropertiesFocus: (field) => this.form?.focusField(field),
        });

        const dt = toDisplayTask(this.task, settings.startHour, (id) => this.deps.readService.getTask(id));
        await this.deps.taskRenderer.render(card, dt, settings, {
            cardInstanceId: `hub::${dt.id}`,
            context: 'hub-preview',
            hooks: { onNavigate: closePanel },
        });
    }

    private teardown(): void {
        if (TaskHubPanel.active === this) TaskHubPanel.active = null;

        this.unsubscribe?.();
        this.unsubscribe = null;
        if (this.renameRef) {
            this.app.vault.offref(this.renameRef);
            this.renameRef = null;
        }
        if (this.previewEl) this.deps.taskRenderer.disposeInside(this.previewEl);
        this.previewEl = null;
        this.form = null;
    }

    close(): void {
        this.overlay.close();
    }
}
