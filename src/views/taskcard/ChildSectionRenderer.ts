import { App, MarkdownRenderer, Component, setIcon } from 'obsidian';
import { TaskViewerSettings, isCompleteStatusChar } from '../../types';
import { TaskIndex } from '../../services/core/TaskIndex';
import { ChildRenderItem } from './types';
import { CheckboxWiring } from './CheckboxWiring';
import { NotationUtils } from './NotationUtils';

export type ChildMenuCallback = (taskId: string, x: number, y: number) => void;

function countChildCompletion(
    items: ChildRenderItem[],
    taskIndex: TaskIndex,
    settings: TaskViewerSettings
): { completed: number; total: number } {
    let completed = 0;
    let total = 0;
    for (const item of items) {
        if (!item.isCheckbox || !item.handler) continue;
        total++;
        if (item.handler.type === 'task') {
            const child = taskIndex.getTask(item.handler.taskId);
            if (child && isCompleteStatusChar(child.statusChar, settings.completeStatusChars)) {
                completed++;
            }
        } else {
            const cl = item.handler.parentTask.childLines[item.handler.childLineIndex];
            if (cl?.checkboxChar !== null && cl?.checkboxChar !== undefined && isCompleteStatusChar(cl.checkboxChar, settings.completeStatusChars)) {
                completed++;
            }
        }
    }
    return { completed, total };
}

/**
 * Renders child sections from ChildRenderItem[].
 */
export class ChildSectionRenderer {
    private onChildMenuClick: ChildMenuCallback | null = null;

    constructor(
        private app: App,
        private checkboxWiring: CheckboxWiring,
        private taskIndex: TaskIndex
    ) {}

    setChildMenuCallback(cb: ChildMenuCallback): void {
        this.onChildMenuClick = cb;
    }

    async renderCollapsed(
        contentContainer: HTMLElement,
        items: ChildRenderItem[],
        expandedTaskIds: Set<string>,
        expandKey: string,
        filePath: string,
        component: Component,
        settings: TaskViewerSettings,
        parentStartDate?: string
    ): Promise<void> {
        const { completed, total } = countChildCompletion(items, this.taskIndex, settings);
        const label = `${completed}/${total}`;
        const wasExpanded = expandedTaskIds.has(expandKey);

        const toggle = contentContainer.createDiv('task-card__children-toggle');
        const childrenContainer = contentContainer.createDiv('task-card__children');

        if (wasExpanded) {
            toggle.innerHTML = `<span class="task-card__children-toggle-icon">▼</span> ${label}`;
            toggle.dataset.collapsed = 'false';
            childrenContainer.addClass('task-card__children--expanded');
        } else {
            toggle.innerHTML = `<span class="task-card__children-toggle-icon">▶</span> ${label}`;
            toggle.dataset.collapsed = 'true';
            childrenContainer.addClass('task-card__children--collapsed');
        }

        await this.renderAndPostProcess(childrenContainer, items, filePath, component, parentStartDate);
        this.checkboxWiring.wireChildCheckboxes(childrenContainer, items, settings);

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isCollapsed = toggle.dataset.collapsed === 'true';
            if (isCollapsed) {
                toggle.dataset.collapsed = 'false';
                toggle.innerHTML = `<span class="task-card__children-toggle-icon">▼</span> ${label}`;
                childrenContainer.removeClass('task-card__children--collapsed');
                childrenContainer.addClass('task-card__children--expanded');
                expandedTaskIds.add(expandKey);
            } else {
                toggle.dataset.collapsed = 'true';
                toggle.innerHTML = `<span class="task-card__children-toggle-icon">▶</span> ${label}`;
                childrenContainer.removeClass('task-card__children--expanded');
                childrenContainer.addClass('task-card__children--collapsed');
                expandedTaskIds.delete(expandKey);
            }
        });
    }

    async renderExpanded(
        contentContainer: HTMLElement,
        items: ChildRenderItem[],
        filePath: string,
        component: Component,
        settings: TaskViewerSettings,
        parentStartDate?: string
    ): Promise<void> {
        const childrenContainer = contentContainer.createDiv('task-card__children task-card__children--expanded');
        await this.renderAndPostProcess(childrenContainer, items, filePath, component, parentStartDate);
        this.checkboxWiring.wireChildCheckboxes(childrenContainer, items, settings);
    }

    async renderParentWithChildren(
        contentContainer: HTMLElement,
        parentLine: string,
        items: ChildRenderItem[],
        filePath: string,
        component: Component,
        settings: TaskViewerSettings,
        parentStartDate?: string
    ): Promise<void> {
        const childTexts = items.map((item) => item.markdown);
        const fullText = [parentLine, ...childTexts].join('\n');
        await MarkdownRenderer.render(this.app, fullText, contentContainer, filePath, component);

        // Parent checkbox occupies the first task-list-item, so child mapping starts at offset=1.
        this.insertChildNotations(contentContainer, items, parentStartDate, 1);
        this.checkboxWiring.wireChildCheckboxesWithOffset(contentContainer, items, settings, 1);
    }

    private async renderAndPostProcess(
        container: HTMLElement,
        items: ChildRenderItem[],
        filePath: string,
        component: Component,
        parentStartDate?: string
    ): Promise<void> {
        const markdown = items.map((item) => item.markdown).join('\n');
        await MarkdownRenderer.render(this.app, markdown, container, filePath, component);
        this.insertChildNotations(container, items, parentStartDate, 0);
    }

    private insertChildNotations(
        container: HTMLElement,
        items: ChildRenderItem[],
        parentStartDate?: string,
        checkboxOffset: number = 0
    ): void {
        const taskListItems = container.querySelectorAll('.task-list-item');
        let checkboxIndex = 0;

        for (let i = 0; i < items.length; i++) {
            if (!items[i].isCheckbox) continue;

            const item = items[i];
            const domIndex = checkboxOffset + checkboxIndex;
            checkboxIndex++;

            if (domIndex >= taskListItems.length) continue;

            const handler = item.handler;
            const isTask = handler && handler.type === 'task';

            // For recognized tasks: show ⋯ menu button (if callback set)
            // For plain childLines with notation: show notation text
            let el: HTMLElement;
            if (isTask && this.onChildMenuClick) {
                el = this.createChildMenuButton(handler.taskId);
            } else if (item.notation) {
                el = document.createElement('span');
                el.className = 'task-card__child-notation';
                el.textContent = NotationUtils.formatChildNotation(item.notation, parentStartDate);
            } else {
                continue;
            }

            const targetItem = taskListItems[domIndex] as HTMLElement;
            const notationHost = this.findNotationHost(targetItem);

            if (notationHost !== targetItem) {
                notationHost.appendChild(el);
                continue;
            }

            const nestedBoundary = this.findNestedBoundary(targetItem);
            if (nestedBoundary) {
                targetItem.insertBefore(el, nestedBoundary);
            } else {
                targetItem.appendChild(el);
            }
        }
    }

    private createChildMenuButton(taskId: string): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = 'task-card__child-menu-btn';
        btn.setAttribute('aria-label', 'Task menu');
        btn.setAttribute('tabindex', '-1');

        const span = document.createElement('span');
        btn.appendChild(span);
        setIcon(span, 'more-horizontal');

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rect = btn.getBoundingClientRect();
            this.onChildMenuClick?.(taskId, rect.left, rect.bottom);
        });

        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });

        return btn;
    }

    private findNotationHost(taskListItem: HTMLElement): HTMLElement {
        const hostCandidates = [
            ':scope > .task-list-item-description',
            ':scope > p',
            ':scope > label',
        ];

        for (const selector of hostCandidates) {
            const host = taskListItem.querySelector<HTMLElement>(selector);
            if (host) {
                return host;
            }
        }

        return taskListItem;
    }

    private findNestedBoundary(taskListItem: HTMLElement): HTMLElement | null {
        for (const child of Array.from(taskListItem.children) as HTMLElement[]) {
            if (child.matches('ul, ol')) {
                return child;
            }

            if (child.querySelector('ul, ol')) {
                return child;
            }
        }

        return null;
    }
}
