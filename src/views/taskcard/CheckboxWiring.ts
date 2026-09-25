import type { TaskViewerSettings } from '../../types';
import type { TaskWriteService } from '../../services/data/TaskWriteService';
import type { MenuPresenter } from '../../interaction/menu/MenuPresenter';
import type { ChildRenderItem } from './types';
import { buildStatusOptions, createStatusTitle } from '../../constants/statusOptions';
import { touchCard } from './CardHold';

/**
 * Wires checkbox interactions for parent and child items.
 *
 * Every checkbox, parent or child, is a task and writes through updateTask.
 * A box is kept while its card shows the same thing, across readings of the
 * file that rename its task, so a handler never holds the name: it asks for
 * it when it writes (`CardHold`).
 */
export class CheckboxWiring {
    constructor(
        private writeService: TaskWriteService,
        private menuPresenter: MenuPresenter
    ) {}

    /**
     * @param nameAt the name behind the item at an index of `items`, asked
     *   when a box is used
     */
    wireChildCheckboxes(
        container: HTMLElement,
        items: ChildRenderItem[],
        settings: TaskViewerSettings,
        nameAt: (index: number) => string | undefined
    ): void {
        this.wireChildCheckboxesWithOffset(container, items, settings, 0, nameAt);
    }

    /** @param nameOf the name of the card's task, asked when the box is used */
    wireParentCheckbox(
        checkbox: Element,
        nameOf: () => string,
        settings: TaskViewerSettings,
        readOnly = false
    ): void {
        if (readOnly) return;
        this.wireTaskCheckbox(checkbox, nameOf, settings, false);
    }

    /**
     * Wires child checkboxes when parent checkbox occupies index 0 in DOM.
     */
    wireChildCheckboxesWithOffset(
        container: HTMLElement,
        items: ChildRenderItem[],
        settings: TaskViewerSettings,
        checkboxOffset: number,
        nameAt: (index: number) => string | undefined
    ): void {
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        let checkboxIndex = 0;

        for (let i = 0; i < items.length; i++) {
            if (!items[i].isCheckbox) continue;

            const domIndex = checkboxOffset + checkboxIndex;
            checkboxIndex++;
            if (domIndex >= checkboxes.length) break;

            const checkbox = checkboxes[domIndex];
            if (!items[i].handler) continue;

            const index = i;
            this.wireTaskCheckbox(checkbox, () => nameAt(index), settings, true);
        }
    }

    /**
     * @param child whether the box is a child item's, whose `data-task` the
     *   click sets ahead of the write (a parent box's is drawn from the task)
     */
    private wireTaskCheckbox(
        checkbox: Element,
        nameOf: () => string | undefined,
        settings: TaskViewerSettings,
        child: boolean
    ): void {
        checkbox.addEventListener('click', () => {
            // The click has changed the box already.
            touchCard(checkbox);
            const input = checkbox as HTMLInputElement;
            const isChecked = input.checked;
            const newStatusChar = isChecked ? 'x' : ' ';
            const previousChar = child ? (input.getAttribute('data-task') ?? ' ') : null;
            if (child) this.updateCheckboxDataTask(input, newStatusChar);
            const name = nameOf();
            if (name === undefined) {
                this.putBack(input, !isChecked, previousChar);
                return;
            }
            void this.writeService.updateTask(name, { statusChar: newStatusChar }).then(written => {
                if (!written) this.putBack(input, !isChecked, previousChar);
            });
        });
        checkbox.addEventListener('pointerdown', (e) => e.stopPropagation());

        if (!settings.enableStatusMenu) return;

        checkbox.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showStatusMenu(e as MouseEvent, settings, async (statusChar) => {
                const name = nameOf();
                if (name === undefined) return;
                await this.writeService.updateTask(name, { statusChar });
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

    /**
     * Undo what a click did to the box when its write was not made. The index
     * has put its copy back and the user has been told why; a card that
     * re-renders from the copy replaces this element anyway, but one that does
     * not would keep showing a status the file does not hold.
     */
    private putBack(input: HTMLInputElement, checked: boolean, dataTask: string | null): void {
        if (!input.isConnected) return;
        input.checked = checked;
        if (dataTask !== null) this.updateCheckboxDataTask(input, dataTask);
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
