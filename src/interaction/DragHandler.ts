import { TaskIndex } from '../services/TaskIndex';
import { Task } from '../types';
import TaskViewerPlugin from '../main';
import { DragStrategy, DragContext } from './DragStrategy';
import { TimelineDragStrategy } from './strategies/TimelineDragStrategy';
import { LongTermDragStrategy } from './strategies/LongTermDragStrategy';
import { UnassignedDragStrategy } from './strategies/UnassignedDragStrategy';

export class DragHandler implements DragContext {
    container: HTMLElement;
    taskIndex: TaskIndex;
    plugin: TaskViewerPlugin;
    onTaskMove: () => void;
    public onTaskClick: (taskId: string) => void;

    private currentStrategy: DragStrategy | null = null;
    private currentDoc: Document;

    private boundPointerDown: (e: PointerEvent) => void;
    private boundPointerMove: (e: PointerEvent) => void;
    private boundPointerUp: (e: PointerEvent) => void;

    constructor(container: HTMLElement, taskIndex: TaskIndex, plugin: TaskViewerPlugin, onTaskClick: (taskId: string) => void, onTaskMove: () => void) {
        this.container = container;
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.onTaskClick = onTaskClick;
        this.onTaskMove = onTaskMove;

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
        const handle = target.closest('.handle-btn') as HTMLElement;
        let taskEl: HTMLElement | null = null;
        let taskId: string | null = null;

        if (handle) {
            taskId = handle.dataset.taskId || null;
            if (taskId) {
                taskEl = this.container.querySelector(`.task-card[data-id="${taskId}"]`) as HTMLElement;
            }
        } else {
            taskEl = target.closest('.task-card') as HTMLElement;
            if (taskEl) taskId = taskEl.dataset.id || null;
        }

        if (!taskEl || !taskId) return;

        const task = this.taskIndex.getTask(taskId);
        if (!task) return;

        // Select Strategy
        if (task.isFuture) {
            this.currentStrategy = new UnassignedDragStrategy();
        } else if (!task.startTime) {
            this.currentStrategy = new LongTermDragStrategy();
        } else {
            this.currentStrategy = new TimelineDragStrategy();
        }

        if (this.currentStrategy) {
            this.currentStrategy.onDown(e, task, taskEl, this);
            // We do NOT prevent default here generally, unless strategy wants to?
            // Usually we prevent default in onMove to stop scrolling.
            // But we might want to stop text selection?
            // e.preventDefault(); // Let strategy decide?
            // Existing logic prevented default on handle click?
        }
    }

    private onPointerMove(e: PointerEvent) {
        if (this.currentStrategy) {
            console.log(`[DragHandler] onPointerMove - strategy: ${this.currentStrategy.name}`);
            this.currentStrategy.onMove(e, this);
            this.onTaskMove(); // Update handle positions during drag
        }
    }

    private async onPointerUp(e: PointerEvent) {
        if (this.currentStrategy) {
            await this.currentStrategy.onUp(e, this);
        }
        this.currentStrategy = null;
    }
}

