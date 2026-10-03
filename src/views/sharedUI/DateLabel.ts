import type { App } from 'obsidian';
import type { TaskViewerSettings } from '../../types';
import { periodicNotes } from '../../utils/PeriodicNotes';
import { pointPeriodicLink } from './PeriodicNoteLink';
import { openPeriodicNoteInLeaf, type PeriodicNoteOpener } from '../sharedLogic/OpenPeriodicNote';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import type { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';

/** The first day of `month` (0-based) of `year`, as `YYYY-MM-DD`. */
function firstOf(year: number, month: number): string {
    return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`;
}

export interface DateLabelDeps {
    app: App;
    getSettings: () => TaskViewerSettings;
    /** What opens, or makes, a year's or month's note (`Operations.openPeriodicNote`). */
    notes: PeriodicNoteOpener;
    linkInteractionManager: TaskLinkInteractionManager;
    hoverParent: TaskViewHoverParent;
}

/**
 * Clickable YYYY - MM label for the toolbar left side.
 * Year and month link to their respective periodic notes.
 */
export class DateLabel {
    static render(
        toolbar: HTMLElement,
        deps: DateLabelDeps
    ): { update: (year: number, month: number) => void } {
        const labelGroup = toolbar.createDiv('view-toolbar__date-label');

        let currentYear = -1;
        let currentMonth = -1;

        const yearWrapper = labelGroup.createSpan({ cls: 'view-toolbar__date-label-year' });
        const yearLink = yearWrapper.createEl('a', { cls: 'internal-link' });

        labelGroup.createSpan({ cls: 'view-toolbar__date-label-sep', text: '-' });

        const monthWrapper = labelGroup.createSpan({ cls: 'view-toolbar__date-label-month' });
        const monthLink = monthWrapper.createEl('a', { cls: 'internal-link' });

        yearWrapper.addEventListener('click', () => {
            void openPeriodicNoteInLeaf(deps.app, deps.notes, periodicNotes(deps.getSettings(), 'yearly'), firstOf(currentYear, 0));
        });

        monthWrapper.addEventListener('click', () => {
            void openPeriodicNoteInLeaf(deps.app, deps.notes, periodicNotes(deps.getSettings(), 'monthly'), firstOf(currentYear, currentMonth));
        });

        const update = (year: number, month: number) => {
            if (year === currentYear && month === currentMonth) return;
            currentYear = year;
            currentMonth = month;

            const now = new Date();
            const isCurrentYear = year === now.getFullYear();
            const isCurrentMonth = isCurrentYear && month === now.getMonth();
            const settings = deps.getSettings();

            yearLink.textContent = `${year}`;
            pointPeriodicLink(yearLink, periodicNotes(settings, 'yearly'), firstOf(year, 0));
            yearWrapper.toggleClass('is-current', isCurrentYear);

            monthLink.textContent = String(month + 1).padStart(2, '0');
            pointPeriodicLink(monthLink, periodicNotes(settings, 'monthly'), firstOf(year, month));
            monthWrapper.toggleClass('is-current', isCurrentMonth);
        };

        return { update };
    }

    /**
     * Bind hover preview on the date label links.
     * Must be called AFTER the first update() so data-href attributes exist.
     */
    static bindHoverPreview(
        toolbar: HTMLElement,
        deps: DateLabelDeps
    ): void {
        const labelGroup = toolbar.querySelector('.view-toolbar__date-label');
        if (!labelGroup) return;
        const yearWrapper = labelGroup.querySelector('.view-toolbar__date-label-year');
        const monthWrapper = labelGroup.querySelector('.view-toolbar__date-label-month');
        if (yearWrapper) {
            deps.linkInteractionManager.bind(yearWrapper as HTMLElement, {
                sourcePath: '',
                hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
                hoverParent: deps.hoverParent,
            }, { bindClick: false });
        }
        if (monthWrapper) {
            deps.linkInteractionManager.bind(monthWrapper as HTMLElement, {
                sourcePath: '',
                hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
                hoverParent: deps.hoverParent,
            }, { bindClick: false });
        }
    }
}
