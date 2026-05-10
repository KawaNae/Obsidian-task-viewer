import { setIcon } from 'obsidian';
import type {
    SortState, SortRule, SortProperty, SortDirection,
} from '../../services/sort/SortTypes';
import {
    createDefaultSortRule,
    createEmptySortState,
    getSortPropertyLabel,
    SORT_PROPERTY_ICONS,
    getSortDirectionLabel,
} from '../../services/sort/SortTypes';
import { t } from '../../i18n';
import { PopoverStack } from '../sharedUI/PopoverStack';
import type { PopoverShell } from '../sharedUI/PopoverShell';

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
    private stack = new PopoverStack();
    private rootEl: HTMLElement | null = null;
    private childShell: PopoverShell | null = null;
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
        this.state = structuredClone(state);
    }

    isOpen(): boolean {
        return this.stack.isOpen();
    }

    showMenuAtElement(anchorEl: HTMLElement, callbacks: SortMenuCallbacks): void {
        this.openWith({ kind: 'element', element: anchorEl }, callbacks);
    }

    showMenu(event: MouseEvent, callbacks: SortMenuCallbacks): void {
        this.openWith({ kind: 'event', event }, callbacks);
    }

    private openWith(
        anchor: { kind: 'element'; element: HTMLElement } | { kind: 'event'; event: MouseEvent },
        callbacks: SortMenuCallbacks,
    ): void {
        this.lastCallbacks = callbacks;
        this.stack.openRoot({
            anchor,
            className: 'sort-popover',
            build: (el) => {
                this.rootEl = el;
                this.renderContent();
            },
            onClose: () => {
                this.rootEl = null;
                this.childShell = null;
            },
        });
    }

    close(): void {
        this.stack.closeAll();
    }

    // ── Render ──

    private renderContent(): void {
        if (!this.rootEl) return;
        this.rootEl.empty();

        const { rules } = this.state;

        if (rules.length === 0) {
            this.rootEl.createDiv('sort-popover__empty').setText(t('sort.noSorts'));
        } else {
            for (let i = 0; i < rules.length; i++) {
                this.renderRuleRow(this.rootEl, rules[i], i);
            }
        }

        this.renderFooter(this.rootEl);
    }

    private refreshPopover(): void {
        if (!this.rootEl) return;
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
        propBtn.createSpan().setText(getSortPropertyLabel(rule.property));
        propBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showPropertyMenu(propBtn, rule);
        });

        // Direction dropdown
        const dirBtn = row.createEl('button', {
            cls: 'sort-popover__dropdown',
            text: getSortDirectionLabel(rule.direction),
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
        addBtn.createSpan().setText(t('sort.addSort'));
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.state.rules.push(createDefaultSortRule());
            this.refreshPopover();
        });

        // Delete sort (only when rules exist)
        if (this.state.rules.length > 0) {
            const deleteBtn = footer.createEl('button', { cls: 'sort-popover__delete-btn' });
            setIcon(deleteBtn.createSpan(), 'trash');
            deleteBtn.createSpan().setText(t('sort.deleteSort'));
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
            'content', 'due', 'startDate', 'endDate', 'file', 'status', 'tag',
        ];
        const items: SelectItem[] = properties.map(p => ({
            label: getSortPropertyLabel(p),
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
            label: getSortDirectionLabel(d),
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
        this.childShell = this.stack.openChild({
            anchor: { kind: 'element', element: anchorEl },
            className: 'filter-child-popover',
            build: (popover) => {
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
                        if (this.childShell) this.stack.close(this.childShell);
                        onSelect(item.value);
                    });
                }
            },
            onClose: () => {
                this.childShell = null;
            },
        });
    }

    // ── Drag Reorder ──

    private startDrag(e: PointerEvent, index: number, rowEl: HTMLElement): void {
        if (this.childShell) this.stack.close(this.childShell);
        this.dragIndex = index;
        this.dragStartY = e.clientY;
        this.dragRowEl = rowEl;
        rowEl.classList.add('is-dragging');

        // Use the row's host document so drag works inside popout windows.
        const hostDoc = rowEl.ownerDocument;

        // Create ghost
        const rect = rowEl.getBoundingClientRect();
        const ghost = rowEl.cloneNode(true) as HTMLElement;
        ghost.className = 'sort-popover__row sort-popover__ghost';
        ghost.style.width = `${rect.width}px`;
        ghost.style.left = `${rect.left}px`;
        ghost.style.top = `${rect.top}px`;
        hostDoc.body.appendChild(ghost);
        this.dragGhostEl = ghost;

        const onMove = (ev: PointerEvent) => this.onDragMove(ev);
        const onUp = () => this.endDrag();
        hostDoc.addEventListener('pointermove', onMove, true);
        hostDoc.addEventListener('pointerup', onUp, true);
        this.dragCleanup = () => {
            hostDoc.removeEventListener('pointermove', onMove, true);
            hostDoc.removeEventListener('pointerup', onUp, true);
        };
    }

    private onDragMove(e: PointerEvent): void {
        if (this.dragGhostEl) {
            const deltaY = e.clientY - this.dragStartY;
            const rect = this.dragRowEl!.getBoundingClientRect();
            this.dragGhostEl.style.top = `${rect.top + deltaY}px`;
        }

        if (!this.rootEl) return;
        const rows = this.rootEl.querySelectorAll<HTMLElement>('.sort-popover__row');

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
            if (this.rootEl) {
                this.rootEl.querySelectorAll('.sort-popover__row').forEach(r => {
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

}
