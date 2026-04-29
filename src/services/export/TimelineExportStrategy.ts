import type { ExportStrategy } from './ExportTypes';
import { ExportUtils } from './ExportUtils';

export class TimelineExportStrategy implements ExportStrategy {
    expandScrollAreas(container: HTMLElement, restoreFns: (() => void)[]): void {
        const scrollAreas = Array.from(container.querySelectorAll<HTMLElement>('.timeline-grid'));
        for (const area of scrollAreas) {
            ExportUtils.expandScrollArea(area, restoreFns);
        }
        ExportUtils.expandOverflowParents(container, '.timeline-view', restoreFns);
        ExportUtils.expandContainer(container, restoreFns);
    }

    simulateScrollPosition(container: HTMLElement, restoreFns: (() => void)[]): void {
        const scrollAreas = Array.from(container.querySelectorAll<HTMLElement>('.timeline-grid'));
        for (const area of scrollAreas) {
            ExportUtils.simulateScroll(area, restoreFns);
        }
    }

    getScrollAreaSelectors(): string[] {
        return ['.timeline-grid'];
    }
}
