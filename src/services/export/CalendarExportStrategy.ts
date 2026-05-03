import type { ExportStrategy } from './ExportTypes';
import { ExportUtils } from './ExportUtils';

export class CalendarExportStrategy implements ExportStrategy {
    expandScrollAreas(container: HTMLElement, restoreFns: (() => void)[]): void {
        const scrollAreas = Array.from(container.querySelectorAll<HTMLElement>('.cal-grid__body'));
        for (const area of scrollAreas) {
            ExportUtils.expandScrollArea(area, restoreFns);
        }
        ExportUtils.expandOverflowParents(container, '.calendar-view, .cal-grid', restoreFns);
        ExportUtils.expandContainer(container, restoreFns);
    }

    simulateScrollPosition(container: HTMLElement, restoreFns: (() => void)[]): void {
        const scrollAreas = Array.from(container.querySelectorAll<HTMLElement>('.cal-grid__body'));
        for (const area of scrollAreas) {
            ExportUtils.simulateScroll(area, restoreFns);
        }
    }

    getScrollAreaSelectors(): string[] {
        return ['.cal-grid__body'];
    }
}
