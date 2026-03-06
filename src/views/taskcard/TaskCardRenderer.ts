import { App, MarkdownRenderer, Component, setIcon } from 'obsidian';
import { Task, TaskViewerSettings, isCompleteStatusChar } from '../../types';
import { TaskIndex } from '../../services/core/TaskIndex';
import { DateUtils } from '../../utils/DateUtils';
import { getFileBaseName, hasTaskContent, isContentMatchingBaseName } from '../../utils/TaskContent';
import { ImplicitCalendarDateResolver } from '../../utils/ImplicitCalendarDateResolver';
import { ChildItemBuilder } from './ChildItemBuilder';
import { ChildSectionRenderer, ChildMenuCallback } from './ChildSectionRenderer';
import { CheckboxWiring } from './CheckboxWiring';
import { TaskLinkInteractionManager } from './TaskLinkInteractionManager';
import type { TaskCardLinkRuntime } from './types';

export class TaskCardRenderer {
    private static readonly COLLAPSE_THRESHOLD = 3;

    private expandedTaskIds: Set<string> = new Set();
    private childItemBuilder: ChildItemBuilder;
    private childSectionRenderer: ChildSectionRenderer;
    private checkboxWiring: CheckboxWiring;
    private linkInteractionManager: TaskLinkInteractionManager;
    private onDetailClick: ((task: Task) => void) | null = null;

    constructor(private app: App, taskIndex: TaskIndex, private linkRuntime: TaskCardLinkRuntime, getSettings: () => TaskViewerSettings) {
        this.checkboxWiring = new CheckboxWiring(app, taskIndex);
        this.childItemBuilder = new ChildItemBuilder(taskIndex);
        this.childSectionRenderer = new ChildSectionRenderer(app, this.checkboxWiring, taskIndex);
        this.linkInteractionManager = new TaskLinkInteractionManager(app, getSettings);
    }

    setChildMenuCallback(cb: ChildMenuCallback): void {
        this.childSectionRenderer.setChildMenuCallback(cb);
    }

    setDetailCallback(cb: (task: Task) => void): void {
        this.onDetailClick = cb;
    }

    async render(
        container: HTMLElement,
        task: Task,
        component: Component,
        settings: TaskViewerSettings,
        options?: { topRight?: 'time' | 'deadline' | 'none'; compact?: boolean; forceExpand?: boolean }
    ): Promise<void> {
        const topRight = options?.topRight ?? 'time';
        const compact = options?.compact ?? false;
        const forceExpand = options?.forceExpand ?? false;

        this.renderTopRightMeta(container, task, settings, topRight);

        const contentContainer = container.createDiv('task-card__content');
        const parentMarkdown = this.buildParentMarkdown(task, settings);

        if (compact) {
            const strippedMarkdown = parentMarkdown
                .replace(/!\[\[([^\]]*)\]\]/g, '')
                .replace(/!\[([^\]]*)\]\([^)]*\)/g, '');
            await MarkdownRenderer.render(this.app, strippedMarkdown, contentContainer, task.file, component);

            const { completed, total } = this.getChildCompletion(task, settings);
            const expandBar = container.createDiv('task-card__expand-bar');
            setIcon(expandBar.createSpan(), 'expand');
            if (total > 0) {
                expandBar.createSpan().setText(` ${completed}/${total}`);
            }
            expandBar.addEventListener('click', (e) => {
                e.stopPropagation();
                this.onDetailClick?.(task);
            });
        } else if (task.parserId === 'frontmatter') {
            await MarkdownRenderer.render(this.app, parentMarkdown, contentContainer, task.file, component);
            await this.renderFrontmatterChildren(contentContainer, task, component, settings, forceExpand);
        } else if (task.childLines.length > 0) {
            await this.renderInlineChildren(contentContainer, task, component, settings, parentMarkdown, forceExpand);
        } else {
            await MarkdownRenderer.render(this.app, parentMarkdown, contentContainer, task.file, component);
        }

        this.bindInternalLinks(contentContainer, task.file);
        this.bindParentCheckbox(contentContainer, task.id, settings);
    }

    private getChildCompletion(task: Task, settings: TaskViewerSettings): { completed: number; total: number } {
        let completed = 0;
        let total = 0;

        if (task.parserId === 'frontmatter') {
            for (const childId of task.childIds) {
                const child = this.childItemBuilder.getTaskIndex().getTask(childId);
                if (!child) continue;
                total++;
                if (isCompleteStatusChar(child.statusChar, settings.completeStatusChars)) completed++;
            }
        }

        for (const line of task.childLines) {
            const match = line.match(/\[(.)\]/);
            if (!match) continue;
            total++;
            if (isCompleteStatusChar(match[1], settings.completeStatusChars)) completed++;
        }

        return { completed, total };
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
            } else {
                const effectiveEnd = task.endDate
                    ? { endDate: task.endDate, endTime: task.endTime }
                    : ImplicitCalendarDateResolver.resolveImplicitEnd(task, settings.startHour);
                if (effectiveEnd) {
                    const endTime = effectiveEnd.endTime?.includes('T') ? effectiveEnd.endTime.split('T')[1] : effectiveEnd.endTime;
                    if (DateUtils.isPastDate(effectiveEnd.endDate, endTime, settings.startHour)) {
                        overdueIcon = '⚠️ ';
                    }
                }
            }
        }

        const filePath = task.file.replace(/\.md$/, '');
        const fileBaseName = getFileBaseName(task.file) || filePath;
        const fileLink = `[[${filePath}|${fileBaseName}]]`;
        const shouldShowContent = hasTaskContent(task) && !isContentMatchingBaseName(task);

        if (shouldShowContent) {
            return `- [${statusChar}] ${overdueIcon}${task.content} : ${fileLink}`;
        }

        return `- [${statusChar}] ${overdueIcon}${fileLink}`;
    }

    private async renderInlineChildren(
        contentContainer: HTMLElement,
        task: Task,
        component: Component,
        settings: TaskViewerSettings,
        parentMarkdown: string,
        forceExpand = false
    ): Promise<void> {
        const items = this.childItemBuilder.buildInlineChildItems(task, '');
        if (!forceExpand && items.length >= TaskCardRenderer.COLLAPSE_THRESHOLD) {
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
        settings: TaskViewerSettings,
        forceExpand = false
    ): Promise<void> {
        if (task.childIds.length === 0 && task.childLines.length === 0) {
            return;
        }

        const items = this.childItemBuilder.buildFrontmatterChildItems(task);
        if (items.length === 0) {
            return;
        }

        const shouldCollapse = !forceExpand && items.length >= TaskCardRenderer.COLLAPSE_THRESHOLD;
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

    private bindInternalLinks(contentContainer: HTMLElement, sourcePath: string): void {
        this.linkInteractionManager.bind(contentContainer, {
            sourcePath,
            hoverSource: this.linkRuntime.hoverSource,
            hoverParent: this.linkRuntime.getHoverParent(),
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
