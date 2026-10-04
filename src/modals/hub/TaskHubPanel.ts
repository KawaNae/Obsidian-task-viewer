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
 * 行と部分木のソースを編集できる（TaskHubSource）。
 * 利用者が閉じる経路（×、Escape、外側、下へ払う、戻る、別のハブを開く）は
 * どれも OverlayShell.beforeClose を通る。ソースに下書きがあれば捨てるかを
 * 確かめ、無ければフォームが打ちかけの欄を保存し、保存できない値があれば
 * 問い、書き込みを待つ（TaskHubForm.beforeClose）。閉じなかったなら、別の
 * ハブを開こうとした操作は忘れる。
 * パネルにフォーカスがある間は Obsidian のホットキーを止める（OverlayShell の
 * keymap）。フォームの欄やソースのエディタのキーが背後のノートに効かないように。
 * 初めのフォーカスは focusField の欄、無ければパネル自身（OverlayShell の
 * initialFocus）。開いた直後から止まり、スマホでキーボードは上がらない。
 *
 * DOM スケルトン・swipe dismiss・close animation・keyboard awareness・
 * escape handling は OverlayShell (mode: 'centered') に委譲。
 * このクラスは domain logic（singleton・live update・preview・form）のみ。
 */
export class TaskHubPanel {
    private static active: TaskHubPanel | null = null;
    /** The hub asked for last; one asked for while another waits for a hub to close goes before it. */
    private static wanted: TaskHubPanel | null = null;

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

    /**
     * Open, once the hub open now has given way as the user closing it
     * would: not while it holds a draft, which it asks about in its own
     * place. This hub is not opened then, nor later: throwing the draft
     * away there closes that hub and goes no further. A close that waits
     * (`CloseAnswer`) is waited for; a hub asked for meanwhile goes first.
     */
    async open(): Promise<void> {
        if (this.overlay.isOpen()) return;
        TaskHubPanel.wanted = this;
        for (let current = TaskHubPanel.active; current; current = TaskHubPanel.active) {
            const closed = await current.overlay.requestClose();
            if (TaskHubPanel.wanted !== this) return;
            if (!closed) {
                TaskHubPanel.wanted = null;
                return;
            }
            // Closed: its teardown let go of the place, which this makes sure of.
            if (TaskHubPanel.active === current) TaskHubPanel.active = null;
        }
        TaskHubPanel.wanted = null;
        TaskHubPanel.active = this;

        const focusField = this.options.focusField;
        this.overlay.open({
            mode: 'centered',
            panelClass: 'tv-overlay__panel--dialog task-hub',
            childStack: this.stack,
            keymap: this.app.keymap,
            initialFocus: () => (focusField ? this.form?.fieldElement(focusField) ?? null : null),
            build: (bodyEl) => this.buildContent(bodyEl),
            onClose: () => this.teardown(),
            // The source's draft first: while the source is open the form is shut.
            beforeClose: () => ((this.source?.beforeClose() ?? true) ? this.form?.beforeClose() ?? 'close' : 'stay'),
            yieldsEscape: () => this.source?.yieldsEscape() ?? false,
            takesBack: () => this.source?.takesBack() ?? false,
        });

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
                requestClose: () => { void this.overlay.requestClose(); },
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
        this.form?.dispose();
        this.form = null;
    }

    /** Close now, asking nothing: a navigation away, or a destructive action. */
    close(): void {
        this.overlay.close();
    }
}
