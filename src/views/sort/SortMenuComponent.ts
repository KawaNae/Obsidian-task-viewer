import { setIcon } from 'obsidian';
import type {
    SortState, SortRule, SortProperty, SortDirection,
} from '../../services/sort/SortTypes';
import {
    createDefaultSortRule,
    createEmptySortState,
    SORT_PROPERTY_LABELS,
    SORT_PROPERTY_ICONS,
    SORT_DIRECTION_LABELS,
} from '../../services/sort/SortTypes';

export interface SortMenuCallbacks {
    onSortChange: () => void;
}

interface SelectItem {
    label: string;
    value: string;
    checked: boolean;
    icon?: string;
    cls?: string;
}

/**
 * Notion-style sort popover. Flat list of sort rules (property + direction).
 * Reuses filter-child-popover CSS for dropdown menus.
 */
export class SortMenuComponent {
    private state: SortState = createEmptySortState();
    private popoverEl: HTMLElement | null = null;
    private childPopoverEl: HTMLElement | null = null;
    private childPopoverCleanup: (() => void) | null = null;
    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private lastCallbacks: SortMenuCallbacks | null = null;

    getSortState(): SortState {
        return this.state;
    }

    setSortState(state: SortState): void {
        this.state = JSON.parse(JSON.stringify(state));
    }

    showMenuAtElement(anchorEl: HTMLElement, callbacks: SortMenuCallbacks): void {
        const rect = anchorEl.getBoundingClientRect();
        const syntheticEvent = new MouseEvent('click', { clientX: rect.left, clientY: rect.bottom });
        Object.defineProperty(syntheticEvent, 'pageX', { value: rect.left + window.scrollX });
        Object.defineProperty(syntheticEvent, 'pageY', { value: rect.bottom + window.scrollY });
        this.showMenu(syntheticEvent, callbacks);
    }

    showMenu(event: MouseEvent, callbacks: SortMenuCallbacks): void {
        this.close();

        this.lastCallbacks = callbacks;

        this.popoverEl = document.createElement('div');
        this.popoverEl.className = 'sort-popover';

        this.renderContent();

        document.body.appendChild(this.popoverEl);
        this.positionPopover(event);

        setTimeout(() => {
            this.outsideClickHandler = (e: MouseEvent) => {
                const target = e.target as Node;
                if (!this.popoverEl) return;
                if (this.popoverEl.contains(target)) return;
                if ((target as HTMLElement).closest?.('.filter-child-popover')) return;
                this.close();
            };
            document.addEventListener('pointerdown', this.outsideClickHandler, true);
        }, 0);
    }

    close(): void {
        this.closeChildPopover();
        if (this.popoverEl) {
            this.popoverEl.remove();
            this.popoverEl = null;
        }
        if (this.outsideClickHandler) {
            document.removeEventListener('pointerdown', this.outsideClickHandler, true);
            this.outsideClickHandler = null;
        }
    }

    private closeChildPopover(): void {
        if (this.childPopoverEl) {
            this.childPopoverEl.remove();
            this.childPopoverEl = null;
        }
        if (this.childPopoverCleanup) {
            this.childPopoverCleanup();
            this.childPopoverCleanup = null;
        }
    }

    // ── Render ──

    private renderContent(): void {
        if (!this.popoverEl) return;
        this.popoverEl.empty();

        const { rules } = this.state;

        if (rules.length === 0) {
            this.popoverEl.createDiv('sort-popover__empty').setText('No sorts applied');
        } else {
            for (let i = 0; i < rules.length; i++) {
                this.renderRuleRow(this.popoverEl, rules[i], i);
            }
        }

        this.renderFooter(this.popoverEl);
    }

    private refreshPopover(): void {
        if (!this.popoverEl) return;
        this.renderContent();
        this.lastCallbacks?.onSortChange();
    }

    // ── Rule Row ──

    private renderRuleRow(parent: HTMLElement, rule: SortRule, index: number): void {
        const row = parent.createDiv('sort-popover__row');

        // Drag handle (visual only for v1)
        const handle = row.createSpan('sort-popover__drag-handle');
        setIcon(handle, 'grip-vertical');

        // Property dropdown
        const propBtn = row.createEl('button', { cls: 'sort-popover__dropdown' });
        const propIcon = propBtn.createSpan('sort-popover__dropdown-icon');
        setIcon(propIcon, SORT_PROPERTY_ICONS[rule.property]);
        propBtn.createSpan().setText(SORT_PROPERTY_LABELS[rule.property]);
        propBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showPropertyMenu(propBtn, rule);
        });

        // Direction dropdown
        const dirBtn = row.createEl('button', {
            cls: 'sort-popover__dropdown',
            text: SORT_DIRECTION_LABELS[rule.direction],
        });
        dirBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showDirectionMenu(dirBtn, rule);
        });

        // Remove button (×)
        const removeBtn = row.createEl('button', { cls: 'sort-popover__remove-btn' });
        setIcon(removeBtn, 'x');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.state.rules.splice(index, 1);
            this.refreshPopover();
        });
    }

    // ── Footer ──

    private renderFooter(parent: HTMLElement): void {
        const footer = parent.createDiv('sort-popover__footer');

        // + Add sort
        const addBtn = footer.createEl('button', { cls: 'sort-popover__add-btn' });
        setIcon(addBtn.createSpan(), 'plus');
        addBtn.createSpan().setText('Add sort');
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.state.rules.push(createDefaultSortRule());
            this.refreshPopover();
        });

        // Delete sort (only when rules exist)
        if (this.state.rules.length > 0) {
            const deleteBtn = footer.createEl('button', { cls: 'sort-popover__delete-btn' });
            setIcon(deleteBtn.createSpan(), 'trash');
            deleteBtn.createSpan().setText('Delete sort');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.state.rules = [];
                this.refreshPopover();
            });
        }
    }

    // ── Property / Direction Menus ──

    private showPropertyMenu(anchorEl: HTMLElement, rule: SortRule): void {
        const properties: SortProperty[] = [
            'content', 'deadline', 'startDate', 'endDate', 'file', 'status', 'tag',
        ];
        const items: SelectItem[] = properties.map(p => ({
            label: SORT_PROPERTY_LABELS[p],
            value: p,
            checked: rule.property === p,
            icon: SORT_PROPERTY_ICONS[p],
        }));

        this.showSelectPopover(anchorEl, items, (val) => {
            rule.property = val as SortProperty;
            this.refreshPopover();
        });
    }

    private showDirectionMenu(anchorEl: HTMLElement, rule: SortRule): void {
        const directions: SortDirection[] = ['asc', 'desc'];
        const items: SelectItem[] = directions.map(d => ({
            label: SORT_DIRECTION_LABELS[d],
            value: d,
            checked: rule.direction === d,
        }));

        this.showSelectPopover(anchorEl, items, (val) => {
            rule.direction = val as SortDirection;
            this.refreshPopover();
        });
    }

    // ── Select Popover (reuses filter-child-popover CSS) ──

    private showSelectPopover(
        anchorEl: HTMLElement,
        items: SelectItem[],
        onSelect: (value: string) => void,
    ): void {
        this.closeChildPopover();

        const popover = document.createElement('div');
        popover.className = 'filter-child-popover';

        for (const item of items) {
            const row = popover.createDiv(
                `filter-child-popover__item${item.checked ? ' filter-child-popover__item--selected' : ''}`,
            );

            if (item.cls) row.classList.add(item.cls);

            if (item.icon) {
                const iconEl = row.createSpan('filter-child-popover__icon');
                setIcon(iconEl, item.icon);
            }

            row.createSpan('filter-child-popover__label').setText(item.label);

            row.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeChildPopover();
                onSelect(item.value);
            });
        }

        document.body.appendChild(popover);
        this.childPopoverEl = popover;

        // Position below anchor
        const anchorRect = anchorEl.getBoundingClientRect();
        let x = anchorRect.left;
        let y = anchorRect.bottom + 4;
        const popRect = popover.getBoundingClientRect();
        if (x + popRect.width > window.innerWidth) {
            x = window.innerWidth - popRect.width - 8;
        }
        if (y + popRect.height > window.innerHeight) {
            y = anchorRect.top - popRect.height - 4;
        }
        popover.style.left = `${Math.max(8, x)}px`;
        popover.style.top = `${Math.max(8, y)}px`;

        const handler = (e: MouseEvent) => {
            const target = e.target as Node;
            if (popover.contains(target)) return;
            this.closeChildPopover();
        };
        setTimeout(() => {
            document.addEventListener('pointerdown', handler, true);
        }, 0);
        this.childPopoverCleanup = () => {
            document.removeEventListener('pointerdown', handler, true);
        };
    }

    // ── Positioning ──

    private positionPopover(event: MouseEvent): void {
        if (!this.popoverEl) return;
        const rect = this.popoverEl.getBoundingClientRect();
        let x = event.pageX;
        let y = event.pageY;

        if (x + rect.width > window.innerWidth) {
            x = window.innerWidth - rect.width - 8;
        }
        if (y + rect.height > window.innerHeight) {
            y = window.innerHeight - rect.height - 8;
        }

        this.popoverEl.style.left = `${Math.max(8, x)}px`;
        this.popoverEl.style.top = `${Math.max(8, y)}px`;
    }
}
