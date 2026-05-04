import { Task } from '../../types';
import type TaskViewerPlugin from '../../main';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { TaskWriteService } from '../../services/data/TaskWriteService';
import type { SelectionController } from '../selection/SelectionController';

export interface DragContext {
    container: HTMLElement;
    plugin: TaskViewerPlugin;
    readService: TaskReadService;
    writeService: TaskWriteService;
    selectionController: SelectionController;
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
}
