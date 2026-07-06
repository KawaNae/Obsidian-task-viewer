import { App, Platform, setIcon, TFile, type EventRef } from 'obsidian';
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
import { TaskHubForm, type TaskHubFocusField } from './TaskHubForm';

export interface TaskHubDeps {
    taskRenderer: TaskCardRenderer;
    menuHandler: MenuHandler;
    readService: TaskReadService;
    writeService: TaskWriteService;
    plugin: TaskViewerPlugin;
}

export interface TaskHubPanelOptions {
    /** 開いた直後にフォーカスするフォームフィールド */
    focusField?: TaskHubFocusField;
}

/**
 * タスクハブパネル — 「タスクを開く」の単一の目的地。
 * 上部にカードプレビュー（readService.onChange でライブ再描画）、下部に
 * プロパティ編集フォーム（フィールド確定で即保存）を持つ。read-only
 * タスク（外部プラグイン記法）はプレビューのみに縮退する。
 *
 * Obsidian Modal を継承しない自前実装（filter-popover と同じ系統）。
 * これにより:
 * - `.tv-ctrl` 詳細度パターンで filter-popover と UI 部品（pill / suggest /
 *   input）を共有できる
 * - Modal の auto-focus 奪取（tabindex + rAF ハック）と close アニメーション
 *   崩れ（mod-tv-modal ハック）が構造ごと消える
 * - フォーム内の suggest（SuggestController）用の PopoverStack を
 *   パネルが所有し、close 時に一括破棄する
 */
export class TaskHubPanel {
    /**
     * 開いているパネル（高々 1 つ、popout 含め全ウィンドウで単一）。
     * 多重オープンは hostDoc への keydown capture リスナーと onChange 購読を
     * 重複させる（Escape 1 回で両方が反応し、片方がリークする）ため、
     * open() は既存パネルを置換する。ガードは call site でなくクラスが持つ。
     */
    private static active: TaskHubPanel | null = null;

    private task: Task;
    private rootEl: HTMLElement | null = null;
    private previewEl: HTMLElement | null = null;
    private form: TaskHubForm | null = null;
    private unsubscribe: (() => void) | null = null;
    private renameRef: EventRef | null = null;
    private hostDoc: Document | null = null;
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
    /** フォーム内 suggest（SuggestController）が子ポップオーバーを積む先 */
    readonly stack = new PopoverStack();

    constructor(
        private app: App,
        task: Task,
        private deps: TaskHubDeps,
        private options: TaskHubPanelOptions = {},
    ) {
        // split segment → original 解決（MenuHandler.showContextMenu と同規約）
        const originalId = getOriginalTaskId(task);
        this.task = deps.readService.getTask(originalId) ?? task;
    }

    open(): void {
        if (this.rootEl) return;
        TaskHubPanel.active?.close();
        TaskHubPanel.active = this;

        // Modal と同じく「操作が起きたウィンドウ」に出す（popout 対応）。
        const hostDoc: Document = (globalThis as { activeDocument?: Document }).activeDocument ?? document;
        this.hostDoc = hostDoc;

        const root = hostDoc.body.createDiv({ cls: 'task-hub tv-ctrl' });
        this.rootEl = root;

        const backdrop = root.createDiv({ cls: 'task-hub__backdrop' });
        backdrop.addEventListener('click', () => this.close());

        const panel = root.createDiv({ cls: 'task-hub__panel' });

        const closeBtn = panel.createEl('button', { cls: 'task-hub__close' });
        setIcon(closeBtn.createSpan(), 'x');
        closeBtn.setAttribute('aria-label', t('modal.cancel'));
        closeBtn.addEventListener('click', () => this.close());

        // モバイル: プレビュー折りたたみトグル（初期展開）。縦空間が限られる
        // phone でフォームの視認領域を確保する。
        if (Platform.isPhone) {
            const toggle = panel.createDiv({ cls: 'task-hub__preview-toggle' });
            setIcon(toggle.createSpan(), 'chevron-up');
            toggle.setAttribute('aria-label', t('modal.hub.togglePreview'));
            toggle.addEventListener('click', () => {
                const collapsed = !this.previewEl?.hasClass('is-collapsed');
                this.previewEl?.toggleClass('is-collapsed', collapsed);
                toggle.toggleClass('is-collapsed', collapsed);
            });
        }

        this.previewEl = panel.createDiv({ cls: 'task-hub__preview' });
        const formHost = panel.createDiv({ cls: 'task-hub__form' });

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

        // Escape: suggest が開いていればそれを閉じ、なければパネルを閉じる。
        // capture で受けて Obsidian 側へのフォールスルーを止める。
        this.keydownHandler = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            if (this.stack.isOpen()) {
                this.stack.closeAll();
            } else {
                this.close();
            }
        };
        hostDoc.addEventListener('keydown', this.keydownHandler, true);

        if (this.options.focusField && this.form) {
            const field = this.options.focusField;
            requestAnimationFrame(() => this.form?.focusField(field));
        }

        this.unsubscribe = this.deps.readService.onChange((taskId) => {
            // 他タスク単独の変更は無視する（プレビュー全再構築の抑制）。
            // 同一ファイルの rescan / rename は mergeNotify が taskId 未指定の
            // full 通知に降格させるため、cascade（file/section 継承）由来の
            // 変化はこのフィルタを必ず通過する。notify の粒度をタスク単位に
            // 細分化する場合は、同一ファイルの taskId も通す必要がある。
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

        // rename 追従: task id にはファイルパスが焼き込まれているため、
        // 追従しないと rename 後の lookup が永久に失敗し setMissing に
        // 固定される。TimerWidget.handleFileRename と同じ renameFile 方式。
        // ln: 等の anchor は rename で不変なので rescan 後の新 id と一致し、
        // TaskIndex の full 通知 → 上の onChange で復帰する。
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
            // hub 内メニューの Properties 項目はパネルを積まず自フォームへ focus
            onOpenPropertiesFocus: (field) => this.form?.focusField(field),
        });

        const dt = toDisplayTask(this.task, settings.startHour, (id) => this.deps.readService.getTask(id));
        await this.deps.taskRenderer.render(card, dt, settings, {
            cardInstanceId: `hub::${dt.id}`,
            context: 'detail-modal',
            hooks: { onNavigate: closePanel },
        });
    }

    close(): void {
        if (!this.rootEl) return;
        if (TaskHubPanel.active === this) TaskHubPanel.active = null;

        this.stack.closeAll();
        this.unsubscribe?.();
        this.unsubscribe = null;
        if (this.renameRef) {
            this.app.vault.offref(this.renameRef);
            this.renameRef = null;
        }

        if (this.keydownHandler && this.hostDoc) {
            this.hostDoc.removeEventListener('keydown', this.keydownHandler, true);
        }
        this.keydownHandler = null;
        this.hostDoc = null;

        if (this.previewEl) this.deps.taskRenderer.disposeInside(this.previewEl);
        this.previewEl = null;
        this.form = null;

        this.rootEl.remove();
        this.rootEl = null;
    }
}
