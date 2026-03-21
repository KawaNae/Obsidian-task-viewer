import type { ExportStrategy } from './ExportTypes';
import { ExportUtils } from './ExportUtils';

export class ScheduleExportStrategy implements ExportStrategy {
    expandScrollAreas(container: HTMLElement, restoreFns: (() => void)[]): void {
        const scrollAreas = Array.from(container.querySelectorAll<HTMLElement>('.schedule-view__body-scroll'));
        for (const area of scrollAreas) {
            ExportUtils.expandScrollArea(area, restoreFns);
        }
        ExportUtils.expandOverflowParents(container, '.schedule-view, .schedule-view__body-scroll', restoreFns);
        ExportUtils.expandContainer(container, restoreFns);
    }

    simulateScrollPosition(container: HTMLElement, restoreFns: (() => void)[]): void {
        const scrollAreas = Array.from(container.querySelectorAll<HTMLElement>('.schedule-view__body-scroll'));
        for (const area of scrollAreas) {
            ExportUtils.simulateScroll(area, restoreFns);
        }
    }

    getScrollAreaSelectors(): string[] {
        return ['.schedule-view__body-scroll'];
    }
}
