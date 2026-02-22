import { setIcon } from 'obsidian';
import type { Task } from '../../types';
import type { FilterState, FilterCondition, FilterProperty, FilterOperator } from '../../services/filter/FilterTypes';
import {
    EMPTY_FILTER_STATE,
    PROPERTY_OPERATORS,
    OPERATOR_LABELS,
    PROPERTY_LABELS,
    PROPERTY_ICONS,
    NO_VALUE_OPERATORS,
    createDefaultCondition,
} from '../../services/filter/FilterTypes';
import { TaskFilterEngine } from '../../services/filter/TaskFilterEngine';
import { FilterValueCollector } from '../../services/filter/FilterValueCollector';

export interface FilterMenuCallbacks {
    onFilterChange: () => void;
    getTasks: () => Task[];
    getFileColor: (filePath: string) => string | null;
}

interface SelectItem {
    label: string;
    value: string;
    checked: boolean;
    icon?: string;
}

/**
 * Notion-style row-based filter popover.
 * 5-column grid: [Logic] [Property] [Operator] [Value] [✕]
 */
export class FilterMenuComponent {
    private state: FilterState = { ...EMPTY_FILTER_STATE };
    private popoverEl: HTMLElement | null = null;
    private childPopoverEl: HTMLElement | null = null;
    private childPopoverCleanup: (() => void) | null = null;
    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private lastTasks: Task[] = [];
    private lastCallbacks: FilterMenuCallbacks | null = null;

    getFilterState(): FilterState {
        return this.state;
    }

    setFilterState(state: FilterState): void {
        this.state = state;
    }

    isTaskVisible(task: Task): boolean {
        return TaskFilterEngine.evaluate(task, this.state);
    }

    hasActiveFilters(): boolean {
        return this.state.conditions.length > 0;
    }

    showMenu(event: MouseEvent, callbacks: FilterMenuCallbacks): void {
        this.close();

        this.lastTasks = callbacks.getTasks();
        this.lastCallbacks = callbacks;

        this.popoverEl = document.createElement('div');
        this.popoverEl.className = 'filter-popover';

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

        if (this.state.conditions.length === 0) {
            this.popoverEl.createDiv('filter-popover__empty').setText('No filters applied');
        } else {
            for (let i = 0; i < this.state.conditions.length; i++) {
                this.renderConditionRow(this.popoverEl, this.state.conditions[i], i);
            }
        }

        this.renderAddButton(this.popoverEl);
    }

    private refreshPopover(): void {
        if (!this.popoverEl) return;
        this.renderContent();
        this.lastCallbacks?.onFilterChange();
    }

    // ── Condition Row (5-column grid) ──

    private renderConditionRow(parent: HTMLElement, condition: FilterCondition, index: number): void {
        const row = parent.createDiv('filter-popover__row');

        // Column 1: Logic cell (Where / AND / OR)
        if (index === 0) {
            row.createDiv('filter-popover__logic-cell').setText('Where');
        } else {
            const logicCell = row.createDiv('filter-popover__logic-cell');
            const logicBtn = logicCell.createEl('button', {
                cls: 'filter-popover__logic-btn',
                text: this.state.logic.toUpperCase(),
            });
            logicBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.state.logic = this.state.logic === 'and' ? 'or' : 'and';
                this.refreshPopover();
            });
        }

        // Column 2: Property dropdown (with icon)
        const propBtn = row.createEl('button', {
            cls: 'filter-popover__dropdown',
        });
        const propIcon = propBtn.createSpan('filter-popover__dropdown-icon');
        setIcon(propIcon, PROPERTY_ICONS[condition.property]);
        propBtn.createSpan().setText(PROPERTY_LABELS[condition.property]);
        propBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showPropertyMenu(propBtn, condition);
        });

        // Column 3: Operator dropdown
        const opBtn = row.createEl('button', {
            cls: 'filter-popover__dropdown',
            text: OPERATOR_LABELS[condition.operator],
        });
        opBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showOperatorMenu(opBtn, condition);
        });

        // Column 4: Value selector (depends on property/operator)
        if (NO_VALUE_OPERATORS.has(condition.operator)) {
            // Empty cell to maintain grid layout
            row.createDiv();
        } else {
            this.renderValueSelector(row, condition);
        }

        // Column 5: Delete button
        const deleteBtn = row.createEl('button', { cls: 'filter-popover__delete-btn' });
        setIcon(deleteBtn, 'x');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.state.conditions.splice(index, 1);
            this.refreshPopover();
        });
    }

    // ── Value Selector ──

    private renderValueSelector(row: HTMLElement, condition: FilterCondition): void {
        if (condition.property === 'content') {
            this.renderTextInput(row, condition);
        } else {
            this.renderValueDropdown(row, condition);
        }
    }

    private renderTextInput(row: HTMLElement, condition: FilterCondition): void {
        const input = row.createEl('input', {
            cls: 'filter-popover__text-input',
            type: 'text',
            placeholder: 'Enter text...',
        });
        if (condition.value.type === 'string') {
            input.value = condition.value.value;
        }
        const applyValue = () => {
            condition.value = { type: 'string', value: input.value };
            this.lastCallbacks?.onFilterChange();
        };
        input.addEventListener('change', applyValue);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                applyValue();
                (e.target as HTMLElement).blur();
            }
        });
    }

    private renderValueDropdown(row: HTMLElement, condition: FilterCondition): void {
        const currentValues = condition.value.type === 'stringSet' ? condition.value.values : [];
        const label = currentValues.length > 0
            ? this.formatValueLabel(condition.property, currentValues)
            : 'Select...';

        const btn = row.createEl('button', {
            cls: `filter-popover__dropdown${currentValues.length === 0 ? ' filter-popover__dropdown--placeholder' : ''}`,
            text: label,
        });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showValueMenu(btn, condition);
        });
    }

    private formatValueLabel(property: FilterProperty, values: string[]): string {
        if (values.length === 0) return 'Select...';
        if (values.length === 1) {
            const v = values[0];
            if (property === 'file') return v.split('/').pop() || v;
            if (property === 'tag') return `#${v}`;
            if (property === 'status') return v === ' ' ? 'Todo' : this.getStatusLabel(v);
            return v;
        }
        return `${values.length} selected`;
    }

    // ── Custom Select Popover ──

    private showSelectPopover(
        anchorEl: HTMLElement,
        items: SelectItem[],
        onSelect: (value: string) => void,
        multiSelect = false,
    ): void {
        this.closeChildPopover();

        const popover = document.createElement('div');
        popover.className = 'filter-child-popover';

        if (items.length === 0) {
            popover.createDiv('filter-child-popover__empty').setText('No options available');
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

    // ── Property / Operator / Value Menus ──

    private showPropertyMenu(anchorEl: HTMLElement, condition: FilterCondition): void {
        const properties: FilterProperty[] = ['file', 'tag', 'status', 'content', 'hasStartDate', 'hasDeadline'];
        const items: SelectItem[] = properties.map(p => ({
            label: PROPERTY_LABELS[p],
            value: p,
            checked: condition.property === p,
            icon: PROPERTY_ICONS[p],
        }));

        this.showSelectPopover(anchorEl, items, (val) => {
            const prop = val as FilterProperty;
            condition.property = prop;
            condition.operator = PROPERTY_OPERATORS[prop][0];
            condition.value = NO_VALUE_OPERATORS.has(condition.operator)
                ? { type: 'boolean', value: true }
                : prop === 'content'
                    ? { type: 'string', value: '' }
                    : { type: 'stringSet', values: [] };
            this.refreshPopover();
        });
    }

    private showOperatorMenu(anchorEl: HTMLElement, condition: FilterCondition): void {
        const operators = PROPERTY_OPERATORS[condition.property];
        const items: SelectItem[] = operators.map(op => ({
            label: OPERATOR_LABELS[op],
            value: op,
            checked: condition.operator === op,
        }));

        this.showSelectPopover(anchorEl, items, (val) => {
            condition.operator = val as FilterOperator;
            if (NO_VALUE_OPERATORS.has(condition.operator)) {
                condition.value = { type: 'boolean', value: true };
            }
            this.refreshPopover();
        });
    }

    private showValueMenu(anchorEl: HTMLElement, condition: FilterCondition): void {
        const available = this.getAvailableValues(condition.property);
        const currentValues = condition.value.type === 'stringSet'
            ? new Set(condition.value.values) : new Set<string>();

        const items: SelectItem[] = available.map(val => ({
            label: this.getValueDisplay(condition.property, val),
            value: val,
            checked: currentValues.has(val),
        }));

        this.showSelectPopover(anchorEl, items, (val) => {
            if (currentValues.has(val)) {
                currentValues.delete(val);
            } else {
                currentValues.add(val);
            }
            condition.value = { type: 'stringSet', values: Array.from(currentValues) };
            this.lastCallbacks?.onFilterChange();
        }, true);
    }

    // ── Add Filter ──

    private renderAddButton(parent: HTMLElement): void {
        const btn = parent.createEl('button', { cls: 'filter-popover__add-btn' });
        const iconEl = btn.createSpan();
        setIcon(iconEl, 'plus');
        btn.createSpan().setText('Add filter');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.state.conditions.push(createDefaultCondition());
            this.renderContent();
        });
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

    // ── Helpers ──

    private getAvailableValues(property: FilterProperty): string[] {
        switch (property) {
            case 'file': return FilterValueCollector.collectFiles(this.lastTasks);
            case 'tag': return FilterValueCollector.collectTags(this.lastTasks);
            case 'status': return FilterValueCollector.collectStatuses(this.lastTasks);
            default: return [];
        }
    }

    private getValueDisplay(property: FilterProperty, value: string): string {
        if (property === 'file') return value.split('/').pop() || value;
        if (property === 'tag') return `#${value}`;
        if (property === 'status') {
            return value === ' ' ? '[ ] Todo' : `[${value}] ${this.getStatusLabel(value)}`;
        }
        return value;
    }

    private getStatusLabel(statusChar: string): string {
        switch (statusChar) {
            case ' ': return 'Todo';
            case 'x': case 'X': return 'Done';
            case '-': return 'Cancelled';
            case '!': return 'Exception';
            default: return statusChar;
        }
    }
}
