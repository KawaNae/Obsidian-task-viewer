import { App, MarkdownRenderer, Component } from 'obsidian';
import { TaskViewerSettings } from '../../types';
import { ChildRenderItem } from './ChildItemBuilder';
import { CheckboxWiring } from './CheckboxWiring';
import { NotationUtils } from './NotationUtils';

/**
 * ChildRenderItem[] → DOM 描画。
 * collapsed（トグルボタン付き）/ expanded（直接表示）の統一描画パイプライン。
 */
export class ChildSectionRenderer {
    constructor(
        private app: App,
        private checkboxWiring: CheckboxWiring
    ) {}

    /**
     * Collapsed モード: トグルボタン + 折りたたみ可能なコンテナ。
     */
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
        const childTaskCount = items.filter(i => i.isCheckbox).length;
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

    /**
     * Expanded モード: トグルなしで直接表示。
     */
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

    /**
     * 親行 + 子行を一括で MarkdownRenderer に渡す（non-collapsed inline パス用）。
     * 親のチェックボックスは呼び出し側で別途バインドする。
     */
    async renderParentWithChildren(
        contentContainer: HTMLElement,
        parentLine: string,
        items: ChildRenderItem[],
        filePath: string,
        component: Component,
        settings: TaskViewerSettings,
        parentStartDate?: string
    ): Promise<void> {
        const childTexts = items.map(i => i.markdown);
        const fullText = [parentLine, ...childTexts].join('\n');
        await MarkdownRenderer.render(this.app, fullText, contentContainer, filePath, component);

        // notation 注入: allTaskListItems[0] は親、[1..] が子
        const allTaskListItems = contentContainer.querySelectorAll('.task-list-item');
        let cbIndex = 0;
        for (let i = 0; i < items.length; i++) {
            if (!items[i].isCheckbox) continue;
            cbIndex++;
            const notation = items[i].notation;
            if (!notation || !allTaskListItems[cbIndex]) continue;
            const span = document.createElement('span');
            span.className = 'task-card__child-notation';
            span.textContent = NotationUtils.formatChildNotation(notation, parentStartDate);
            const nestedUl = allTaskListItems[cbIndex].querySelector(':scope > ul');
            if (nestedUl) {
                allTaskListItems[cbIndex].insertBefore(span, nestedUl);
            } else {
                allTaskListItems[cbIndex].appendChild(span);
            }
        }

        // 子チェックボックスのバインド: index 0 = 親（呼び出し側で処理）をスキップ
        this.checkboxWiring.wireChildCheckboxesWithOffset(contentContainer, items, settings, 1);
    }

    // --- Private ---

    private async renderAndPostProcess(
        container: HTMLElement,
        items: ChildRenderItem[],
        filePath: string,
        component: Component,
        parentStartDate?: string
    ): Promise<void> {
        const markdown = items.map(i => i.markdown).join('\n');
        await MarkdownRenderer.render(this.app, markdown, container, filePath, component);

        const taskListItems = container.querySelectorAll('.task-list-item');
        let cbIndex = 0;
        for (let i = 0; i < items.length; i++) {
            if (!items[i].isCheckbox) continue;
            if (cbIndex >= taskListItems.length) break;
            const notation = items[i].notation;
            if (notation) {
                const span = document.createElement('span');
                span.className = 'task-card__child-notation';
                span.textContent = NotationUtils.formatChildNotation(notation, parentStartDate);
                const nestedUl = taskListItems[cbIndex].querySelector(':scope > ul');
                if (nestedUl) {
                    taskListItems[cbIndex].insertBefore(span, nestedUl);
                } else {
                    taskListItems[cbIndex].appendChild(span);
                }
            }
            cbIndex++;
        }
    }

}
