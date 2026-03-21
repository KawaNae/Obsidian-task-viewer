import type { ExportStrategy } from './ExportTypes';
import { ExportUtils } from './ExportUtils';

export class KanbanExportStrategy implements ExportStrategy {
    expandScrollAreas(container: HTMLElement, restoreFns: (() => void)[]): void {
        // Expand the grid host (main scroll area)
        const gridHost = Array.from(container.querySelectorAll<HTMLElement>('.kanban-view__grid-host'));
        for (const area of gridHost) {
            ExportUtils.expandScrollArea(area, restoreFns);
        }

        // Expand each cell body (per-column scroll)
        const cellBodies = Array.from(container.querySelectorAll<HTMLElement>('.kanban-view__cell-body'));
        for (const area of cellBodies) {
            ExportUtils.expandScrollArea(area, restoreFns);
        }

        // Remove overflow constraints from cells themselves
        const cells = Array.from(container.querySelectorAll<HTMLElement>('.kanban-view__cell'));
        for (const cell of cells) {
            const origOverflow = cell.style.overflow;
            const origMinHeight = cell.style.minHeight;
            cell.style.overflow = 'visible';
            cell.style.minHeight = 'auto';
            restoreFns.push(() => {
                cell.style.overflow = origOverflow;
                cell.style.minHeight = origMinHeight;
            });
        }

        ExportUtils.expandOverflowParents(container, '.kanban-view, .kanban-view__grid-host', restoreFns);
        ExportUtils.expandContainer(container, restoreFns);
    }

    simulateScrollPosition(container: HTMLElement, restoreFns: (() => void)[]): void {
        // Simulate grid host scroll
        const gridHost = Array.from(container.querySelectorAll<HTMLElement>('.kanban-view__grid-host'));
        for (const area of gridHost) {
            ExportUtils.simulateScroll(area, restoreFns);
        }

        // Simulate each cell body scroll
        const cellBodies = Array.from(container.querySelectorAll<HTMLElement>('.kanban-view__cell-body'));
        for (const area of cellBodies) {
            ExportUtils.simulateScroll(area, restoreFns);
        }
    }

    getScrollAreaSelectors(): string[] {
        return ['.kanban-view__grid-host', '.kanban-view__cell-body'];
    }
}
