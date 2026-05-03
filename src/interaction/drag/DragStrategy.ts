import { Task } from '../../types';
import type TaskViewerPlugin from '../../main';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { TaskWriteService } from '../../services/data/TaskWriteService';

export interface DragContext {
    container: HTMLElement;
    plugin: TaskViewerPlugin;
    readService: TaskReadService;
    writeService: TaskWriteService;
    onTaskMove: () => void;
    onTaskClick: (taskId: string) => void;
    // Helper to get visual date from column element
    getDateFromCol: (el: HTMLElement) => string | null;
    // Helper to get the view start date
    getViewStartDate: () => string;
    // Helper to get the view end date (inclusive). For range-clip / split-preview.
    getViewEndDate: () => string;
    // Helper to get per-view zoom level
    getZoomLevel: () => number;
}

export interface DragStrategy {
    name: string;

    // Called when pointer down is detected on a valid target for this strategy
    onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext): void;

    // Called on every pointer move
    onMove(e: PointerEvent, context: DragContext): void;

    // Called on pointer up
    onUp(e: PointerEvent, context: DragContext): Promise<void>;

    /**
     * Synchronously install the kill-listener for the synthetic click that
     * the browser dispatches right after pointerup. Must be invoked before
     * `onUp()` is awaited — otherwise the synthetic click slips through
     * during the await yield and the listener ends up consuming the next
     * real click instead.
     */
    armSyntheticClickKill(): void;
}
