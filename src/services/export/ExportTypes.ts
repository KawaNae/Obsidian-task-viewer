import type { App } from 'obsidian';
import type { TaskDataService } from '../data/TaskDataService';

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
    dataService: TaskDataService;
    filename: string;
    expandScrollAreas?: boolean;
}
