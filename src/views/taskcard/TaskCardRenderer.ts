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
        this.checkboxWiring = new CheckboxWiring(writeService);
        this.childItemBuilder = new ChildItemBuilder(readService);
        this.childSectionRenderer = new ChildSectionRenderer(app, this.checkboxWiring, readService);
        this.linkInteractionManager = new TaskLinkInteractionManager(app, getSettings);
        // Clean up expandedTaskIds entries for tasks deleted via the UI so the
        // set does not grow unbounded over the renderer's lifetime. Keys are
        // `${viewId}::${scope}::${task.id}` (cardInstanceId), with frontmatter
        // children adding a `::fm-children` suffix. Match by suffix so all
        // card instances of the deleted task are dropped regardless of view /
        // scope (main grid, pinned list, etc.).
        this.unsubscribeTaskDeleted = writeService.onTaskDeleted((taskId) => {
            const suffix = `::${taskId}`;
            const fmSuffix = `::${taskId}::fm-children`;
            for (const key of [...this.expandedTaskIds]) {
                if (key.endsWith(fmSuffix) || key.endsWith(suffix)) {
                    this.expandedTaskIds.delete(key);
                }
            }
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
        options: { cardInstanceId: string; topRight?: 'time' | 'due' | 'none'; compact?: boolean; forceExpand?: boolean }
    ): Promise<void> {
        const cardInstanceId = options.cardInstanceId;
        const topRight = options.topRight ?? 'time';
        const compact = options.compact ?? false;
        const forceExpand = options.forceExpand ?? false;

        // Tag the card with its instance id so partial-update paths
        // (e.g. TimelineView.tryPartialUpdate) can reuse the same key.
        container.dataset.cardInstanceId = cardInstanceId;

        const prev = this.cardComponents.get(container);
        if (prev) this.removeChild(prev);
        const cardComp = new Component();
        this.addChild(cardComp);
        this.cardComponents.set(container, cardComp);

        this.renderTopRightMeta(container, task, settings, topRight);

        const contentContainer = container.createDiv('task-card__content');
        const parentMarkdown = this.buildParentMarkdown(task, settings);

        if (compact) {
            // Build the expand-bar synchronously, BEFORE the markdown await.
            // Without this, the bar appears in a microtask after MarkdownRenderer
            // resolves, briefly shrinking compact cards by ~21px. For allday
            // cards stacked on a CSS grid, that transient propagates to the
            // allday-section height, which combined with the sync scroll-restore
            // in TimelineView.performRender produces a 1-frame flicker of timed
            // cards shifting up then settling back.
            const expandBar = container.createDiv('task-card__expand-bar');
            const expandIconSpan = expandBar.createSpan();
            const expandLabelSpan = expandBar.createSpan();
            expandBar.addEventListener('click', (e) => {
                e.stopPropagation();
                this.onDetailClick?.(task);
            });

            const strippedMarkdown = parentMarkdown
                .replace(/!\[\[([^\]]*)\]\]/g, '')
                .replace(/!\[([^\]]*)\]\([^)]*\)/g, '');
            await MarkdownRenderer.render(this.app, strippedMarkdown, contentContainer, task.file, cardComp);

            // Populate expand-bar contents post-await. Element is already in DOM
            // with stable height locked by .task-card__expand-bar min-height.
            setIcon(expandIconSpan, 'expand');
            const { completed, total } = this.getChildCompletion(task, settings);
            if (total > 0) {
                expandLabelSpan.setText(` ${completed}/${total}`);
            }
        } else if (isFrontmatterTask(task)) {
            await MarkdownRenderer.render(this.app, parentMarkdown, contentContainer, task.file, cardComp);
            await this.renderFrontmatterChildren(contentContainer, task, cardComp, settings, cardInstanceId, forceExpand);
        } else if (task.childEntries.length > 0) {
            await this.renderInlineChildren(contentContainer, task, cardComp, settings, parentMarkdown, cardInstanceId, forceExpand);
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

    private getChildCompletion(task: DisplayTask, settings: TaskViewerSettings): { completed: number; total: number } {
        let completed = 0;
        let total = 0;
        const lookup = this.childItemBuilder.getReadService();

        for (const entry of task.childEntries) {
            if (entry.kind === 'task' || entry.kind === 'wikilink') {
                const child = entry.kind === 'task'
                    ? lookup.getTask(entry.taskId)
                    : this.resolveWikilinkChild(task, entry.target);
                if (!child) continue;
                total++;
                if (isCompleteStatusChar(child.statusChar, settings.statusDefinitions)) completed++;
            } else if (entry.kind === 'plain' && entry.line.checkboxChar !== null) {
                total++;
                if (isCompleteStatusChar(entry.line.checkboxChar, settings.statusDefinitions)) completed++;
            }
        }

        return { completed, total };
    }

    private resolveWikilinkChild(parent: DisplayTask, target: string): Task | undefined {
        const t = target.split('|')[0].trim();
        const lookup = this.childItemBuilder.getReadService();
        for (const entry of parent.childEntries) {
            if (entry.kind !== 'task') continue;
            const c = lookup.getTask(entry.taskId);
            if (!c || !isFrontmatterTask(c)) continue;
            const baseName = c.file.replace(/\.md$/, '').split('/').pop() || '';
            const fullPath = c.file.replace(/\.md$/, '');
            if (t === baseName || t === fullPath || t === c.file) return c;
        }
        return undefined;
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
        cardInstanceId: string,
        forceExpand = false
    ): Promise<void> {
        const items = this.childItemBuilder.buildChildItems(task, '');
        if (!forceExpand && items.length >= TaskCardRenderer.COLLAPSE_THRESHOLD) {
            await MarkdownRenderer.render(this.app, parentMarkdown, contentContainer, task.file, component);
            await this.childSectionRenderer.renderCollapsed(
                contentContainer,
                items,
                this.expandedTaskIds,
                cardInstanceId,
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
        task: DisplayTask,
        component: Component,
        settings: TaskViewerSettings,
        cardInstanceId: string,
        forceExpand = false
    ): Promise<void> {
        if (task.childEntries.length === 0) {
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
                `${cardInstanceId}::fm-children`,
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
