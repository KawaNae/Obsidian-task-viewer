/**
 * Fixed status options that always appear in menus.
 */
export const FIXED_STATUS_OPTIONS: StatusOption[] = [
    { char: ' ', label: '' },
    { char: 'x', label: 'x' },
];

export interface StatusOption {
    readonly char: string;
    readonly label: string;
}

/**
 * Build the full status options list from fixed options + user-configured chars.
 * Filters out duplicates of fixed chars (' ' and 'x').
 */
export function buildStatusOptions(customChars: string[]): StatusOption[] {
    const custom = customChars
        .filter(c => c.length === 1 && c !== ' ' && c !== 'x')
        .map(c => ({ char: c, label: c }));
    return [...FIXED_STATUS_OPTIONS, ...custom];
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
