import { setIcon } from 'obsidian';
import type { RenderableTask } from '../../utils/RenderableTaskUtils';
import type { CollapsibleSectionKey } from '../ScheduleTypes';
import type { ScheduleTaskRenderer } from './ScheduleTaskRenderer';

export interface ScheduleSectionRendererOptions {
    taskRenderer: ScheduleTaskRenderer;
    collapsedSections: Record<CollapsibleSectionKey, boolean>;
    currentDateProvider: () => string;
}

export class ScheduleSectionRenderer {
    private readonly taskRenderer: ScheduleTaskRenderer;
    private readonly collapsedSections: Record<CollapsibleSectionKey, boolean>;
    private readonly currentDateProvider: () => string;

    constructor(options: ScheduleSectionRendererOptions) {
        this.taskRenderer = options.taskRenderer;
        this.collapsedSections = options.collapsedSections;
        this.currentDateProvider = options.currentDateProvider;
    }

    async renderAllDaySection(container: HTMLElement, tasks: RenderableTask[]): Promise<void> {
        const row = container.createDiv('timeline-row allday-section');
        row.style.gridTemplateColumns = this.getScheduleRowColumns();

        const axisCell = row.createDiv('allday-section__cell allday-section__axis');
        axisCell.setAttribute('role', 'button');
        axisCell.setAttribute('tabindex', '0');
        axisCell.setAttribute('aria-label', 'Toggle All Day section');

        const toggleBtn = axisCell.createEl('button', { cls: 'schedule-section__toggle' });
        toggleBtn.tabIndex = -1;
        toggleBtn.setAttribute('aria-hidden', 'true');

        axisCell.createEl('span', { cls: 'allday-section__label', text: 'All Day' });

        const taskCell = row.createDiv('allday-section__cell is-first-cell is-last-cell');
        taskCell.dataset.date = this.currentDateProvider();

        const applyCollapsedState = () => {
            const isCollapsed = this.collapsedSections.allDay;
            row.toggleClass('collapsed', isCollapsed);
            setIcon(toggleBtn, isCollapsed ? 'plus' : 'minus');
            axisCell.setAttribute('aria-expanded', (!isCollapsed).toString());
            axisCell.setAttribute('aria-label', isCollapsed ? 'Expand All Day' : 'Collapse All Day');
        };

        const toggleCollapsed = () => {
            this.collapsedSections.allDay = !this.collapsedSections.allDay;
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
            await this.taskRenderer.renderTaskCard(taskCell, task, false);
        }
    }

    async renderCollapsibleTaskSection(
        container: HTMLElement,
        sectionClass: string,
        title: string,
        tasks: RenderableTask[],
        sectionKey: CollapsibleSectionKey
    ): Promise<void> {
        const section = container.createDiv(`schedule-section schedule-section--collapsible ${sectionClass}`);
        const header = section.createEl('h4', { cls: 'schedule-section__header' });
        header.setAttribute('role', 'button');
        header.setAttribute('tabindex', '0');
        header.setAttribute('aria-label', `Toggle ${title} section`);

        const icon = header.createEl('button', { cls: 'schedule-section__toggle schedule-section__collapse-btn' });
        icon.tabIndex = -1;
        icon.setAttribute('aria-hidden', 'true');
        header.createSpan({ text: title });

        const applyCollapsedState = () => {
            const isCollapsed = this.collapsedSections[sectionKey];
            section.toggleClass('schedule-section--collapsed', isCollapsed);
            setIcon(icon, isCollapsed ? 'plus' : 'minus');
            header.setAttribute('aria-expanded', (!isCollapsed).toString());
            header.setAttribute('aria-label', isCollapsed ? `Expand ${title}` : `Collapse ${title}`);
        };

        const toggleCollapsed = () => {
            this.collapsedSections[sectionKey] = !this.collapsedSections[sectionKey];
            applyCollapsedState();
        };

        header.addEventListener('click', () => {
            toggleCollapsed();
        });

        header.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleCollapsed();
            }
        });

        applyCollapsedState();

        const tasksContainer = section.createDiv('schedule-section__tasks');
        for (const task of tasks) {
            await this.taskRenderer.renderTaskCard(tasksContainer, task, false);
        }
    }

    private getScheduleRowColumns(): string {
        return 'var(--schedule-axis-width) minmax(0, 1fr)';
    }
}
