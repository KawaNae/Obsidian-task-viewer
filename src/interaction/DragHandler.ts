import { TaskIndex } from '../services/TaskIndex';
import { Task } from '../types';
import TaskViewerPlugin from '../main';
import { DragStrategy, DragContext } from './DragStrategy';
import { TimelineDragStrategy } from './strategies/TimelineDragStrategy';
import { AllDayDragStrategy } from './strategies/AllDayDragStrategy';


export class DragHandler implements DragContext {
    container: HTMLElement;
    taskIndex: TaskIndex;
    plugin: TaskViewerPlugin;
    onTaskMove: () => void;
    public onTaskClick: (taskId: string) => void;

    private currentStrategy: DragStrategy | null = null;
    private currentDoc: Document;
    private getViewStartDateProvider: () => string;

    private boundPointerDown: (e: PointerEvent) => void;
    private boundPointerMove: (e: PointerEvent) => void;
    private boundPointerUp: (e: PointerEvent) => void;

    constructor(container: HTMLElement, taskIndex: TaskIndex, plugin: TaskViewerPlugin, onTaskClick: (taskId: string) => void, onTaskMove: () => void, getViewStartDate: () => string) {
        this.container = container;
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.onTaskClick = onTaskClick;
        this.onTaskMove = onTaskMove;
        this.getViewStartDateProvider = getViewStartDate;

        this.boundPointerDown = this.onPointerDown.bind(this);
        this.boundPointerMove = this.onPointerMove.bind(this);
        this.boundPointerUp = this.onPointerUp.bind(this);

        this.container.addEventListener('pointerdown', this.boundPointerDown);

        this.currentDoc = this.container.ownerDocument || document;
        this.currentDoc.addEventListener('pointermove', this.boundPointerMove);
        this.currentDoc.addEventListener('pointerup', this.boundPointerUp);
    }

    destroy() {
        this.container.removeEventListener('pointerdown', this.boundPointerDown);
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
            isFromHandle = true;
            taskId = handle.dataset.taskId || null;
            if (taskId) {
                if (taskId) {
                    // Simplest way to get the card: look up from the handle
                    taskEl = handle.closest('.task-card') as HTMLElement;

                    // If for some reason that fails (shouldn't), fallback
                    if (!taskEl) {
                        taskEl = this.container.querySelector(`.task-card[data-id="${taskId}"]`) as HTMLElement;
                    }

                    // If it's a split card, ensure we have the original ID (though handle should have it)
                    if (taskEl && taskEl.dataset.splitOriginalId) {
                        taskId = taskEl.dataset.splitOriginalId;
                    }
                }
            }
        } else {
            taskEl = target.closest('.task-card') as HTMLElement;
            if (taskEl) {
                // Prioritize splitOriginalId if available
                taskId = taskEl.dataset.splitOriginalId || taskEl.dataset.id || null;
                if (taskEl.dataset.splitOriginalId) {
                    console.log(`[DragHandler] Resolved split task ${taskEl.dataset.id} -> ${taskId}`);
                }
            }
        }

        if (!taskEl || !taskId) return;

        const task = this.taskIndex.getTask(taskId);
        if (!task) return;

        // Select Strategy
        // Determine if this is an AllDay task (either no startTime, or 24h+ duration with startTime)
        const isAllDayTask = this.isAllDayTask(task);

        if (isAllDayTask) {
            // AllDay/LongTerm tasks require handle to drag
            if (!isFromHandle) {
                // Not from handle: just select the task, don't start drag
                this.onTaskClick(taskId);
                return;
            }
            this.currentStrategy = new AllDayDragStrategy();
        } else {
            // Timeline tasks require handle to drag
            if (!isFromHandle) {
                // Not from handle: just select the task, don't start drag
                this.onTaskClick(taskId);
                return;
            }
            this.currentStrategy = new TimelineDragStrategy();
        }

        if (this.currentStrategy) {
            // ドラッグ開始：このファイルのスキャンを抑制
            this.taskIndex.setDraggingFile(task.file);
            this.currentStrategy.onDown(e, task, taskEl, this);
        }
    }

    private onPointerMove(e: PointerEvent) {
        if (this.currentStrategy) {
            this.currentStrategy.onMove(e, this);
            this.onTaskMove(); // Update handle positions during drag
        }
    }

    private async onPointerUp(e: PointerEvent) {
        if (this.currentStrategy) {
            await this.currentStrategy.onUp(e, this);
            // ドラッグ終了：フラグ解除＆最終レンダリングをトリガー
            this.taskIndex.setDraggingFile(null);
        }
        this.currentStrategy = null;
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

