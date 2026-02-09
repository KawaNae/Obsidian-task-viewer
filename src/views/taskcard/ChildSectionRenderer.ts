import { App, MarkdownRenderer, Component } from 'obsidian';
import { TaskViewerSettings } from '../../types';
import { ChildRenderItem } from './types';
import { CheckboxWiring } from './CheckboxWiring';
import { NotationUtils } from './NotationUtils';

/**
 * Renders child sections from ChildRenderItem[].
 */
export class ChildSectionRenderer {
    constructor(
        private app: App,
        private checkboxWiring: CheckboxWiring
    ) {}

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
        const childTaskCount = items.filter((item) => item.isCheckbox).length;
        const wasExpanded = expandedTaskIds.has(expandKey);

        const toggle = contentContainer.createDiv('task-card__children-toggle');
        const childrenContainer = contentContainer.createDiv('task-card__children');

        if (wasExpanded) {
            toggle.innerHTML = `<span class="task-card__children-toggle-icon">▼</span> ${childTaskCount}件の子タスク`;
            toggle.dataset.collapsed = 'false';
            childrenContainer.addClass('task-card__children--expanded');
        } else {
            toggle.innerHTML = `<span class="task-card__children-toggle-icon">▶</span> ${childTaskCount}件の子タスク`;
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
                toggle.innerHTML = `<span class="task-card__children-toggle-icon">▼</span> ${childTaskCount}件の子タスク`;
                childrenContainer.removeClass('task-card__children--collapsed');
                childrenContainer.addClass('task-card__children--expanded');
                expandedTaskIds.add(expandKey);
            } else {
                toggle.dataset.collapsed = 'true';
                toggle.innerHTML = `<span class="task-card__children-toggle-icon">▶</span> ${childTaskCount}件の子タスク`;
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

            const notation = items[i].notation;
            const domIndex = checkboxOffset + checkboxIndex;
            checkboxIndex++;

            if (!notation || domIndex >= taskListItems.length) continue;

            const span = document.createElement('span');
            span.className = 'task-card__child-notation';
            span.textContent = NotationUtils.formatChildNotation(notation, parentStartDate);

            const targetItem = taskListItems[domIndex];
            const nestedUl = targetItem.querySelector(':scope > ul');
            if (nestedUl) {
                targetItem.insertBefore(span, nestedUl);
            } else {
                targetItem.appendChild(span);
            }
        }
    }
}
