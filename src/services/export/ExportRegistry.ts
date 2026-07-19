import type { ExportTargetSpec } from './ExportTypes';

export interface ViewExportDescriptor {
    containerSelector: string;
    spec: ExportTargetSpec;
}

const EXPORT_DESCRIPTORS: Record<string, ViewExportDescriptor> = {
    'timeline-view': {
        containerSelector: '.timeline-view',
        spec: {
            scrollAreas: ['.timeline-grid'],
            overflowParents: '.timeline-view',
        },
    },
    // calendar-view: excluded — html-to-image's SVG serialization exceeds
    // V8 string length limits on calendar DOM regardless of task count.
    // Tracked as a known limitation in project_open_issues.md.
    'schedule-view': {
        containerSelector: '.schedule-view',
        spec: {
            scrollAreas: ['.schedule-view__body-scroll'],
            overflowParents: '.schedule-view, .schedule-view__body-scroll',
        },
    },
    'kanban-view': {
        containerSelector: '.kanban-view',
        spec: {
            scrollAreas: ['.kanban-view__grid-host', '.kanban-view__cell-body'],
            overflowParents: '.kanban-view, .kanban-view__grid-host',
            extraExpand: (container, restoreFns) => {
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
            },
        },
    },
};

export function exportDescriptorFor(viewType: string): ViewExportDescriptor | undefined {
    return EXPORT_DESCRIPTORS[viewType];
}

export function resolveExportContainer(
    contentEl: HTMLElement,
    descriptor: ViewExportDescriptor,
): HTMLElement | null {
    const sel = descriptor.containerSelector;
    if (contentEl.matches(sel)) return contentEl;
    return contentEl.querySelector<HTMLElement>(sel);
}
