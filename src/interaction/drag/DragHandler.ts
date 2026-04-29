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

    private currentStrategy: DragStrategy | null = null;
    private currentDragTaskId: string | null = null;
    private currentDoc: Document;
    private getViewStartDateProvider: () => string;
    private getZoomLevelProvider: () => number;

    private boundPointerDown: (e: PointerEvent) => void;
    private boundPointerMove: (e: PointerEvent) => void;
    private boundPointerUp: (e: PointerEvent) => void;
    private boundTouchStart: (e: TouchEvent) => void;
    private boundTouchMove: (e: TouchEvent) => void;

    private lastClickTaskId: string | null = null;
    private lastClickTime: number = 0;

    constructor(container: HTMLElement, readService: TaskReadService, writeService: TaskWriteService, plugin: TaskViewerPlugin, onTaskClick: (taskId: string) => void, onTaskMove: () => void, getViewStartDate: () => string, getZoomLevel: () => number) {
        this.container = container;
        this.readService = readService;
        this.writeService = writeService;
        this.plugin = plugin;
        this.onTaskClick = onTaskClick;
        this.onTaskMove = onTaskMove;
        this.getViewStartDateProvider = getViewStartDate;
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
        // ここで早期 return しないと main grid の同 id カードに .selected が漏れる。
        if (target.closest('.pinned-lists-container')) {
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
        } else {
            taskEl = target.closest('.task-card') as HTMLElement;
            if (taskEl) {
                taskId = taskEl.dataset.splitOriginalId || taskEl.dataset.id || null;
            }
        }

        // 「クリック位置にないはずのカードが選択される」低頻度バグ調査用。
        // 通常クリック（ハンドルなし）で taskEl が解決されたとき、本当にその taskEl が
        // クリック位置にあるか検証する:
        //   1. e.target.closest('.task-card') = taskEl （DOM 親子関係）
        //   2. elementFromPoint(X, Y).closest('.task-card') = taskEl （ピクセル位置）
        //   3. clickInResolvedRect: クリック点が taskEl の bounding rect 内にあるか
        // どれかが false なら mismatch=true で warn を出す。バグ条件と完全一致。
        if (taskEl && !isFromHandle) {
            const elFromPoint = this.currentDoc.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            const cardAtPoint = elFromPoint?.closest('.task-card') as HTMLElement | null;
            const rect = taskEl.getBoundingClientRect();
            const clickInResolvedRect =
                e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom;
            const mismatch = !clickInResolvedRect || (cardAtPoint !== null && cardAtPoint !== taskEl);
            const payload = {
                t: Math.round(performance.now()),
                clickX: Math.round(e.clientX),
                clickY: Math.round(e.clientY),
                pointerType: e.pointerType,
                resolvedId: taskEl.dataset.id,
                resolvedSplitId: taskEl.dataset.splitOriginalId,
                resolvedRect: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
                clickInResolvedRect,
                cardAtPointId: cardAtPoint?.dataset.id,
                cardAtPointSplitId: cardAtPoint?.dataset.splitOriginalId,
                eTargetTag: target.tagName,
                eTargetCls: target.className,
            };
            if (mismatch) {
                console.warn('[task-select] click MISMATCH', JSON.stringify(payload));
            } else {
                console.log('[task-select] click', JSON.stringify(payload));
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

        // AllDay/Timeline両方でハンドルからのドラッグが必要
        if (!isFromHandle) {
            if (this.plugin.settings.taskSelectAction === 'dblclick') {
                const now = Date.now();
                if (this.lastClickTaskId === taskId && now - this.lastClickTime < 400) {
                    this.lastClickTaskId = null;
                    this.lastClickTime = 0;
                    this.onTaskClick(taskId);
                } else {
                    this.lastClickTaskId = taskId;
                    this.lastClickTime = now;
                }
            } else {
                this.onTaskClick(taskId);
            }
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

