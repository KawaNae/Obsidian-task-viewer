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
import type { PopoverStack } from '../sharedUI/PopoverStack';
import type { PopoverShell } from '../sharedUI/PopoverShell';

export interface SelectItem {
    label: string;
    value: string;
    checked: boolean;
    icon?: string;
    cls?: string;
}

export class FilterDropdownMenus {
    private childShell: PopoverShell | null = null;

    constructor(
        private refreshPopover: () => void,
        private renderContent: () => void,
        private getStatusDefs: () => StatusDefinition[],
        private getLastTasks: () => Task[],
        private getOnFilterChange: () => (() => void) | undefined,
        private getStack: () => PopoverStack,
    ) {}

    showSelectPopover(
        anchorEl: HTMLElement,
        items: SelectItem[],
        onSelect: (value: string) => void,
        multiSelect = false,
    ): void {
        const stack = this.getStack();
        this.childShell = stack.openChild({
            anchor: { kind: 'element', element: anchorEl },
            className: 'filter-child-popover',
            build: (popover) => {
                if (items.length === 0) {
                    popover.createDiv('filter-child-popover__empty').setText(t('filter.noOptions'));
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
                            // Single-select: close child popover then commit.
                            if (this.childShell) stack.close(this.childShell);
                            onSelect(item.value);
                        }
                    });
                }
            },
            onClose: () => {
                this.childShell = null;
                if (multiSelect) {
                    this.renderContent();
                }
            },
        });
    }

    showPropertyMenu(anchorEl: HTMLElement, condition: FilterCondition): void {
        const properties: FilterProperty[] = [
            'file', 'tag', 'status', 'content',
            'startDate', 'endDate', 'due', 'anyDate',
            'length', 'color', 'linestyle', 'kind', 'notation',
            'parent', 'children', 'property',
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
            } else if (prop === 'content' || prop === 'property') {
                condition.value = '';
            } else {
                condition.value = [];
            }
            if (prop === 'property') {
                condition.key = '';
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
