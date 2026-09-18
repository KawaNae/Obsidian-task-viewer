import type { TaskViewerSettings } from '../../types';
import type { TaskWriteService } from '../../services/data/TaskWriteService';
import type { MenuPresenter } from '../../interaction/menu/MenuPresenter';
import type { ChildRenderItem } from './types';
import { buildStatusOptions, createStatusTitle } from '../../constants/statusOptions';

/**
 * Wires checkbox interactions for parent and child items.
 *
 * Every checkbox, parent or child, is a task and writes through updateTask.
 */
export class CheckboxWiring {
    constructor(
        private writeService: TaskWriteService,
        private menuPresenter: MenuPresenter
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
        settings: TaskViewerSettings,
        readOnly = false
    ): void {
        if (readOnly) return;
        checkbox.addEventListener('click', () => {
            const isChecked = (checkbox as HTMLInputElement).checked;
            const newStatusChar = isChecked ? 'x' : ' ';
            this.writeService.updateTask(taskId, { statusChar: newStatusChar });
        });
        checkbox.addEventListener('pointerdown', (e) => e.stopPropagation());

        if (!settings.enableStatusMenu) return;

        checkbox.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showStatusMenu(e as MouseEvent, settings, async (statusChar) => {
                await this.writeService.updateTask(taskId, { statusChar });
            });
        });
        checkbox.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
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

            this.wireTaskCheckbox(checkbox, handler.taskId, settings);
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
            this.writeService.updateTask(taskId, { statusChar: newStatusChar });
        });
        checkbox.addEventListener('pointerdown', (e) => e.stopPropagation());

        if (!settings.enableStatusMenu) return;

        checkbox.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showStatusMenu(e as MouseEvent, settings, async (statusChar) => {
                await this.writeService.updateTask(taskId, { statusChar });
            });
        });
        checkbox.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    }

    private showStatusMenu(e: MouseEvent, settings: TaskViewerSettings, onSelect: (statusChar: string) => Promise<void>): void {
        const options = buildStatusOptions(settings.statusDefinitions);

        this.menuPresenter.present((menu) => {
            for (const option of options) {
                menu.addItem((item) => {
                    item
                        .setTitle(createStatusTitle(option))
                        .onClick(async () => {
                            await onSelect(option.char);
                        });
                });
            }
        }, { kind: 'position', x: e.pageX, y: e.pageY });
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

}
