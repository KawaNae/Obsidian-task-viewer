import { setIcon } from 'obsidian';
import { t } from '../../../i18n';
import type { DisplayTask } from '../../../types';
import type { ScheduleTaskRenderer } from './ScheduleTaskRenderer';
import type { CardReconciler } from '../../sharedUI/CardReconciler';

export interface ScheduleSectionRendererOptions {
    taskRenderer: ScheduleTaskRenderer;
    currentVisualDateProvider: () => string;
}

export class ScheduleSectionRenderer {
    private readonly taskRenderer: ScheduleTaskRenderer;
    /** Whether the all-day lane is folded; kept across renders of the view. */
    private allDayCollapsed = false;
    private readonly currentVisualDateProvider: () => string;

    constructor(options: ScheduleSectionRendererOptions) {
        this.taskRenderer = options.taskRenderer;
        this.currentVisualDateProvider = options.currentVisualDateProvider;
    }

    renderAllDaySection(container: HTMLElement, tasks: DisplayTask[], reconciler: CardReconciler): void {
        const row = container.createDiv('tv-grid-row allday-section');
        row.style.gridTemplateColumns = this.getScheduleRowColumns();

        const axisCell = row.createDiv('allday-section__cell allday-section__axis');
        axisCell.setAttribute('role', 'button');
        axisCell.setAttribute('tabindex', '0');
        axisCell.setAttribute('aria-label', t('allDaySection.toggleAllDay'));

        const toggleBtn = axisCell.createEl('button', { cls: 'tv-icon-btn tv-section-toggle tv-section-toggle--axis' });
        toggleBtn.tabIndex = -1;
        toggleBtn.setAttribute('aria-hidden', 'true');

        axisCell.createEl('span', { cls: 'allday-section__label', text: t('allDaySection.allDay') });

        const taskCell = row.createDiv('allday-section__cell is-first-cell is-last-cell');
        taskCell.dataset.collapsedLabel = t('allDaySection.allDay');
        taskCell.dataset.date = this.currentVisualDateProvider();

        const applyCollapsedState = () => {
            const isCollapsed = this.allDayCollapsed;
            row.toggleClass('allday-section--collapsed', isCollapsed);
            setIcon(toggleBtn, isCollapsed ? 'plus' : 'minus');
            axisCell.setAttribute('aria-expanded', (!isCollapsed).toString());
            axisCell.setAttribute('aria-label', isCollapsed ? t('allDaySection.expandAllDay') : t('allDaySection.collapseAllDay'));
        };

        const toggleCollapsed = () => {
            this.allDayCollapsed = !this.allDayCollapsed;
            applyCollapsedState();
        };

        axisCell.addEventListener('click', () => {
            toggleCollapsed();
        });

        axisCell.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleCollapsed();
            }
        });

        applyCollapsedState();

        for (const task of tasks) {
            this.taskRenderer.renderTaskCard(taskCell, task, false, reconciler);
        }
    }

    private getScheduleRowColumns(): string {
        return 'var(--schedule-axis-width) minmax(0, 1fr)';
    }
}
