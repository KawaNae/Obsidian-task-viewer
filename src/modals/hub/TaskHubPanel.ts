import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { Task } from '../../types';
import type { PluginContext } from '../../PluginContext';
import type { TaskCardRenderer } from '../../views/taskcard/TaskCardRenderer';
import type { IndexReads } from '../../services/core/TaskIndex';
import type { Operations } from '../../services/operations/Operations';
import { toDisplayTask } from '../../services/display/DisplayTaskConverter';
import { OverlayShell } from '../../views/sharedUI/OverlayShell';
import { TaskHubForm, type TaskHubFocusField } from './TaskHubForm';
import { TaskHubSource } from './TaskHubSource';
import { TaskHubSourceView } from './TaskHubSourceView';
import { RowHost } from './RowHost';
import type { PanelHost } from './HubHost';
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

/** Where the panel lets a source mode be built, and what it may ask of the panel. */
export interface SourceSlots {
    /** Where its switch goes, above the card. */
    bar: HTMLElement;
    /** The card's element, hidden while the source is open. */
    card: HTMLElement;
    /** Where the source goes, in the card's place. */
    pane: HTMLElement;
    /** Close the hub, asking nothing more. */
    close(): void;
}

/** What the panel asks of its source mode (`TaskHubSource`) as the hub closes. */
export type HubSource = Pick<TaskHubSource, 'beforeClose' | 'yieldsEscape' | 'takesBack' | 'dispose'>;

/** Builds the source mode in the panel's slots, once, as the hub is built. */
export type SourceMaker = (slots: SourceSlots) => HubSource;

/**
 * タスクハブパネル — 「タスクを開く」の単一の目的地。
 *
 * 上部にカードプレビュー（ホストが描き直させる）、下部にプロパティ編集
 * フォーム（値の読み書きはホスト `PanelHost`）。read-only タスクは
 * プレビューのみに縮退。ソースモードを作る関数を入口が渡したときだけ、
 * プレビューの上の切り替えで、カードの代わりに行と部分木のソースを編集
 * できる（TaskHubSource）。渡さなければ切り替えの bar も作らない。
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
 * このクラスは domain logic（singleton・preview・form・source）のみ。
 */
export class TaskHubPanel {
    private static active: TaskHubPanel | null = null;
    /** The hub asked for last; one asked for while another waits for a hub to close goes before it. */
    private static wanted: TaskHubPanel | null = null;

    private overlay = new OverlayShell();
    private previewEl: HTMLElement | null = null;
    private form: TaskHubForm | null = null;
    private source: HubSource | null = null;

    /**
     * Open the hub on a row the note already has (a segment of a split task
     * opens its row's): its host writes each change to the row at once and
     * follows the row in the index (`RowHost`), and the source mode edits
     * the row and its subtree, following the row as the host does.
     */
    static openRowHub(app: App, task: Task, deps: TaskHubDeps, options: TaskHubPanelOptions = {}): Promise<void> {
        let source: TaskHubSource | null = null;
        const host = new RowHost(
            task,
            { app, plugin: deps.plugin, index: deps.index, operations: deps.operations },
            (row) => source?.follow(row),
        );
        const makeSource: SourceMaker = ({ bar, card, pane, close }) => {
            const view = new TaskHubSourceView(app, bar, card, pane, {
                enter: () => { void source?.enter(); },
                apply: () => { void source?.apply(); },
                cancel: () => source?.cancel(),
                discard: () => source?.discard(),
                keep: () => source?.keep(),
                draftText: () => source?.draftText() ?? null,
            });
            source = new TaskHubSource(host.task(), {
                drained: () => host.drained(),
                confirm: (id) => deps.operations.confirmTask(id),
                reread: (id) => deps.index.getTask(id),
                // The refusal is shown under the draft it leaves; a notice would say it twice.
                replace: (id, base, replacement) => deps.operations.replaceSubtree(id, base, replacement, { tellRefusal: false }),
                indentUnit: () => indentUnit(app),
                lockForm: (locked) => host.setSourceOpen(locked),
                closeHub: close,
            }, view);
            return source;
        };
        return new TaskHubPanel(app, host, deps, options, makeSource).open();
    }

    /** @param makeSource builds the source mode; null, the hub has none, nor its switch */
    constructor(
        private app: App,
        private readonly host: PanelHost,
        private deps: TaskHubDeps,
        private options: TaskHubPanelOptions,
        private readonly makeSource: SourceMaker | null,
    ) { }

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
            keymap: this.app.keymap,
            initialFocus: () => (focusField ? this.form?.fieldElement(focusField) ?? null : null),
            build: (bodyEl) => this.buildContent(bodyEl),
            onClose: () => this.teardown(),
            // The source's draft first: while the source is open the form is shut.
            beforeClose: () => ((this.source?.beforeClose() ?? true) ? this.form?.beforeClose() ?? 'close' : 'stay'),
            yieldsEscape: () => this.source?.yieldsEscape() ?? false,
            takesBack: () => this.source?.takesBack() ?? false,
        });

        this.host.attach({
            redrawPreview: () => this.renderPreview(),
            close: () => this.close(),
        });
    }

    private buildContent(bodyEl: HTMLElement): void {
        const bar = this.makeSource ? bodyEl.createDiv() : null;
        const card = bodyEl.createDiv({ cls: 'task-hub__preview' });
        this.previewEl = card;
        const pane = this.makeSource ? bodyEl.createDiv() : null;
        const formHost = bodyEl.createDiv({ cls: 'task-hub__form' });

        this.renderPreview();

        if (this.host.task().isReadOnly) {
            formHost.createDiv({
                cls: 'task-hub__read-only-notice',
                text: t('modal.hub.readOnlyNotice'),
            });
        } else {
            this.form = new TaskHubForm(formHost, this.host, {
                app: this.app,
                plugin: this.deps.plugin,
                index: this.deps.index,
                requestClose: () => { void this.overlay.requestClose(); },
            });
        }

        if (this.makeSource && bar && pane) {
            this.source = this.makeSource({ bar, card, pane, close: () => this.close() });
        }
    }

    private renderPreview(): void {
        if (!this.previewEl) return;
        const settings = this.deps.plugin.settings;

        this.deps.taskRenderer.disposeInside(this.previewEl);
        this.previewEl.empty();

        const card = this.previewEl.createDiv('task-card task-card--in-hub-preview');
        const closePanel = () => this.close();

        const dt = toDisplayTask(this.host.task(), settings.startHour, (id) => this.deps.index.getTask(id));
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

        this.host.dispose();
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
