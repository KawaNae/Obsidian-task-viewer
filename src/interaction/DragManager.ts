import { TaskIndex } from '../services/TaskIndex';
import { Task } from '../types';
import TaskViewerPlugin from '../main';
import { AutoScroller } from './AutoScroller';
import { DragStrategy } from './strategies/DragStrategy';
import { TimelineDragStrategy } from './strategies/TimelineDragStrategy';
import { AllDayDragStrategy } from './strategies/AllDayDragStrategy';
import { UnassignedDragStrategy } from './strategies/UnassignedDragStrategy';

export class DragManager {
    private container: HTMLElement;
    private taskIndex: TaskIndex;
    private plugin: TaskViewerPlugin;
    private dragTask: Task | null = null;
    private dragEl: HTMLElement | null = null;

    private isDragging: boolean = false;
    private hasMoved: boolean = false;
    private onTaskClick: (taskId: string) => void;
    private onTaskMove: () => void;

    private isFinalizing: boolean = false;
    private autoScroller: AutoScroller;

    private strategies: {
        timeline: TimelineDragStrategy;
        allDay: AllDayDragStrategy;
        unassigned: UnassignedDragStrategy;
    };
    private currentStrategy: DragStrategy | null = null;

    // Cache initials
    private initialX: number = 0;
    private initialY: number = 0;

    constructor(
        container: HTMLElement,
        taskIndex: TaskIndex,
        plugin: TaskViewerPlugin,
        onTaskClick: (taskId: string) => void,
        onTaskMove: () => void
    ) {
        this.container = container;
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.onTaskClick = onTaskClick;
        this.onTaskMove = onTaskMove;

        this.autoScroller = new AutoScroller(container, (delta) => this.onAutoScroll(delta));

        this.strategies = {
            timeline: new TimelineDragStrategy(plugin.settings),
            allDay: new AllDayDragStrategy(plugin.settings),
            unassigned: new UnassignedDragStrategy(plugin.settings)
        };

        this.container.addEventListener('pointerdown', this.boundPointerDown);
    }

    private boundPointerDown = (e: PointerEvent) => this.onPointerDown(e);
    private boundPointerMove = (e: PointerEvent) => this.onPointerMove(e);
    private boundPointerUp = (e: PointerEvent) => this.onPointerUp(e);

    public destroy() {
        this.autoScroller.stop();
        this.container.removeEventListener('pointerdown', this.boundPointerDown);
        document.removeEventListener('pointermove', this.boundPointerMove);
        document.removeEventListener('pointerup', this.boundPointerUp);
    }

    public onPointerDown(e: PointerEvent) {
        const target = e.target as HTMLElement;
        let taskEl = target.closest('.task-card') as HTMLElement;
        let taskId: string | undefined;

        // Check if clicking a handle
        const handleEl = target.closest('.handle-btn') as HTMLElement;
        if (handleEl) {
            taskId = handleEl.dataset.taskId;
            if (taskId) {
                taskEl = this.container.querySelector(`.task-card[data-id="${taskId}"]`) as HTMLElement;
            }
        } else if (taskEl) {
            taskId = taskEl.dataset.id;
        }

        if (taskEl && taskId) {
            e.preventDefault();
            e.stopPropagation();

            const task = this.taskIndex.getTask(taskId);
            if (task) {
                this.prepareDrag(task, taskEl, e);
            }
        }
    }

    private prepareDrag(task: Task, el: HTMLElement, e: PointerEvent) {
        this.dragTask = task;
        this.dragEl = el;
        this.initialY = e.clientY;
        this.initialX = e.clientX;
        this.isDragging = false;
        this.hasMoved = false;

        // Mode Detection for Strategy
        const target = e.target as HTMLElement;
        const handleEl = target.closest('.handle-btn') || target; // Robust check

        let mode: 'move' | 'resize-top' | 'resize-bottom' | 'resize-left' | 'resize-right' = 'move';
        if (handleEl.classList.contains('top-resize-handle')) mode = 'resize-top';
        else if (handleEl.classList.contains('bottom-resize-handle')) mode = 'resize-bottom';
        else if (handleEl.classList.contains('left-resize-handle')) mode = 'resize-left';
        else if (handleEl.classList.contains('right-resize-handle')) mode = 'resize-right';

        // Select Strategy
        // If starting from Unassigned -> UnassignedStrategy
        // If starting from All-Day or Long-Term -> AllDayStrategy
        // If starting from Timeline -> TimelineStrategy (UNLESS converting? No, start determines strategy for now)

        if (el.closest('.unassigned-section')) {
            this.currentStrategy = this.strategies.unassigned;
        } else if (el.closest('.all-day-row') || el.closest('.long-term-row')) {
            this.currentStrategy = this.strategies.allDay;
            // Pass resize mode if applicable
            if (mode !== 'move' && mode !== 'resize-top' && mode !== 'resize-bottom') {
                // AllDay supports left/right
                (this.currentStrategy as AllDayDragStrategy).setMode(mode as any);
            } else {
                (this.currentStrategy as AllDayDragStrategy).setMode('move');
            }
        } else {
            this.currentStrategy = this.strategies.timeline;
            if (['move', 'resize-top', 'resize-bottom'].includes(mode)) {
                (this.currentStrategy as TimelineDragStrategy).setMode(mode as any);
            } else {
                (this.currentStrategy as TimelineDragStrategy).setMode('move');
            }
        }

        try {
            el.setPointerCapture(e.pointerId);
        } catch (err) {
            console.warn('Failed to capture pointer', err);
        }

        this.dragEl.addClass('is-dragging');

        // Strategy Start
        this.currentStrategy.onDragStart(task, el, this.initialX, this.initialY, this.container);

        document.addEventListener('pointermove', this.boundPointerMove);
        document.addEventListener('pointerup', this.boundPointerUp);
    }

    private lastPointerEvent: PointerEvent | null = null;

    private onPointerMove(e: PointerEvent) {
        if (!this.dragTask || !this.dragEl || !this.currentStrategy) return;

        this.lastPointerEvent = e;

        if (!this.isDragging) {
            const moveThreshold = 5;
            if (Math.abs(e.clientY - this.initialY) > moveThreshold || Math.abs(e.clientX - this.initialX) > moveThreshold) {
                this.isDragging = true;
                this.hasMoved = true;
            } else {
                return;
            }
        }

        this.executeMove(e);
    }

    private executeMove(e: { clientX: number, clientY: number }) {
        if (!this.currentStrategy) return;

        const elBelow = document.elementFromPoint(e.clientX, e.clientY);

        if (e instanceof PointerEvent) {
            this.autoScroller.handleAutoScroll(e.clientY);
        }

        this.currentStrategy.onDragMove(e as PointerEvent, this.container, elBelow);

        this.onTaskMove();
    }

    private onAutoScroll(delta: number) {
        if (this.lastPointerEvent && this.isDragging) {
            this.executeMove(this.lastPointerEvent);
        }
    }

    private onPointerUp(e: PointerEvent) {
        this.autoScroller.stop();
        if (this.dragEl) {
            try { this.dragEl.releasePointerCapture(e.pointerId); } catch (err) { }
        }

        if (!this.dragTask || !this.dragEl) return;

        if (!this.isDragging) {
            if (!this.hasMoved) {
                this.onTaskClick(this.dragTask.id);
            }
            this.cleanup();
        } else {
            this.finalizeDrag();
        }
    }

    private cleanup() {
        if ((this.isDragging || this.hasMoved) && this.dragEl && this.dragEl.parentElement) {
            this.dragEl.remove();
        }
        if (this.dragEl) this.dragEl.removeClass('is-dragging');

        if (this.currentStrategy) this.currentStrategy.cleanup();

        this.dragTask = null;
        this.dragEl = null;
        this.isDragging = false;
        this.hasMoved = false;
        this.isFinalizing = false;
        this.currentStrategy = null;
    }

    private async finalizeDrag() {
        if (this.isFinalizing) return;
        this.isFinalizing = true;

        console.log('[DragManager] finalising with strategy:', this.currentStrategy?.name);

        if (!this.dragTask || !this.dragEl || !this.currentStrategy) {
            this.cleanup();
            return;
        }

        const updates = await this.currentStrategy.onDragEnd(this.dragTask, this.dragEl);

        if (Object.keys(updates).length > 0) {
            await this.taskIndex.updateTask(this.dragTask.id, updates);
        }

        this.cleanup();
    }
}
