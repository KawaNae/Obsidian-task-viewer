import { TaskReadService } from '../../services/data/TaskReadService';
import { TaskWriteService } from '../../services/data/TaskWriteService';

import TaskViewerPlugin from '../../main';
import { DragStrategy, DragContext } from './DragStrategy';
import { MoveStrategy } from './strategies/MoveStrategy';
import { ResizeStrategy } from './strategies/ResizeStrategy';


export class DragHandler implements DragContext {
    container: HTMLElement;
    readService: TaskReadService;
    writeService: TaskWriteService;
    plugin: TaskViewerPlugin;
    onTaskMove: () => void;
    public onTaskClick: (taskId: string) => void;
    public onDetailClick: ((taskId: string) => void) | null = null;

    private currentStrategy: DragStrategy | null = null;
    private currentDragTaskId: string | null = null;
    private currentDoc: Document;
    private getViewStartDateProvider: () => string;
    private getViewEndDateProvider: () => string;
    private getZoomLevelProvider: () => number;

    private boundPointerDown: (e: PointerEvent) => void;
    private boundPointerMove: (e: PointerEvent) => void;
    private boundPointerUp: (e: PointerEvent) => void;
    private boundTouchStart: (e: TouchEvent) => void;
    private boundTouchMove: (e: TouchEvent) => void;

    constructor(container: HTMLElement, readService: TaskReadService, writeService: TaskWriteService, plugin: TaskViewerPlugin, onTaskClick: (taskId: string) => void, onTaskMove: () => void, getViewStartDate: () => string, getViewEndDate: () => string, getZoomLevel: () => number) {
        this.container = container;
        this.readService = readService;
        this.writeService = writeService;
        this.plugin = plugin;
        this.onTaskClick = onTaskClick;
        this.onTaskMove = onTaskMove;
        this.getViewStartDateProvider = getViewStartDate;
        this.getViewEndDateProvider = getViewEndDate;
        this.getZoomLevelProvider = getZoomLevel;

        this.boundPointerDown = this.onPointerDown.bind(this);
        this.boundPointerMove = this.onPointerMove.bind(this);
        this.boundPointerUp = this.onPointerUp.bind(this);

        this.boundTouchStart = this.onTouchStart.bind(this);
        this.boundTouchMove = this.onTouchMove.bind(this);

        this.container.addEventListener('pointerdown', this.boundPointerDown);
        this.container.addEventListener('touchstart', this.boundTouchStart, { capture: true, passive: false });
        this.container.addEventListener('touchmove', this.boundTouchMove, { passive: false });

        this.currentDoc = this.container.ownerDocument || document;
        this.currentDoc.addEventListener('pointermove', this.boundPointerMove);
        this.currentDoc.addEventListener('pointerup', this.boundPointerUp);
    }

    destroy() {
        this.container.removeEventListener('pointerdown', this.boundPointerDown);
        this.container.removeEventListener('touchstart', this.boundTouchStart, { capture: true });
        this.container.removeEventListener('touchmove', this.boundTouchMove);
        if (this.currentDoc) {
            this.currentDoc.removeEventListener('pointermove', this.boundPointerMove);
            this.currentDoc.removeEventListener('pointerup', this.boundPointerUp);
        }
    }

    // --- Context Implementation ---
    getDateFromCol(el: HTMLElement): string | null {
        return el.dataset.date || null;
    }

    getViewStartDate(): string {
        return this.getViewStartDateProvider();
    }

    getViewEndDate(): string {
        return this.getViewEndDateProvider();
    }

    getZoomLevel(): number {
        return this.getZoomLevelProvider();
    }

    private onPointerDown(e: PointerEvent) {
        // Update document context if needed
        const newDoc = this.container.ownerDocument || document;
        if (newDoc !== this.currentDoc) {
            this.currentDoc.removeEventListener('pointermove', this.boundPointerMove);
            this.currentDoc.removeEventListener('pointerup', this.boundPointerUp);
            this.currentDoc = newDoc;
            this.currentDoc.addEventListener('pointermove', this.boundPointerMove);
            this.currentDoc.addEventListener('pointerup', this.boundPointerUp);
        }

        const target = e.target as HTMLElement;

        // pinnedLists 内のカードクリックは selection/drag の対象外。
        // pinnedLists は selection 状態を持たない閲覧専用 UI であり、
        // ここで早期 return しないと main grid の同 id カードに .is-selected が漏れる。
        if (target.closest('.tv-sidebar__pinned-lists')) {
            return;
        }

        const handle = target.closest('.task-card__handle-btn') as HTMLElement;
        let taskEl: HTMLElement | null = null;
        let taskId: string | null = null;
        let isFromHandle = false;

        if (handle) {
            isFromHandle = true;
            taskId = handle.dataset.taskId || null;
            if (taskId) {
                taskEl = handle.closest('.task-card') as HTMLElement;
                if (!taskEl) {
                    taskEl = this.container.querySelector(`.task-card[data-id="${taskId}"]`) as HTMLElement;
                }
                if (taskEl && taskEl.dataset.splitOriginalId) {
                    taskId = taskEl.dataset.splitOriginalId;
                }
            }

            // detail-handle: open detail modal, no drag.
            if (taskId && target.closest('.task-card__handle--detail')) {
                e.preventDefault();
                e.stopPropagation();
                this.onDetailClick?.(taskId);
                return;
            }
        } else {
            taskEl = target.closest('.task-card') as HTMLElement;
            if (taskEl) {
                taskId = taskEl.dataset.splitOriginalId || taskEl.dataset.id || null;
            }
        }

        if (!taskEl || !taskId) return;

        const task = this.readService.getTask(taskId);
        if (!task) return;
        if (task.isReadOnly && isFromHandle) return;

        // Select Strategy based on handle type (move or resize)
        const isResizeHandle = target.closest('.task-card__handle--resize-top') ||
            target.closest('.task-card__handle--resize-bottom') ||
            target.closest('.task-card__handle--resize-left') ||
            target.closest('.task-card__handle--resize-right');

        // Non-handle click: select the card. Detail modal is opened via
        // double-click (TaskCardRenderer) or detail-handle, never single click.
        if (!isFromHandle) {
            this.onTaskClick(taskId);
            return;
        }

        this.currentStrategy = isResizeHandle
            ? new ResizeStrategy()
            : new MoveStrategy();
        this.currentDragTaskId = task.id;

        this.writeService.setDraggingFile(task.file);
        this.currentStrategy.onDown(e, task, taskEl, this);
        e.preventDefault();
        this.container.style.touchAction = 'none';
    }

    private onPointerMove(e: PointerEvent) {
        if (this.currentStrategy) {
            e.preventDefault();
            this.currentStrategy.onMove(e, this);
            this.onTaskMove(); // Update handle positions during drag
        }
    }

    private async onPointerUp(e: PointerEvent) {
        if (this.currentStrategy) {
            e.preventDefault();
            const taskId = this.currentDragTaskId;

            // The browser dispatches a synthetic click right after pointerup,
            // BEFORE the first await below yields control back. Arm the
            // kill-listener synchronously so it's in place when that synthetic
            // click fires; otherwise it slips through and the listener instead
            // consumes the user's next real click.
            this.currentStrategy.armSyntheticClickKill();

            await this.currentStrategy.onUp(e, this);

            // ドラッグで触り得るのは start/end の date/time のみ。
            // 変更スパンを明示することで onChange の coalesce / partial-update に乗せる。
            // 即座にDOMを再構築。cleanup()と同一JSフレーム内で実行されるため
            // ブラウザがペイントする前に旧カードが新カードで置き換わる。
            this.writeService.notifyImmediate(
                taskId ?? undefined,
                taskId ? ['startDate', 'startTime', 'endDate', 'endTime'] : undefined,
            );

            // draggingFilePath は遅延イベント (metadataCache.changed) のフィルタに使うため
            // 1 frame 後に解除。setDraggingFile(null) は通知を発火しない仕様。
            requestAnimationFrame(() => {
                this.writeService.setDraggingFile(null);
            });
        }
        this.currentStrategy = null;
        this.currentDragTaskId = null;
        this.container.style.touchAction = ''; // Restore normal touch behavior
    }

    /**
     * Capture-phase touchstart handler.
     * On a drag handle: stops propagation (blocks Obsidian's gesture recognizers)
     * and cancels the native scroll-gesture decision before WebKit/Blink lock it in.
     */
    private onTouchStart(e: TouchEvent) {
        const target = e.target as HTMLElement;
        if (target.closest('.task-card__handle-btn')) {
            e.stopPropagation();
            // WebKit/Blink finalize the scroll-gesture decision at touchstart; dynamic touchAction='none' in onPointerDown arrives too late.
            if (e.cancelable) e.preventDefault();
        }
    }

    private onTouchMove(e: TouchEvent) {
        if (this.currentStrategy) {
            e.preventDefault(); // Block browser gesture recognition at touch event level
        }
    }
}

