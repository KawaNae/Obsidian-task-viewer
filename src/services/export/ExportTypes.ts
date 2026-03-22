import type { App } from 'obsidian';
import type { TaskIndex } from '../core/TaskIndex';

export interface ExportStrategy {
    /** Expand scroll areas to capture full content. */
    expandScrollAreas(container: HTMLElement, restoreFns: (() => void)[]): void;
    /** Simulate scroll position to capture the visible viewport. */
    simulateScrollPosition(container: HTMLElement, restoreFns: (() => void)[]): void;
    /** Return CSS selectors for scroll areas (used to transfer scrollTop to clone). */
    getScrollAreaSelectors(): string[];
}

export interface ViewExportOptions {
    app: App;
    container: HTMLElement;
    taskIndex: TaskIndex;
    filename: string;
    expandScrollAreas?: boolean;
}
