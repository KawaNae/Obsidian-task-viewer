import { App, MarkdownRenderer, Component, setIcon } from 'obsidian';
import { Task, DisplayTask, TaskViewerSettings, isCompleteStatusChar, isFrontmatterTask } from '../../types';
import { TaskReadService } from '../../services/data/TaskReadService';
import { TaskWriteService } from '../../services/data/TaskWriteService';
import { DateUtils } from '../../utils/DateUtils';
import { getFileBaseName, hasTaskContent, isContentMatchingBaseName } from '../../services/parsing/utils/TaskContent';
import { ChildItemBuilder } from './ChildItemBuilder';
import { ChildSectionRenderer, ChildMenuCallback, ChildLineEditCallback } from './ChildSectionRenderer';
import { CheckboxWiring } from './CheckboxWiring';
import { TaskLinkInteractionManager } from './TaskLinkInteractionManager';
import type { TaskCardLinkRuntime } from './types';

export class TaskCardRenderer extends Component {
    private static readonly COLLAPSE_THRESHOLD = 3;

    private expandedTaskIds: Set<string> = new Set();
    private childItemBuilder: ChildItemBuilder;
    private childSectionRenderer: ChildSectionRenderer;
    private checkboxWiring: CheckboxWiring;
    private linkInteractionManager: TaskLinkInteractionManager;
    private onDetailClick: ((task: Task) => void) | null = null;
    private cardComponents: WeakMap<HTMLElement, Component> = new WeakMap();
    private unsubscribeTaskDeleted: (() => void) | null = null;

    constructor(private app: App, readService: TaskReadService, writeService: TaskWriteService, private linkRuntime: TaskCardLinkRuntime, getSettings: () => TaskViewerSettings) {
        super();
        this.checkboxWiring = new CheckboxWiring(app, writeService);
        this.childItemBuilder = new ChildItemBuilder(readService);
        this.childSectionRenderer = new ChildSectionRenderer(app, this.checkboxWiring, readService);
        this.linkInteractionManager = new TaskLinkInteractionManager(app, getSettings);
        // Clean up expandedTaskIds entries for tasks deleted via the UI so the
        // set does not grow unbounded over the renderer's lifetime. Frontmatter
        // children share the parent's id with a `:fm-children` suffix, so we
        // drop both keys.
        this.unsubscribeTaskDeleted = writeService.onTaskDeleted((taskId) => {
            this.expandedTaskIds.delete(taskId);
            this.expandedTaskIds.delete(`${taskId}:fm-children`);
        });
    }

    onunload(): void {
        if (this.unsubscribeTaskDeleted) {
            this.unsubscribeTaskDeleted();
            this.unsubscribeTaskDeleted = null;
        }
        super.onunload();
    }

    setChildMenuCallback(cb: ChildMenuCallback): void {
        this.childSectionRenderer.setChildMenuCallback(cb);
    }

    setChildLineEditCallback(cb: ChildLineEditCallback): void {
        this.childSectionRenderer.setChildLineEditCallback(cb);
    }

    setDetailCallback(cb: (task: Task) => void): void {
        this.onDetailClick = cb;
    }

    async render(
        container: HTMLElement,
        task: DisplayTask,
        settings: TaskViewerSettings,
        options?: { topRight?: 'time' | 'due' | 'none'; compact?: boolean; forceExpand?: boolean }
    ): Promise<void> {
        const topRight = options?.topRight ?? 'time';
        const compact = options?.compact ?? false;
        const forceExpand = options?.forceExpand ?? false;

        const prev = this.cardComponents.get(container);
        if (prev) this.removeChild(prev);
        const cardComp = new Component();
        this.addChild(cardComp);
        this.cardComponents.set(container, cardComp);

        this.renderTopRightMeta(container, task, settings, topRight);

        const contentContainer = container.createDiv('task-card__content');
        const parentMarkdown = this.buildParentMarkdown(task, settings);

        if (compact) {
            const strippedMarkdown = parentMarkdown
                .replace(/!\[\[([^\]]*)\]\]/g, '')
                .replace(/!\[([^\]]*)\]\([^)]*\)/g, '');
            await MarkdownRenderer.render(this.app, strippedMarkdown, contentContainer, task.file, cardComp);

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
        } else if (isFrontmatterTask(task)) {
            await MarkdownRenderer.render(this.app, parentMarkdown, contentContainer, task.file, cardComp);
            await this.renderFrontmatterChildren(contentContainer, task, cardComp, settings, forceExpand);
        } else if (task.childLines.length > 0 || task.childIds.length > 0) {
            await this.renderInlineChildren(contentContainer, task, cardComp, settings, parentMarkdown, forceExpand);
        } else {
            await MarkdownRenderer.render(this.app, parentMarkdown, contentContainer, task.file, cardComp);
        }

        this.bindInternalLinks(contentContainer, task.file, settings.enableCardFileLink);
        this.bindParentCheckbox(contentContainer, task.originalTaskId ?? task.id, settings, task.isReadOnly);
    }

    dispose(container: HTMLElement): void {
        const comp = this.cardComponents.get(container);
        if (comp) {
            this.removeChild(comp);
            this.cardComponents.delete(container);
        }
    }

    disposeInside(root: HTMLElement): void {
        const cards = root.querySelectorAll<HTMLElement>('.task-card');
        cards.forEach(card => this.dispose(card));
    }

    private getChildCompletion(task: Task, settings: TaskViewerSettings): { completed: number; total: number } {
        let completed = 0;
        let total = 0;

        if (isFrontmatterTask(task)) {
            for (const childId of task.childIds) {
                const child = this.childItemBuilder.getReadService().getTask(childId);
                if (!child) continue;
                total++;
                if (isCompleteStatusChar(child.statusChar, settings.statusDefinitions)) completed++;
            }
        }

        for (const cl of task.childLines) {
            if (cl.checkboxChar === null) continue;
            total++;
            if (isCompleteStatusChar(cl.checkboxChar, settings.statusDefinitions)) completed++;
        }

        return { completed, total };
    }

    private renderTopRightMeta(
        container: HTMLElement,
        task: DisplayTask,
        settings: TaskViewerSettings,
        topRight: 'time' | 'due' | 'none'
    ): void {
        if (topRight === 'time' && task.effectiveStartTime) {
            const timeDisplay = container.createDiv('task-card__time');
            let timeText = task.effectiveStartTime;

            if (task.effectiveEndTime) {
                timeText = `${task.effectiveStartTime}>${task.effectiveEndTime}`;
            }

            timeDisplay.innerText = timeText;
            return;
        }

        if (topRight === 'due' && task.due) {
            const timeDisplay = container.createDiv('task-card__time');
            const parts = task.due.split('T');
            timeDisplay.innerText = parts[1] ? `${parts[0]} ${parts[1]}` : parts[0];
        }
    }

    private buildParentMarkdown(task: DisplayTask, settings: TaskViewerSettings): string {
        const statusChar = task.statusChar || ' ';

        let overdueIcon = '';
        if (!isCompleteStatusChar(task.statusChar, settings.statusDefinitions)) {
            if (task.due && DateUtils.isPastDue(task.due, settings.startHour)) {
                overdueIcon = '🚨 ';
            } else {
                const endDate = task.effectiveEndDate ?? task.endDate;
                const endTime = task.effectiveEndTime ?? task.endTime;
                if (endDate) {
                    const cleanEndTime = endTime?.includes('T') ? endTime.split('T')[1] : endTime;
                    if (DateUtils.isPastDate(endDate, cleanEndTime, settings.startHour)) {
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
        const items = this.childItemBuilder.buildChildItems(task, '');
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

        const indentedItems = this.childItemBuilder.buildChildItems(task, '    ');
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

        const items = this.childItemBuilder.buildChildItems(task);
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

    private bindInternalLinks(contentContainer: HTMLElement, sourcePath: string, enableClick: boolean): void {
        this.linkInteractionManager.bind(contentContainer, {
            sourcePath,
            hoverSource: this.linkRuntime.hoverSource,
            hoverParent: this.linkRuntime.getHoverParent(),
        }, { bindClick: enableClick });
    }

    private bindParentCheckbox(
        contentContainer: HTMLElement,
        taskId: string,
        settings: TaskViewerSettings,
        readOnly?: boolean
    ): void {
        const mainCheckbox = contentContainer.querySelector(':scope > ul > li > input[type="checkbox"]');
        if (mainCheckbox) {
            this.checkboxWiring.wireParentCheckbox(mainCheckbox, taskId, settings, readOnly);
        }
    }
}
