import { App, Platform, setIcon } from 'obsidian';
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
    private task: Task;
    private rootEl: HTMLElement | null = null;
    private previewEl: HTMLElement | null = null;
    private form: TaskHubForm | null = null;
    private unsubscribe: (() => void) | null = null;
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

        this.stack.closeAll();
        this.unsubscribe?.();
        this.unsubscribe = null;

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
