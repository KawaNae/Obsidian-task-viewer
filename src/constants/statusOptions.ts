import type { Menu } from 'obsidian';
import type { StatusDefinition } from '../types';

export interface StatusOption {
    readonly char: string;
    readonly label: string;
}

/**
 * Build the full status options list from status definitions.
 */
export function buildStatusOptions(defs: StatusDefinition[]): StatusOption[] {
    return defs.map(d => ({ char: d.char, label: d.label }));
}

/**
 * Get the label for a status character from definitions.
 */
export function getStatusLabel(char: string, defs: StatusDefinition[]): string {
    return defs.find(d => d.char === char)?.label || char;
}

/**
 * Create a DocumentFragment with a checkbox preview + label for use in Menu.setTitle().
 * Renders an actual checkbox input element so CSS styles (data-task) are applied.
 */
export function createStatusTitle(option: StatusOption): DocumentFragment {
    const frag = document.createDocumentFragment();
    const container = document.createElement('span');
    container.style.display = 'inline-flex';
    container.style.alignItems = 'center';
    container.style.gap = '6px';

    // Checkbox preview element
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.classList.add('task-list-item-checkbox');
    checkbox.checked = option.char !== ' ';
    checkbox.readOnly = true;
    checkbox.tabIndex = -1;
    checkbox.style.pointerEvents = 'none';
    if (option.char !== ' ') {
        checkbox.setAttribute('data-task', option.char);
    }

    container.appendChild(checkbox);

    // Label text (use non-breaking space for empty to keep alignment)
    const label = document.createElement('span');
    label.textContent = option.label || '\u00A0';
    container.appendChild(label);
    frag.appendChild(container);
    return frag;
}

/**
 * The statuses as a menu's items, the one `current` checked: what a card's
 * menu (its Status submenu), the editor's checkbox menu and the hub's
 * status button show, each item a checkbox preview and its label
 * ({@link createStatusTitle}). With Obsidian's native menus on, the items
 * are their labels alone.
 */
export function addStatusItems(menu: Menu, defs: StatusDefinition[], current: string, pick: (char: string) => void): void {
    for (const option of buildStatusOptions(defs)) {
        menu.addItem(item => {
            item.setTitle(createStatusTitle(option))
                .setChecked(current === option.char)
                .onClick(() => pick(option.char));
        });
    }
}
