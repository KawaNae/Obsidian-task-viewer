import { setIcon } from 'obsidian';
import type { PopoverShell } from './PopoverShell';
import type { PopoverStack } from './PopoverStack';

export interface SelectItem {
    label: string;
    value: string;
    checked: boolean;
    icon?: string;
    cls?: string;
}

export interface SelectPopoverOptions {
    /** Checkbox rows that toggle without closing, instead of click-to-commit-and-close. */
    multiSelect?: boolean;
    /** Shown instead of the row list when `items` is empty. Omit to render nothing. */
    emptyLabel?: string;
    onClose?: () => void;
}

/**
 * Row-list select popover, opened as a child of `stack` anchored on
 * `anchorEl`. Shared by FilterDropdownMenus (property/operator/target/value
 * dropdowns) and SortMenuComponent (property/direction dropdowns) — both
 * want the same `filter-child-popover` row rendering and click/checkbox
 * behavior, differing only in whether multiple rows may be checked at once
 * and what to show for an empty list.
 */
export function openSelectPopover(
    stack: PopoverStack,
    anchorEl: HTMLElement,
    items: SelectItem[],
    onSelect: (value: string) => void,
    options: SelectPopoverOptions = {},
): PopoverShell {
    const { multiSelect = false, emptyLabel, onClose } = options;
    let shell: PopoverShell | undefined;

    shell = stack.openChild({
        anchor: { kind: 'element', element: anchorEl },
        className: 'filter-child-popover',
        build: (popover) => {
            if (items.length === 0) {
                if (emptyLabel) popover.createDiv('filter-child-popover__empty').setText(emptyLabel);
                return;
            }
            for (const item of items) {
                const row = popover.createDiv(
                    `filter-child-popover__item${item.checked && !multiSelect ? ' filter-child-popover__item--selected' : ''}`,
                );

                if (multiSelect) {
                    const checkbox = row.createEl('input', { type: 'checkbox' });
                    checkbox.checked = item.checked;
                    checkbox.classList.add('filter-child-popover__checkbox');
                }

                if (item.cls) row.classList.add(item.cls);

                if (item.icon) {
                    const iconEl = row.createSpan('filter-child-popover__icon');
                    setIcon(iconEl, item.icon);
                }

                row.createSpan('filter-child-popover__label').setText(item.label);

                row.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (multiSelect) {
                        item.checked = !item.checked;
                        const cb = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
                        if (cb) cb.checked = item.checked;
                        onSelect(item.value);
                    } else {
                        // Single-select: close the child popover then commit.
                        if (shell) stack.close(shell);
                        onSelect(item.value);
                    }
                });
            }
        },
        onClose: () => onClose?.(),
    });

    return shell;
}
