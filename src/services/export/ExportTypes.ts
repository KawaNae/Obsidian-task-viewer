import type { TaskIndex } from '../core/TaskIndex';

export interface ExportStrategy {
    /** Expand scroll areas to capture full content. */
    expandScrollAreas(container: HTMLElement, restoreFns: (() => void)[]): void;
    /** Simulate scroll position to capture the visible viewport. */
    simulateScrollPosition(container: HTMLElement, restoreFns: (() => void)[]): void;
}

export interface ViewExportOptions {
    container: HTMLElement;
    taskIndex: TaskIndex;
    filename: string;
    expandScrollAreas?: boolean;
}
