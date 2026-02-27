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

    // Drag state
    private dragIndex: number | null = null;
    private dragOverIndex: number | null = null;
    private dragRowEl: HTMLElement | null = null;
    private dragGhostEl: HTMLElement | null = null;
    private dragStartY = 0;
    private dragCleanup: (() => void) | null = null;

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
        row.dataset.index = String(index);

        // Drag handle
        const handle = row.createSpan('sort-popover__drag-handle');
        setIcon(handle, 'grip-vertical');
        handle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.startDrag(e, index, row);
        });

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

    // ── Drag Reorder ──

    private startDrag(e: PointerEvent, index: number, rowEl: HTMLElement): void {
        this.closeChildPopover();
        this.dragIndex = index;
        this.dragStartY = e.clientY;
        this.dragRowEl = rowEl;
        rowEl.classList.add('is-dragging');

        // Create ghost
        const rect = rowEl.getBoundingClientRect();
        const ghost = rowEl.cloneNode(true) as HTMLElement;
        ghost.className = 'sort-popover__row sort-popover__ghost';
        ghost.style.width = `${rect.width}px`;
        ghost.style.left = `${rect.left}px`;
        ghost.style.top = `${rect.top}px`;
        document.body.appendChild(ghost);
        this.dragGhostEl = ghost;

        const onMove = (ev: PointerEvent) => this.onDragMove(ev);
        const onUp = () => this.endDrag();
        document.addEventListener('pointermove', onMove, true);
        document.addEventListener('pointerup', onUp, true);
        this.dragCleanup = () => {
            document.removeEventListener('pointermove', onMove, true);
            document.removeEventListener('pointerup', onUp, true);
        };
    }

    private onDragMove(e: PointerEvent): void {
        if (this.dragGhostEl) {
            const deltaY = e.clientY - this.dragStartY;
            const rect = this.dragRowEl!.getBoundingClientRect();
            this.dragGhostEl.style.top = `${rect.top + deltaY}px`;
        }

        if (!this.popoverEl) return;
        const rows = this.popoverEl.querySelectorAll<HTMLElement>('.sort-popover__row');

        // Clear previous indicators
        rows.forEach(r => {
            r.classList.remove('is-drag-over-above', 'is-drag-over-below');
        });

        // Find target index
        let newOverIndex: number | null = null;
        for (const row of Array.from(rows)) {
            const idx = Number(row.dataset.index);
            if (idx === this.dragIndex) continue;
            const rowRect = row.getBoundingClientRect();
            const midY = rowRect.top + rowRect.height / 2;
            if (e.clientY < midY) {
                row.classList.add('is-drag-over-above');
                newOverIndex = idx;
                break;
            } else {
                // Tentatively mark as below; may be overridden by next row
                newOverIndex = idx + 1;
                row.classList.add('is-drag-over-below');
            }
        }

        // Only keep the last "below" indicator
        if (newOverIndex !== null) {
            rows.forEach(r => {
                const idx = Number(r.dataset.index);
                if (r.classList.contains('is-drag-over-below') && idx + 1 !== newOverIndex) {
                    r.classList.remove('is-drag-over-below');
                }
            });
        }

        this.dragOverIndex = newOverIndex;
    }

    private endDrag(): void {
        // Perform reorder
        if (
            this.dragIndex !== null &&
            this.dragOverIndex !== null &&
            this.dragIndex !== this.dragOverIndex
        ) {
            const rules = this.state.rules;
            const [moved] = rules.splice(this.dragIndex, 1);
            const insertAt = this.dragOverIndex > this.dragIndex
                ? this.dragOverIndex - 1
                : this.dragOverIndex;
            rules.splice(insertAt, 0, moved);
            this.refreshPopover();
        } else {
            // Clean up visual state without re-render
            if (this.dragRowEl) {
                this.dragRowEl.classList.remove('is-dragging');
            }
            if (this.popoverEl) {
                this.popoverEl.querySelectorAll('.sort-popover__row').forEach(r => {
                    r.classList.remove('is-drag-over-above', 'is-drag-over-below');
                });
            }
        }

        // Remove ghost
        if (this.dragGhostEl) {
            this.dragGhostEl.remove();
            this.dragGhostEl = null;
        }

        // Remove listeners
        if (this.dragCleanup) {
            this.dragCleanup();
            this.dragCleanup = null;
        }

        this.dragIndex = null;
        this.dragOverIndex = null;
        this.dragRowEl = null;
        this.dragStartY = 0;
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
