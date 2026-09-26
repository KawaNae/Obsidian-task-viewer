import { type App, MarkdownRenderer, type Component, setIcon } from 'obsidian';
import { type TaskViewerSettings, isCompleteStatusChar } from '../../types';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { ChildRenderItem } from './types';
import type { CheckboxWiring } from './CheckboxWiring';
import { NotationUtils } from './NotationUtils';
import { touchCard } from './CardHold';
import { t } from '../../i18n';

export type ChildMenuCallback = (taskId: string, x: number, y: number) => void;

function countChildCompletion(
    items: ChildRenderItem[],
    readService: TaskReadService,
    settings: TaskViewerSettings
): { completed: number; total: number } {
    let completed = 0;
    let total = 0;
    for (const item of items) {
        if (!item.isCheckbox || !item.handler) continue;
        total++;
        const child = readService.getTask(item.handler.taskId);
        if (child && isCompleteStatusChar(child.statusChar, settings.statusDefinitions)) {
            completed++;
        }
    }
    return { completed, total };
}

/**
 * Renders child sections from ChildRenderItem[].
 *
 * What a drawn section binds asks for names when it is used, not when it is
 * drawn: the section is kept while it shows the same items, across readings
 * that rename the tasks behind them (`CardHold`). `nameAt(i)` answers the
 * name behind `items[i]`.
 */
export class ChildSectionRenderer {
    private onChildMenuClick: ChildMenuCallback | null = null;

    constructor(
        private app: App,
        private checkboxWiring: CheckboxWiring,
        private readService: TaskReadService
    ) {}

    setChildMenuCallback(cb: ChildMenuCallback): void {
        this.onChildMenuClick = cb;
    }

    async renderCollapsed(
        contentContainer: HTMLElement,
        items: ChildRenderItem[],
        nameAt: (index: number) => string | undefined,
        expandedTaskIds: Set<string>,
        expandKey: () => string,
        filePath: string,
        component: Component,
        settings: TaskViewerSettings,
        parentStartDate?: string,
        warnIcon = ''
    ): Promise<void> {
        const { completed, total } = countChildCompletion(items, this.readService, settings);
        const label = `${warnIcon}${completed}/${total}`;
        const wasExpanded = expandedTaskIds.has(expandKey());

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

        await this.renderAndPostProcess(childrenContainer, items, nameAt, filePath, component, parentStartDate);
        this.checkboxWiring.wireChildCheckboxes(childrenContainer, items, settings, nameAt);

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            touchCard(toggle);
            const isCollapsed = toggle.dataset.collapsed === 'true';
            if (isCollapsed) {
                toggle.dataset.collapsed = 'false';
                toggle.innerHTML = `<span class="task-card__children-toggle-icon">▼</span> ${label}`;
                childrenContainer.removeClass('task-card__children--collapsed');
                childrenContainer.addClass('task-card__children--expanded');
                expandedTaskIds.add(expandKey());
            } else {
                toggle.dataset.collapsed = 'true';
                toggle.innerHTML = `<span class="task-card__children-toggle-icon">▶</span> ${label}`;
                childrenContainer.removeClass('task-card__children--expanded');
                childrenContainer.addClass('task-card__children--collapsed');
                expandedTaskIds.delete(expandKey());
            }
        });
    }

    async renderExpanded(
        contentContainer: HTMLElement,
        items: ChildRenderItem[],
        nameAt: (index: number) => string | undefined,
        filePath: string,
        component: Component,
        settings: TaskViewerSettings,
        parentStartDate?: string
    ): Promise<void> {
        const childrenContainer = contentContainer.createDiv('task-card__children task-card__children--expanded');
        await this.renderAndPostProcess(childrenContainer, items, nameAt, filePath, component, parentStartDate);
        this.checkboxWiring.wireChildCheckboxes(childrenContainer, items, settings, nameAt);
    }

    async renderParentWithChildren(
        contentContainer: HTMLElement,
        parentLine: string,
        items: ChildRenderItem[],
        nameAt: (index: number) => string | undefined,
        filePath: string,
        component: Component,
        settings: TaskViewerSettings,
        parentStartDate?: string
    ): Promise<void> {
        const childTexts = items.map((item) => item.markdown);
        const fullText = [parentLine, ...childTexts].join('\n');
        await MarkdownRenderer.render(this.app, fullText, contentContainer, filePath, component);

        // Parent checkbox occupies the first task-list-item, so child mapping starts at offset=1.
        this.insertChildNotations(contentContainer, items, nameAt, parentStartDate, 1);
        this.checkboxWiring.wireChildCheckboxesWithOffset(contentContainer, items, settings, 1, nameAt);
    }

    private async renderAndPostProcess(
        container: HTMLElement,
        items: ChildRenderItem[],
        nameAt: (index: number) => string | undefined,
        filePath: string,
        component: Component,
        parentStartDate?: string
    ): Promise<void> {
        const markdown = items.map((item) => item.markdown).join('\n');
        await MarkdownRenderer.render(this.app, markdown, container, filePath, component);
        this.insertChildNotations(container, items, nameAt, parentStartDate, 0);
        this.markPropertyLines(container, items);
    }

    private insertChildNotations(
        container: HTMLElement,
        items: ChildRenderItem[],
        nameAt: (index: number) => string | undefined,
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

            // For tasks: show ⋯ menu button (if callback set)
            // For items with notation: show notation text
            let el: HTMLElement;
            if (isTask && this.onChildMenuClick) {
                const index = i;
                el = this.createChildMenuButton(() => nameAt(index));
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

    private createChildMenuButton(nameOf: () => string | undefined): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = 'task-card__child-menu-btn';
        btn.setAttribute('aria-label', t('aria.taskMenu'));
        btn.setAttribute('tabindex', '-1');

        const span = document.createElement('span');
        btn.appendChild(span);
        setIcon(span, 'more-horizontal');

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const name = nameOf();
            if (name === undefined) return;
            const rect = btn.getBoundingClientRect();
            this.onChildMenuClick?.(name, rect.left, rect.bottom);
        });

        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });

        return btn;
    }

    /**
     * Add CSS class to rendered list items that represent key-value properties.
     * Non-checkbox items render as plain <li> (without .task-list-item).
     */
    private markPropertyLines(container: HTMLElement, items: ChildRenderItem[]): void {
        const allLis = container.querySelectorAll<HTMLElement>('li:not(.task-list-item)');
        let liIdx = 0;
        for (const item of items) {
            if (item.isCheckbox) continue; // checkbox items are .task-list-item, skip
            if (liIdx >= allLis.length) break;
            if (item.propertyKey) {
                allLis[liIdx].dataset.propertyKey = item.propertyKey;
            }
            liIdx++;
        }
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
