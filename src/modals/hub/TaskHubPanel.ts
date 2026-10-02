import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { Task } from '../../types';
import type { PluginContext } from '../../PluginContext';
import type { TaskCardRenderer } from '../../views/taskcard/TaskCardRenderer';
import type { IndexReads } from '../../services/core/TaskIndex';
import type { Operations } from '../../services/operations/Operations';
import { toDisplayTask, getOriginalTaskId } from '../../services/display/DisplayTaskConverter';
import { PopoverStack } from '../../views/sharedUI/PopoverStack';
import { OverlayShell } from '../../views/sharedUI/OverlayShell';
import { TaskHubForm, type TaskHubFocusField } from './TaskHubForm';
import { TaskHubSource } from './TaskHubSource';
import { TaskHubSourceView } from './TaskHubSourceView';
import { hostWindow } from '../../utils/HostWindow';
import { indentUnit } from '../../utils/ObsidianConfig';

export interface TaskHubDeps {
    taskRenderer: TaskCardRenderer;
    index: IndexReads;
    operations: Operations;
    plugin: PluginContext;
}

export interface TaskHubPanelOptions {
    focusField?: TaskHubFocusField;
}

/**
 * タスクハブパネル — 「タスクを開く」の単一の目的地。
 *
 * 上部にカードプレビュー（index.onChange でライブ再描画）、下部に
 * プロパティ編集フォーム（フィールド確定で即保存）。read-only タスクは
 * プレビューのみに縮退。プレビューの上の切り替えで、カードの代わりに
 * 行と部分木のソースを編集できる（TaskHubSource）。ソースに下書きがある間、
 * 利用者が閉じる経路は下書きを捨てるかを確かめる（OverlayShell.beforeClose）。
 * 別のハブを開こうとしたときも同じく確かめるだけで、開こうとした操作は忘れる。
 * パネルにフォーカスがある間は Obsidian のホットキーを止める（OverlayShell の
 * keymap）。フォームの欄やソースのエディタのキーが背後のノートに効かないように。
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
    private source: TaskHubSource | null = null;
    private unsubscribe: (() => void) | null = null;

    constructor(
        private app: App,
        task: Task,
        private deps: TaskHubDeps,
        private options: TaskHubPanelOptions = {},
    ) {
        // A segment of a split task is a key within the display: the hub
        // works on its row, by the row's name.
        const originalId = getOriginalTaskId(task);
        this.task = deps.index.getTask(originalId) ?? { ...task, id: originalId };
    }

    open(): void {
        if (this.overlay.isOpen()) return;
        // Another hub gives way as the user closing it would: not while it
        // holds a draft, which it asks about in its own place. This hub is
        // not opened then, nor later: throwing the draft away there closes
        // that hub and goes no further.
        const current = TaskHubPanel.active;
        if (current && !current.overlay.requestClose()) return;
        TaskHubPanel.active = this;

        this.overlay.open({
            mode: 'centered',
            panelClass: 'tv-overlay__panel--dialog task-hub',
            childStack: this.stack,
            keymap: this.app.keymap,
            build: (bodyEl) => this.buildContent(bodyEl),
            onClose: () => this.teardown(),
            beforeClose: () => this.source?.beforeClose() ?? true,
            yieldsEscape: () => this.source?.yieldsEscape() ?? false,
            takesBack: () => this.source?.takesBack() ?? false,
        });

        if (this.options.focusField && this.form) {
            const field = this.options.focusField;
            // overlay が実際に載っている window のフレームで focus する（popout 対応）。
            hostWindow(this.overlay.getPanel()).requestAnimationFrame(() => this.form?.focusField(field));
        }

        this.setupLiveUpdates();
    }

    private buildContent(bodyEl: HTMLElement): void {
        const bar = bodyEl.createDiv();
        this.previewEl = bodyEl.createDiv({ cls: 'task-hub__preview' });
        const sourceHost = bodyEl.createDiv();
        const formHost = bodyEl.createDiv({ cls: 'task-hub__form' });

        this.renderPreview();

        if (this.task.isReadOnly) {
            formHost.createDiv({
                cls: 'task-hub__read-only-notice',
                text: t('modal.hub.readOnlyNotice'),
            });
        } else {
            this.form = new TaskHubForm(formHost, this.task, {
                app: this.app,
                plugin: this.deps.plugin,
                index: this.deps.index,
                operations: this.deps.operations,
                stack: this.stack,
                onNavigate: () => this.close(),
            });
        }

        const view = new TaskHubSourceView(this.app, bar, this.previewEl, sourceHost, {
            enter: () => { void this.source?.enter(); },
            apply: () => { void this.source?.apply(); },
            cancel: () => this.source?.cancel(),
            discard: () => this.source?.discard(),
            keep: () => this.source?.keep(),
            draftText: () => this.source?.draftText() ?? null,
        });
        this.source = new TaskHubSource(this.task, {
            drained: () => this.form?.drained() ?? Promise.resolve(),
            confirm: (id) => this.deps.operations.confirmTask(id),
            reread: (id) => this.deps.index.getTask(id),
            // The refusal is shown under the draft it leaves; a notice would say it twice.
            replace: (id, base, replacement) => this.deps.operations.replaceSubtree(id, base, replacement, { tellRefusal: false }),
            indentUnit: () => indentUnit(this.app),
            lockForm: (locked) => this.form?.setSourceOpen(locked),
            closeHub: () => this.close(),
        }, view);
    }

    private setupLiveUpdates(): void {
        this.unsubscribe = this.deps.index.onChange((taskId) => {
            if (taskId !== undefined && taskId !== this.task.id) return;
            const fresh = this.deps.index.getTask(this.task.id);
            if (fresh) {
                this.task = fresh;
                this.renderPreview();
                this.form?.refresh(fresh);
            } else {
                this.form?.setMissing();
            }
            this.source?.follow(fresh);
        });
    }

    private renderPreview(): void {
        if (!this.previewEl) return;
        const settings = this.deps.plugin.settings;

        this.deps.taskRenderer.disposeInside(this.previewEl);
        this.previewEl.empty();

        const card = this.previewEl.createDiv('task-card task-card--in-hub-preview');
        const closePanel = () => this.close();

        const dt = toDisplayTask(this.task, settings.startHour, (id) => this.deps.index.getTask(id));
        this.deps.taskRenderer.render(card, dt, settings, {
            key: { scope: 'hub', name: dt.id },
            // The user asked to look at this task: all of it, its links
            // live, unmasked. A double tap would open the hub it is in.
            expandChildren: true,
            alwaysLinks: true,
            doubleTap: false,
            mask: false,
            hooks: {
                onNavigate: closePanel,
                // The menu's destructive items close the hub, and its
                // Properties items go to this hub's form, not a hub on top.
                menu: {
                    onDestructiveAction: closePanel,
                    onOpenPropertiesFocus: (field) => this.form?.focusField(field),
                },
            },
        });
    }

    private teardown(): void {
        if (TaskHubPanel.active === this) TaskHubPanel.active = null;

        this.unsubscribe?.();
        this.unsubscribe = null;
        this.source?.dispose();
        this.source = null;
        if (this.previewEl) this.deps.taskRenderer.disposeInside(this.previewEl);
        this.previewEl = null;
        this.form = null;
    }

    /** Close now, asking nothing: a navigation away, or a destructive action. */
    close(): void {
        this.overlay.close();
    }
}
