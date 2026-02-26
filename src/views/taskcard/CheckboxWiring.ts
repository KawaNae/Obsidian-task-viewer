import { App, Menu, Notice, TFile } from 'obsidian';
import { Task, TaskViewerSettings } from '../../types';
import { TaskIndex } from '../../services/core/TaskIndex';
import { ChildRenderItem } from './types';
import { buildStatusOptions, createStatusTitle } from '../../constants/statusOptions';

/**
 * Wires checkbox interactions for parent and child items.
 */
export class CheckboxWiring {
    constructor(
        private app: App,
        private taskIndex: TaskIndex
    ) {}

    wireChildCheckboxes(
        container: HTMLElement,
        items: ChildRenderItem[],
        settings: TaskViewerSettings
    ): void {
        this.wireChildCheckboxesWithOffset(container, items, settings, 0);
    }

    wireParentCheckbox(
        checkbox: Element,
        taskId: string,
        settings: TaskViewerSettings
    ): void {
        checkbox.addEventListener('click', () => {
            const isChecked = (checkbox as HTMLInputElement).checked;
            const newStatusChar = isChecked ? 'x' : ' ';
            this.taskIndex.updateTask(taskId, { statusChar: newStatusChar });
        });
        checkbox.addEventListener('pointerdown', (e) => e.stopPropagation());

        if (!settings.enableStatusMenu) return;

        checkbox.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showStatusMenu(e as MouseEvent, settings, async (statusChar) => {
                await this.taskIndex.updateTask(taskId, { statusChar });
            });
        });
        checkbox.addEventListener('touchstart', (e) => e.stopPropagation());
    }

    /**
     * Wires child checkboxes when parent checkbox occupies index 0 in DOM.
     */
    wireChildCheckboxesWithOffset(
        container: HTMLElement,
        items: ChildRenderItem[],
        settings: TaskViewerSettings,
        checkboxOffset: number
    ): void {
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        let checkboxIndex = 0;

        for (let i = 0; i < items.length; i++) {
            if (!items[i].isCheckbox) continue;

            const domIndex = checkboxOffset + checkboxIndex;
            checkboxIndex++;
            if (domIndex >= checkboxes.length) break;

            const checkbox = checkboxes[domIndex];
            const handler = items[i].handler;
            if (!handler) continue;

            if (handler.type === 'task') {
                this.wireTaskCheckbox(checkbox, handler.taskId, settings);
            } else {
                this.wireChildLineCheckbox(checkbox, handler.parentTask, handler.childLineIndex, settings);
            }
        }
    }

    private wireTaskCheckbox(
        checkbox: Element,
        taskId: string,
        settings: TaskViewerSettings
    ): void {
        checkbox.addEventListener('click', () => {
            const isChecked = (checkbox as HTMLInputElement).checked;
            const newStatusChar = isChecked ? 'x' : ' ';
            this.updateCheckboxDataTask(checkbox as HTMLElement, newStatusChar);
            this.taskIndex.updateTask(taskId, { statusChar: newStatusChar });
        });
        checkbox.addEventListener('pointerdown', (e) => e.stopPropagation());

        if (!settings.enableStatusMenu) return;

        checkbox.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showStatusMenu(e as MouseEvent, settings, async (statusChar) => {
                await this.taskIndex.updateTask(taskId, { statusChar });
            });
        });
        checkbox.addEventListener('touchstart', (e) => e.stopPropagation());
    }

    private wireChildLineCheckbox(
        checkbox: Element,
        task: Task,
        childLineIndex: number,
        settings: TaskViewerSettings
    ): void {
        checkbox.addEventListener('click', async () => {
            if (childLineIndex >= task.childLines.length) return;

            let childLine = task.childLines[childLineIndex];
            const match = childLine.match(/\[(.)\]/);
            if (!match) return;

            const currentChar = match[1];
            const newChar = currentChar === ' ' ? 'x' : ' ';
            childLine = childLine.replace(`[${currentChar}]`, `[${newChar}]`);
            this.updateCheckboxDataTask(checkbox as HTMLElement, newChar);

            const absoluteLineNumber = this.resolveChildLineNumber(task, childLineIndex);
            if (absoluteLineNumber === -1) {
                console.warn('[CheckboxWiring] Failed to resolve child task line number.');
                new Notice('子タスクの行番号を特定できませんでした。ファイルを開いて再実行してください。');
                return;
            }

            await this.taskIndex.updateLine(task.file, absoluteLineNumber, childLine);
        });
        checkbox.addEventListener('pointerdown', (e) => e.stopPropagation());

        if (!settings.enableStatusMenu) return;

        checkbox.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const targetEl = e.target as HTMLElement | null;
            this.showStatusMenu(e as MouseEvent, settings, async (statusChar) => {
                if (childLineIndex >= task.childLines.length) return;

                let childLine = task.childLines[childLineIndex];
                childLine = childLine.replace(/\[(.)\]/, `[${statusChar}]`);
                if (targetEl) {
                    this.updateCheckboxDataTask(targetEl, statusChar);
                }

                const absoluteLineNumber = this.resolveChildLineNumber(task, childLineIndex);
                if (absoluteLineNumber === -1) {
                    console.warn('[CheckboxWiring] Failed to resolve child task line number for status update.');
                    new Notice('子タスクの行番号を特定できませんでした。');
                    return;
                }

                await this.taskIndex.updateLine(task.file, absoluteLineNumber, childLine);
            });
        });
        checkbox.addEventListener('touchstart', (e) => e.stopPropagation());
    }

    private showStatusMenu(e: MouseEvent, settings: TaskViewerSettings, onSelect: (statusChar: string) => Promise<void>): void {
        const menu = new Menu();
        const options = buildStatusOptions(settings.statusMenuChars);

        for (const option of options) {
            menu.addItem((item) => {
                item
                    .setTitle(createStatusTitle(option))
                    .onClick(async () => {
                        await onSelect(option.char);
                    });
            });
        }

        menu.showAtPosition({ x: e.pageX, y: e.pageY });
    }

    private updateCheckboxDataTask(el: HTMLElement, newChar: string): void {
        const value = newChar === ' ' ? '' : newChar;
        const input = el.matches('input.task-list-item-checkbox')
            ? el
            : (el.closest('input.task-list-item-checkbox') as HTMLElement | null);
        const listItem = el.closest('li');

        if (input) {
            if (value) {
                input.setAttribute('data-task', value);
            } else {
                input.removeAttribute('data-task');
            }
        }

        if (listItem) {
            if (value) {
                listItem.setAttribute('data-task', value);
            } else {
                listItem.removeAttribute('data-task');
            }
        }
    }

    private resolveChildLineNumber(task: Task, childLineIndex: number): number {
        if (task.parserId === 'frontmatter') {
            const bodyOffset = task.childLineBodyOffsets[childLineIndex];
            if (bodyOffset === undefined) return -1;

            const fmEndLine = this.getFrontmatterEndLine(task.file);
            // New frontmatter parser stores absolute lines. Keep legacy fallback for old offsets.
            if (fmEndLine !== -1 && bodyOffset <= fmEndLine) {
                return fmEndLine + 1 + bodyOffset;
            }
            return bodyOffset;
        }

        return task.line + 1 + childLineIndex;
    }

    private getFrontmatterEndLine(filePath: string): number {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return -1;
        const cache = this.app.metadataCache.getFileCache(file);
        return cache?.frontmatterPosition?.end?.line ?? -1;
    }
}