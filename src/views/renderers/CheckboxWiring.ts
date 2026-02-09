import { App, Menu, Notice, TFile } from 'obsidian';
import { Task, TaskViewerSettings } from '../../types';
import { TaskIndex } from '../../services/core/TaskIndex';
import { ChildRenderItem, CheckboxHandler } from './ChildItemBuilder';

/**
 * チェックボックスのイベントバインドを統一的に処理する。
 * task/childLine 両タイプのハンドラー、コンテキストメニュー、data-task 同期を含む。
 */
export class CheckboxWiring {
    constructor(
        private app: App,
        private taskIndex: TaskIndex
    ) {}

    /**
     * ChildRenderItem[] に基づいてコンテナ内の全チェックボックスにイベントをバインドする。
     * isCheckbox=true のアイテムのみ .task-list-item の input[type="checkbox"] にマッピング。
     */
    wireChildCheckboxes(
        container: HTMLElement,
        items: ChildRenderItem[],
        settings: TaskViewerSettings
    ): void {
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        let cbIndex = 0;

        for (let i = 0; i < items.length; i++) {
            if (!items[i].isCheckbox) continue;
            if (cbIndex >= checkboxes.length) break;

            const checkbox = checkboxes[cbIndex];
            const handler = items[i].handler;
            cbIndex++;

            if (!handler) continue;

            if (handler.type === 'task') {
                this.wireTaskCheckbox(checkbox, handler.taskId, settings);
            } else {
                this.wireChildLineCheckbox(checkbox, handler.parentTask, handler.childLineIndex, settings);
            }
        }
    }

    /**
     * 親タスクのチェックボックスにイベントをバインドする。
     */
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

        if (settings.applyGlobalStyles) {
            checkbox.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showCheckboxStatusMenu(e as MouseEvent, taskId);
            });
            checkbox.addEventListener('touchstart', (e) => e.stopPropagation());
        }
    }

    /**
     * 親チェックボックスをスキップして子チェックボックスにイベントをバインドする。
     * non-collapsed inline パス用（親+子が同一コンテナで描画される場合）。
     */
    wireChildCheckboxesWithOffset(
        container: HTMLElement,
        items: ChildRenderItem[],
        settings: TaskViewerSettings,
        checkboxOffset: number
    ): void {
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        let cbIndex = 0;
        for (let i = 0; i < items.length; i++) {
            if (!items[i].isCheckbox) continue;
            const domIdx = checkboxOffset + cbIndex;
            cbIndex++;
            if (domIdx >= checkboxes.length) break;

            const checkbox = checkboxes[domIdx];
            const handler = items[i].handler;
            if (!handler) continue;

            if (handler.type === 'task') {
                this.wireTaskCheckbox(checkbox, handler.taskId, settings);
            } else {
                this.wireChildLineCheckbox(checkbox, handler.parentTask, handler.childLineIndex, settings);
            }
        }
    }

    // --- Private ---

    private wireTaskCheckbox(checkbox: Element, taskId: string, settings: TaskViewerSettings): void {
        checkbox.addEventListener('click', () => {
            const isChecked = (checkbox as HTMLInputElement).checked;
            const newStatusChar = isChecked ? 'x' : ' ';
            this.updateCheckboxDataTask(checkbox as HTMLElement, newStatusChar);
            this.taskIndex.updateTask(taskId, { statusChar: newStatusChar });
        });
        checkbox.addEventListener('pointerdown', (e) => e.stopPropagation());

        if (settings.applyGlobalStyles) {
            checkbox.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showCheckboxStatusMenu(e as MouseEvent, taskId);
            });
            checkbox.addEventListener('touchstart', (e) => e.stopPropagation());
        }
    }

    private wireChildLineCheckbox(
        checkbox: Element,
        task: Task,
        childLineIndex: number,
        settings: TaskViewerSettings
    ): void {
        checkbox.addEventListener('click', () => {
            if (childLineIndex < task.childLines.length) {
                let childLine = task.childLines[childLineIndex];
                const match = childLine.match(/\[(.)\]/);
                if (match) {
                    const currentChar = match[1];
                    const newChar = currentChar === ' ' ? 'x' : ' ';
                    childLine = childLine.replace(`[${currentChar}]`, `[${newChar}]`);
                    this.updateCheckboxDataTask(checkbox as HTMLElement, newChar);
                }

                const absoluteLineNumber = this.calculateChildLineNumber(task, childLineIndex);
                if (absoluteLineNumber === -1) {
                    console.warn('[CheckboxWiring] 子タスクの行番号を特定できませんでした');
                    new Notice('子タスクの行番号を特定できませんでした。ファイル内で直接編集してください。');
                    return;
                }

                this.taskIndex.updateLine(task.file, absoluteLineNumber, childLine);
            }
        });
        checkbox.addEventListener('pointerdown', (e) => e.stopPropagation());

        if (settings.applyGlobalStyles) {
            checkbox.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showChildCheckboxStatusMenu(e as MouseEvent, task, childLineIndex);
            });
            checkbox.addEventListener('touchstart', (e) => e.stopPropagation());
        }
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

    private showCheckboxStatusMenu(e: MouseEvent, taskId: string): void {
        const menu = new Menu();
        const statusOptions = [
            { char: 'x', label: '[x]' },
            { char: '!', label: '[!]' },
            { char: '?', label: '[?]' },
            { char: '>', label: '[>]' },
            { char: '-', label: '[-]' },
            { char: ' ', label: '[ ]' },
        ];

        for (const opt of statusOptions) {
            menu.addItem((item) => {
                item.setTitle(opt.label)
                    .onClick(async () => {
                        await this.taskIndex.updateTask(taskId, { statusChar: opt.char });
                    });
            });
        }

        menu.showAtPosition({ x: e.pageX, y: e.pageY });
    }

    private showChildCheckboxStatusMenu(e: MouseEvent, task: Task, childLineIndex: number): void {
        const menu = new Menu();
        const targetEl = e.target as HTMLElement | null;
        const statusOptions = [
            { char: 'x', label: '[x]' },
            { char: '!', label: '[!]' },
            { char: '?', label: '[?]' },
            { char: '>', label: '[>]' },
            { char: '-', label: '[-]' },
            { char: ' ', label: '[ ]' },
        ];

        for (const opt of statusOptions) {
            menu.addItem((item) => {
                item.setTitle(opt.label)
                    .onClick(async () => {
                        if (childLineIndex < task.childLines.length) {
                            let childLine = task.childLines[childLineIndex];
                            childLine = childLine.replace(/\[(.)\]/, `[${opt.char}]`);
                            if (targetEl) {
                                this.updateCheckboxDataTask(targetEl, opt.char);
                            }

                            const absoluteLineNumber = this.calculateChildLineNumber(task, childLineIndex);
                            if (absoluteLineNumber === -1) {
                                console.warn('[CheckboxWiring] 子タスクの行番号を計算できません');
                                new Notice('子タスクの行番号を特定できませんでした');
                                return;
                            }

                            await this.taskIndex.updateLine(task.file, absoluteLineNumber, childLine);
                        }
                    });
            });
        }

        menu.showAtPosition({ x: e.pageX, y: e.pageY });
    }

    private calculateChildLineNumber(task: Task, childLineIndex: number): number {
        if (task.parserId === 'frontmatter') {
            const fmEndLine = this.getFrontmatterEndLine(task.file);
            if (fmEndLine === -1) return -1;
            const bodyOffset = task.childLineBodyOffsets[childLineIndex];
            if (bodyOffset === undefined) return -1;
            return fmEndLine + 1 + bodyOffset;
        } else {
            return task.line + 1 + childLineIndex;
        }
    }

    private getFrontmatterEndLine(filePath: string): number {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return -1;
        const cache = this.app.metadataCache.getFileCache(file);
        return cache?.frontmatterPosition?.end?.line ?? -1;
    }
}
