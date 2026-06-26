import type { App } from 'obsidian';
import type { TaskViewerSettings } from '../../types';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import type { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';

export interface DateLabelDeps {
    app: App;
    getSettings: () => TaskViewerSettings;
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

        yearWrapper.addEventListener('click', async () => {
            const date = new Date(currentYear, 0, 1);
            const settings = deps.getSettings();
            let file = DailyNoteUtils.getYearlyNote(deps.app, settings, date);
            if (!file) file = await DailyNoteUtils.createYearlyNote(deps.app, settings, date);
            if (file) await deps.app.workspace.getLeaf(false).openFile(file);
        });

        monthWrapper.addEventListener('click', async () => {
            const date = new Date(currentYear, currentMonth, 1);
            const settings = deps.getSettings();
            let file = DailyNoteUtils.getMonthlyNote(deps.app, settings, date);
            if (!file) file = await DailyNoteUtils.createMonthlyNote(deps.app, settings, date);
            if (file) await deps.app.workspace.getLeaf(false).openFile(file);
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
            const yearDate = new Date(year, 0, 1);
            const yearTarget = DailyNoteUtils.getYearlyNoteLinkTarget(settings, yearDate);
            yearLink.dataset.href = yearTarget;
            yearLink.setAttribute('href', yearTarget);
            yearWrapper.toggleClass('is-current', isCurrentYear);

            monthLink.textContent = String(month + 1).padStart(2, '0');
            const monthDate = new Date(year, month, 1);
            const monthTarget = DailyNoteUtils.getMonthlyNoteLinkTarget(settings, monthDate);
            monthLink.dataset.href = monthTarget;
            monthLink.setAttribute('href', monthTarget);
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
