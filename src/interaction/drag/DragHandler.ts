import { TaskIndex } from '../../services/core/TaskIndex';
import { Task } from '../../types';
import TaskViewerPlugin from '../../main';
import { DragStrategy, DragContext } from './DragStrategy';
import { MoveStrategy } from './strategies/MoveStrategy';
import { ResizeStrategy } from './strategies/ResizeStrategy';


export class DragHandler implements DragContext {
    container: HTMLElement;
    taskIndex: TaskIndex;
    plugin: TaskViewerPlugin;
    onTaskMove: () => void;
    public onTaskClick: (taskId: string) => void;

    private currentStrategy: DragStrategy | null = null;
    private currentDoc: Document;
    private getViewStartDateProvider: () => string;
    private getZoomLevelProvider: () => number;

    private boundPointerDown: (e: PointerEvent) => void;
    private boundPointerMove: (e: PointerEvent) => void;
    private boundPointerUp: (e: PointerEvent) => void;
    private boundTouchStart: (e: TouchEvent) => void;
    private boundTouchMove: (e: TouchEvent) => void;

    constructor(container: HTMLElement, taskIndex: TaskIndex, plugin: TaskViewerPlugin, onTaskClick: (taskId: string) => void, onTaskMove: () => void, getViewStartDate: () => string, getZoomLevel: () => number) {
        this.container = container;
        this.taskIndex = taskIndex;
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
                // Prioritize splitOriginalId if available
                taskId = taskEl.dataset.splitOriginalId || taskEl.dataset.id || null;
            }
        }

        if (!taskEl || !taskId) return;

        const task = this.taskIndex.getTask(taskId);
        if (!task) return;

        // Select Strategy based on handle type (move or resize)
        const isResizeHandle = target.closest('.task-card__handle--resize-top') ||
            target.closest('.task-card__handle--resize-bottom') ||
            target.closest('.task-card__handle--resize-left') ||
            target.closest('.task-card__handle--resize-right');

        // AllDay/Timeline両方でハンドルからのドラッグが必要
        if (!isFromHandle) {
            this.onTaskClick(taskId);
            return;
        }

        this.currentStrategy = isResizeHandle
            ? new ResizeStrategy()
            : new MoveStrategy();

        this.taskIndex.setDraggingFile(task.file);
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
            await this.currentStrategy.onUp(e, this);

            // 即座にDOMを再構築。cleanup()と同一JSフレーム内で実行されるため
            // ブラウザがペイントする前に旧カードが新カードで置き換わる。
            this.taskIndex.notifyImmediate();

            // draggingFilePathは遅延イベント(metadataCache.changed)を
            // ブロックするためRAF内でクリア
            requestAnimationFrame(() => {
                this.taskIndex.setDraggingFile(null);
            });
        }
        this.currentStrategy = null;
        this.container.style.touchAction = ''; // Restore normal touch behavior
    }

    /**
     * Capture-phase touchstart handler.
     * Stops propagation when touching a drag handle to prevent
     * Obsidian's gesture recognizers from receiving the event.
     */
    private onTouchStart(e: TouchEvent) {
        const target = e.target as HTMLElement;
        if (target.closest('.task-card__handle-btn')) {
            e.stopPropagation();
        }
    }

    private onTouchMove(e: TouchEvent) {
        if (this.currentStrategy) {
            e.preventDefault(); // Block browser gesture recognition at touch event level
        }
    }

    /**
     * Determine if a task should be treated as an AllDay task.
     * AllDay tasks are:
     * - Tasks without startTime (S-All, SD, ED, E, D types)
     * - Tasks with startTime but duration >= 24 hours
     */
    private isAllDayTask(task: Task): boolean {
        if (!task.startTime) return true;

        // Check if duration >= 24 hours
        const startHour = this.plugin.settings.startHour;
        const viewStartDate = this.getViewStartDate();
        const startDate = task.startDate || viewStartDate;

        const durationMs = this.getTaskDurationMs(
            startDate,
            task.startTime,
            task.endDate,
            task.endTime,
            startHour
        );

        const hours24 = 24 * 60 * 60 * 1000;
        return durationMs >= hours24;
    }

    /**
     * Calculate task duration in milliseconds.
     * Matches the logic in DateUtils.getTaskDurationMs
     */
    private getTaskDurationMs(
        startDate: string,
        startTime: string | undefined,
        endDate: string | undefined,
        endTime: string | undefined,
        startHour: number
    ): number {
        const effectiveStartDate = startDate;
        const effectiveStartTime = startTime || `${startHour.toString().padStart(2, '0')}:00`;

        let effectiveEndDate = endDate || effectiveStartDate;
        let effectiveEndTime = endTime || `${startHour.toString().padStart(2, '0')}:00`;

        // If no endTime but has endDate, use next day's startHour
        if (!endTime && endDate) {
            effectiveEndTime = `${startHour.toString().padStart(2, '0')}:00`;
            // Add one day to endDate to represent "end of that day"
            const d = new Date(effectiveEndDate);
            d.setDate(d.getDate() + 1);
            effectiveEndDate = d.toISOString().split('T')[0];
        }

        const start = new Date(`${effectiveStartDate}T${effectiveStartTime}`);
        const end = new Date(`${effectiveEndDate}T${effectiveEndTime}`);

        return end.getTime() - start.getTime();
    }
}

