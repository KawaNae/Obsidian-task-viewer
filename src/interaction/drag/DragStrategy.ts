import type { Task } from '../../types';
import type { PluginContext } from '../../PluginContext';
import type { IndexReads } from '../../services/core/TaskIndex';
import type { Operations } from '../../services/operations/Operations';
import type { SelectionController } from '../selection/SelectionController';

export interface DragContext {
    container: HTMLElement;
    plugin: PluginContext;
    /** The index's copies, and the drag's hold on its note (`PluginContext.getIndex`). */
    index: IndexReads;
    operations: Operations;
    selectionController: SelectionController;
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

    // Called when the gesture is aborted (pointercancel / lost capture):
    // release transient state without committing the edit.
    onCancel(): void;
}
