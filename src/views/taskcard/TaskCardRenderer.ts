import { App, MarkdownRenderer, Component } from 'obsidian';
import { Task, TaskViewerSettings, isCompleteStatusChar } from '../../types';
import { TaskIndex } from '../../services/core/TaskIndex';
import { DateUtils } from '../../utils/DateUtils';
import { ChildItemBuilder } from './ChildItemBuilder';
import { ChildSectionRenderer } from './ChildSectionRenderer';
import { CheckboxWiring } from './CheckboxWiring';

export class TaskCardRenderer {
    private static readonly COLLAPSE_THRESHOLD = 3;

    private expandedTaskIds: Set<string> = new Set();
    private childItemBuilder: ChildItemBuilder;
    private childSectionRenderer: ChildSectionRenderer;
    private checkboxWiring: CheckboxWiring;

    constructor(private app: App, taskIndex: TaskIndex) {
        this.checkboxWiring = new CheckboxWiring(app, taskIndex);
        this.childItemBuilder = new ChildItemBuilder(taskIndex);
        this.childSectionRenderer = new ChildSectionRenderer(app, this.checkboxWiring);
    }

    async render(
        container: HTMLElement,
        task: Task,
        component: Component,
        settings: TaskViewerSettings,
        options?: { topRight?: 'time' | 'deadline' | 'none' }
    ): Promise<void> {
        const topRight = options?.topRight ?? 'time';
        this.renderTopRightMeta(container, task, settings, topRight);

        const contentContainer = container.createDiv('task-card__content');
        const parentMarkdown = this.buildParentMarkdown(task, settings);

        if (task.parserId === 'frontmatter') {
            await MarkdownRenderer.render(this.app, parentMarkdown, contentContainer, task.file, component);
            await this.renderFrontmatterChildren(contentContainer, task, component, settings);
        } else if (task.childLines.length > 0) {
            await this.renderInlineChildren(contentContainer, task, component, settings, parentMarkdown);
        } else {
            await MarkdownRenderer.render(this.app, parentMarkdown, contentContainer, task.file, component);
        }

        this.bindInternalLinks(contentContainer, task);
        this.bindParentCheckbox(contentContainer, task.id, settings);
    }

    private renderTopRightMeta(
        container: HTMLElement,
        task: Task,
        settings: TaskViewerSettings,
        topRight: 'time' | 'deadline' | 'none'
    ): void {
        if (topRight === 'time' && task.startTime) {
            const timeDisplay = container.createDiv('task-card__time');
            let timeText = task.startTime;

            if (task.endTime) {
                const startDate = new Date(`${task.startDate}T${task.startTime}`);
                let endDate: Date;

                if (task.endTime.includes('T')) {
                    endDate = new Date(task.endTime);
                } else {
                    endDate = new Date(`${task.startDate}T${task.endTime}`);
                    if (endDate < startDate) {
                        endDate.setDate(endDate.getDate() + 1);
                    }
                }

                const limitDate = new Date(`${task.startDate}T${settings.startHour.toString().padStart(2, '0')}:00`);
                limitDate.setDate(limitDate.getDate() + 1);

                if (endDate > limitDate) {
                    const startStr = `${task.startDate}T${task.startTime}`;
                    const endY = endDate.getFullYear();
                    const endM = (endDate.getMonth() + 1).toString().padStart(2, '0');
                    const endD = endDate.getDate().toString().padStart(2, '0');
                    const endH = endDate.getHours().toString().padStart(2, '0');
                    const endMin = endDate.getMinutes().toString().padStart(2, '0');
                    const endStr = `${endY}-${endM}-${endD}T${endH}:${endMin}`;
                    timeText = `${startStr}>${endStr}`;
                } else {
                    const endH = endDate.getHours().toString().padStart(2, '0');
                    const endMin = endDate.getMinutes().toString().padStart(2, '0');
                    const endStr = `${endH}:${endMin}`;
                    timeText = `${task.startTime}>${endStr}`;
                }
            }

            timeDisplay.innerText = timeText;
            return;
        }

        if (topRight === 'deadline' && task.deadline) {
            const timeDisplay = container.createDiv('task-card__time');
            const parts = task.deadline.split('T');
            timeDisplay.innerText = parts[1] ? `${parts[0]} ${parts[1]}` : parts[0];
        }
    }

    private buildParentMarkdown(task: Task, settings: TaskViewerSettings): string {
        const statusChar = task.statusChar || ' ';

        let overdueIcon = '';
        if (!isCompleteStatusChar(task.statusChar, settings.completeStatusChars)) {
            if (task.deadline && DateUtils.isPastDeadline(task.deadline, settings.startHour)) {
                overdueIcon = '🚨 ';
            } else if (task.startDate && DateUtils.isPastDate(task.startDate, task.startTime, settings.startHour)) {
                overdueIcon = '⚠️ ';
            } else if (task.endDate) {
                const endTime = task.endTime?.includes('T') ? task.endTime.split('T')[1] : task.endTime;
                if (DateUtils.isPastDate(task.endDate, endTime, settings.startHour)) {
                    overdueIcon = '⚠️ ';
                }
            }
        }

        let parentLine = `- [${statusChar}] ${overdueIcon}${task.content}`;

        const filePath = task.file.replace(/\.md$/, '');
        const fileName = task.file.split('/').pop()?.replace('.md', '') || task.file;
        const hasContent = parentLine.replace(/^- \[[xX! -]\]\s*/, '').trim().length > 0;

        if (hasContent) {
            parentLine += ` : [[${filePath}|${fileName}]]`;
        } else {
            parentLine += `[[${filePath}|${fileName}]]`;
        }

        return parentLine;
    }

    private async renderInlineChildren(
        contentContainer: HTMLElement,
        task: Task,
        component: Component,
        settings: TaskViewerSettings,
        parentMarkdown: string
    ): Promise<void> {
        const items = this.childItemBuilder.buildInlineChildItems(task, '');
        if (items.length >= TaskCardRenderer.COLLAPSE_THRESHOLD) {
            await MarkdownRenderer.render(this.app, parentMarkdown, contentContainer, task.file, component);
            await this.childSectionRenderer.renderCollapsed(
                contentContainer,
                items,
                this.expandedTaskIds,
                task.id,
                task.file,
                component,
                settings,
                task.startDate
            );
            return;
        }

        const indentedItems = this.childItemBuilder.buildInlineChildItems(task, '    ');
        await this.childSectionRenderer.renderParentWithChildren(
            contentContainer,
            parentMarkdown,
            indentedItems,
            task.file,
            component,
            settings,
            task.startDate
        );
    }

    private async renderFrontmatterChildren(
        contentContainer: HTMLElement,
        task: Task,
        component: Component,
        settings: TaskViewerSettings
    ): Promise<void> {
        if (task.childIds.length === 0 && task.childLines.length === 0) {
            return;
        }

        const items = this.childItemBuilder.buildFrontmatterChildItems(task);
        if (items.length === 0) {
            return;
        }

        const shouldCollapse = items.length >= TaskCardRenderer.COLLAPSE_THRESHOLD;
        if (shouldCollapse) {
            await this.childSectionRenderer.renderCollapsed(
                contentContainer,
                items,
                this.expandedTaskIds,
                `${task.id}:fm-children`,
                task.file,
                component,
                settings,
                task.startDate
            );
            return;
        }

        await this.childSectionRenderer.renderExpanded(
            contentContainer,
            items,
            task.file,
            component,
            settings,
            task.startDate
        );
    }

    private bindInternalLinks(contentContainer: HTMLElement, task: Task): void {
        const internalLinks = contentContainer.querySelectorAll('a.internal-link');
        internalLinks.forEach((link) => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const target = (link as HTMLElement).dataset.href;
                if (target) {
                    this.app.workspace.openLinkText(target, task.file, true);
                }
            });
            link.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
            });
        });
    }

    private bindParentCheckbox(
        contentContainer: HTMLElement,
        taskId: string,
        settings: TaskViewerSettings
    ): void {
        const mainCheckbox = contentContainer.querySelector(':scope > ul > li > input[type="checkbox"]');
        if (mainCheckbox) {
            this.checkboxWiring.wireParentCheckbox(mainCheckbox, taskId, settings);
        }
    }
}
