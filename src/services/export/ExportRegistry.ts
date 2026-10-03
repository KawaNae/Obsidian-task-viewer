import type { ExportTargetSpec } from './ExportTypes';
import { descriptorOf, type ExportableViewType } from '../../views/ViewDescriptors';

export interface ViewExportDescriptor {
    containerSelector: string;
    spec: ExportTargetSpec;
}

/**
 * What to capture of each view that exports an image. Which views do is the
 * view table's `exportable`; keyed by the type read from it, a view marked
 * exportable without a target here is a compile error.
 */
const EXPORT_DESCRIPTORS: Record<ExportableViewType, ViewExportDescriptor> = {
    'timeline-view': {
        containerSelector: '.timeline-view',
        spec: {
            scrollAreas: ['.timeline-grid'],
            overflowParents: '.timeline-view',
        },
    },
    'calendar-view': {
        containerSelector: '.cal-grid',
        spec: {
            scrollAreas: ['.cal-grid__body'],
            overflowParents: '.calendar-view, .cal-grid',
        },
    },
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
    return descriptorOf(viewType)?.exportable
        ? EXPORT_DESCRIPTORS[viewType as ExportableViewType]
        : undefined;
}

export function resolveExportContainer(
    contentEl: HTMLElement,
    descriptor: ViewExportDescriptor,
): HTMLElement | null {
    const sel = descriptor.containerSelector;
    if (contentEl.matches(sel)) return contentEl;
    return contentEl.querySelector<HTMLElement>(sel);
}
