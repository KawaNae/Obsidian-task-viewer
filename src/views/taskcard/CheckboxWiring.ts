import type { TaskViewerSettings } from '../../types';
import type { Operations } from '../../services/operations/Operations';
import type { MenuPresenter } from '../../interaction/menu/MenuPresenter';
import type { ChildRenderItem } from './types';
import { buildStatusOptions, createStatusTitle } from '../../constants/statusOptions';
import { touchCard } from './CardHold';

/**
 * Wires checkbox interactions for parent and child items.
 *
 * Every checkbox, parent or child, is a task and is wired the same: a click
 * writes through updateTask, and the box shows the status it writes from the
 * click on (`markStatus`), until the card is drawn from the file again; a
 * write not made puts the box back. A box is kept while its card shows the same thing, across readings of the
 * file that rename its task, so a handler never holds the name: it asks for
 * it when it writes (`CardHold`).
 */
export class CheckboxWiring {
    constructor(
        private operations: Operations,
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
        this.wireTaskCheckbox(checkbox, nameOf, settings);
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
            this.wireTaskCheckbox(checkbox, () => nameAt(index), settings);
        }
    }

    private wireTaskCheckbox(
        checkbox: Element,
        nameOf: () => string | undefined,
        settings: TaskViewerSettings
    ): void {
        checkbox.addEventListener('click', () => {
            // The click has turned the tick already; the marks still show the
            // status the box had.
            touchCard(checkbox);
            const input = checkbox as HTMLInputElement;
            const before = lookOf(input, !input.checked);
            const statusChar = input.checked ? 'x' : ' ';
            markStatus(input, statusChar);
            const name = nameOf();
            if (name === undefined) {
                putBack(input, before);
                return;
            }
            void this.operations.updateTask(name, { statusChar }).then(({ written }) => {
                if (!written) putBack(input, before);
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
                await this.operations.updateTask(name, { statusChar });
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
}

/**
 * What a box shows of its task's status: its tick, and the `data-task` of the
 * elements the stylesheet reads a status from, the box's own and its list
 * item's (`_checkboxes.css`). Obsidian's markdown puts it on the item only.
 */
interface BoxLook {
    checked: boolean;
    marks: { el: Element; task: string | null }[];
}

/** The elements that mark the status of `input`. */
function markersOf(input: HTMLInputElement): Element[] {
    const item = input.closest('li');
    return item ? [input, item] : [input];
}

/** What `input` shows, its tick taken as `checked`. */
function lookOf(input: HTMLInputElement, checked: boolean): BoxLook {
    return { checked, marks: markersOf(input).map(el => ({ el, task: el.getAttribute('data-task') })) };
}

/**
 * Mark the status a click writes on the box, ahead of the write, so the box
 * is drawn as that status at once: a tick alone would be drawn as Obsidian's
 * checked box until the card is drawn from the file again.
 */
function markStatus(input: HTMLInputElement, statusChar: string): void {
    for (const el of markersOf(input)) {
        if (statusChar === ' ') el.removeAttribute('data-task');
        else el.setAttribute('data-task', statusChar);
    }
}

/**
 * Undo what a click did to the box when its write was not made. The index
 * has put its copy back and the user has been told why; a card that is drawn
 * again from the copy replaces this element anyway, but one that is not would
 * keep showing a status the file does not hold.
 */
function putBack(input: HTMLInputElement, look: BoxLook): void {
    if (!input.isConnected) return;
    input.checked = look.checked;
    for (const { el, task } of look.marks) {
        if (task === null) el.removeAttribute('data-task');
        else el.setAttribute('data-task', task);
    }
}
