import { setIcon } from 'obsidian';
import type {
    FilterCondition, FilterProperty, FilterOperator,
    DateFilterValue, RelativeDatePreset, FilterTarget,
} from '../../services/filter/FilterTypes';
import {
    PROPERTY_OPERATORS,
    getOperatorLabel,
    getPropertyLabel,
    PROPERTY_ICONS,
    NO_VALUE_OPERATORS,
    DATE_PROPERTIES,
    NUMBER_PROPERTIES,
    getRelativeDateLabel,
} from '../../services/filter/FilterTypes';
import type { StatusDefinition, Task } from '../../types';
import { getAvailableValues, getValueDisplay } from './FilterValueHelpers';
import { t } from '../../i18n';

export interface SelectItem {
    label: string;
    value: string;
    checked: boolean;
    icon?: string;
    cls?: string;
}

export class FilterDropdownMenus {
    private childPopoverEl: HTMLElement | null = null;
    private childPopoverCleanup: (() => void) | null = null;

    constructor(
        private refreshPopover: () => void,
        private renderContent: () => void,
        private getStatusDefs: () => StatusDefinition[],
        private getLastTasks: () => Task[],
        private getOnFilterChange: () => (() => void) | undefined,
    ) {}

    closeChildPopover(): void {
        if (this.childPopoverEl) {
            this.childPopoverEl.remove();
            this.childPopoverEl = null;
        }
        if (this.childPopoverCleanup) {
            this.childPopoverCleanup();
            this.childPopoverCleanup = null;
        }
    }

    showSelectPopover(
        anchorEl: HTMLElement,
        items: SelectItem[],
        onSelect: (value: string) => void,
        multiSelect = false,
    ): void {
        this.closeChildPopover();

        const popover = document.createElement('div');
        popover.className = 'filter-child-popover';

        if (items.length === 0) {
            popover.createDiv('filter-child-popover__empty').setText(t('filter.noOptions'));
        } else {
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
                        this.closeChildPopover();
                        onSelect(item.value);
                    }
                });
            }
        }

        document.body.appendChild(popover);
        this.childPopoverEl = popover;

        // Position below the anchor element
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
            if (multiSelect) {
                this.renderContent();
            }
        };
        setTimeout(() => {
            document.addEventListener('pointerdown', handler, true);
        }, 0);
        this.childPopoverCleanup = () => {
            document.removeEventListener('pointerdown', handler, true);
        };
    }

    showPropertyMenu(anchorEl: HTMLElement, condition: FilterCondition): void {
        const properties: FilterProperty[] = [
            'file', 'tag', 'status', 'content',
            'startDate', 'endDate', 'due', 'undated',
            'length', 'color', 'linestyle', 'taskType',
            'parent', 'children',
        ];
        const items: SelectItem[] = properties.map(p => ({
            label: getPropertyLabel(p),
            value: p,
            checked: condition.property === p,
            icon: PROPERTY_ICONS[p],
        }));

        this.showSelectPopover(anchorEl, items, (val) => {
            const prop = val as FilterProperty;
            condition.property = prop;
            condition.operator = PROPERTY_OPERATORS[prop][0];
            // Reset value-related fields
            delete condition.key;
            delete condition.unit;
            if (NO_VALUE_OPERATORS.has(condition.operator)) {
                condition.value = undefined;
            } else if (DATE_PROPERTIES.has(prop)) {
                condition.value = { preset: 'today' } as DateFilterValue;
            } else if (NUMBER_PROPERTIES.has(prop)) {
                condition.value = 1;
                condition.unit = 'hours';
            } else if (prop === 'content') {
                condition.value = '';
            } else {
                condition.value = [];
            }
            this.refreshPopover();
        });
    }

    showOperatorMenu(anchorEl: HTMLElement, condition: FilterCondition): void {
        const operators = PROPERTY_OPERATORS[condition.property];
        const items: SelectItem[] = operators.map(op => ({
            label: getOperatorLabel(condition.property, op),
            value: op,
            checked: condition.operator === op,
        }));

        this.showSelectPopover(anchorEl, items, (val) => {
            condition.operator = val as FilterOperator;
            if (NO_VALUE_OPERATORS.has(condition.operator)) {
                condition.value = undefined;
            }
            this.refreshPopover();
        });
    }

    showTargetMenu(anchorEl: HTMLElement, condition: FilterCondition): void {
        const targets: { label: string; value: FilterTarget; icon: string }[] = [
            { label: t('filter.self'), value: 'self', icon: 'user' },
            { label: t('filter.parent'), value: 'parent', icon: 'arrow-up' },
        ];
        const items: SelectItem[] = targets.map(tgt => ({
            label: tgt.label,
            value: tgt.value,
            checked: (condition.target ?? 'self') === tgt.value,
            icon: tgt.icon,
        }));

        this.showSelectPopover(anchorEl, items, (val) => {
            const target = val as FilterTarget;
            condition.target = target === 'self' ? undefined : target;
            this.refreshPopover();
        });
    }

    showValueMenu(anchorEl: HTMLElement, condition: FilterCondition): void {
        const available = getAvailableValues(condition.property, this.getLastTasks());
        const currentValues = new Set(Array.isArray(condition.value) ? condition.value as string[] : []);
        const statusDefs = this.getStatusDefs();

        const items: SelectItem[] = available.map(val => ({
            label: getValueDisplay(condition.property, val, statusDefs),
            value: val,
            checked: currentValues.has(val),
        }));

        this.showSelectPopover(anchorEl, items, (val) => {
            if (currentValues.has(val)) {
                currentValues.delete(val);
            } else {
                currentValues.add(val);
            }
            condition.value = Array.from(currentValues);
            this.getOnFilterChange()?.();
        }, true);
    }
}
