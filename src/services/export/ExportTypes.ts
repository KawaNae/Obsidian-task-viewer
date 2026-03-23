import type { App } from 'obsidian';
import type { TaskReadService } from '../data/TaskReadService';

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
    readService: TaskReadService;
    filename: string;
    expandScrollAreas?: boolean;
}
