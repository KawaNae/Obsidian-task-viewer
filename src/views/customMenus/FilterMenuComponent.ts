import { setIcon } from 'obsidian';
import type { Task } from '../../types';
import type {
    FilterState, FilterConditionNode, FilterGroupNode, FilterNode,
    FilterProperty, FilterOperator, DateFilterValue, RelativeDatePreset,
} from '../../services/filter/FilterTypes';
import {
    MAX_FILTER_DEPTH,
    PROPERTY_OPERATORS,
    OPERATOR_LABELS,
    PROPERTY_LABELS,
    PROPERTY_ICONS,
    NO_VALUE_OPERATORS,
    DATE_PROPERTIES,
    RELATIVE_DATE_LABELS,
    createDefaultCondition,
    createEmptyFilterState,
    createFilterGroup,
    deepCloneNode,
    hasConditions,
} from '../../services/filter/FilterTypes';
import { TaskFilterEngine } from '../../services/filter/TaskFilterEngine';
import { FilterValueCollector } from '../../services/filter/FilterValueCollector';

export interface FilterMenuCallbacks {
    onFilterChange: () => void;
    getTasks: () => Task[];
}

interface SelectItem {
    label: string;
    value: string;
    checked: boolean;
    icon?: string;
    cls?: string;
}

/**
 * Notion-style filter popover with recursive group nesting.
 * Groups can contain both conditions and sub-groups up to MAX_FILTER_DEPTH levels.
 */
export class FilterMenuComponent {
    private state: FilterState = createEmptyFilterState();
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
        this.state = JSON.parse(JSON.stringify(state));
    }

    isTaskVisible(task: Task): boolean {
        return TaskFilterEngine.evaluate(task, this.state);
    }

    hasActiveFilters(): boolean {
        return hasConditions(this.state);
    }

    showMenuAtElement(anchorEl: HTMLElement, callbacks: FilterMenuCallbacks): void {
        const rect = anchorEl.getBoundingClientRect();
        const syntheticEvent = new MouseEvent('click', { clientX: rect.left, clientY: rect.bottom });
        Object.defineProperty(syntheticEvent, 'pageX', { value: rect.left + window.scrollX });
        Object.defineProperty(syntheticEvent, 'pageY', { value: rect.bottom + window.scrollY });
        this.showMenu(syntheticEvent, callbacks);
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

        const root = this.state.root;

        if (root.children.length === 0) {
            this.popoverEl.createDiv('filter-popover__empty').setText('No filters applied');
        } else {
            this.renderChildren(this.popoverEl, root, 0);
        }

        this.renderFooterButtons(this.popoverEl, root, 0);
    }

    private refreshPopover(): void {
        if (!this.popoverEl) return;
        this.renderContent();
        this.lastCallbacks?.onFilterChange();
    }

    // ── Recursive Children Rendering ──

    private renderChildren(parent: HTMLElement, group: FilterGroupNode, depth: number): void {
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];

            // Inter-sibling logic separator (between nodes, not before the first)
            if (i > 0) {
                this.renderLogicSeparator(parent, group, depth);
            }

            if (child.type === 'condition') {
                this.renderConditionRow(parent, group, child, i);
            } else {
                this.renderGroup(parent, child, depth + 1, group, i);
            }
        }
    }

    // ── Logic Separator ──

    private renderLogicSeparator(parent: HTMLElement, group: FilterGroupNode, _depth: number): void {
        const logicRow = parent.createDiv('filter-popover__logic-separator');
        const logicBtn = logicRow.createEl('button', {
            cls: 'filter-popover__logic-btn',
            text: group.logic.toUpperCase(),
        });
        logicBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            group.logic = group.logic === 'and' ? 'or' : 'and';
            this.refreshPopover();
        });
    }

    // ── Group Rendering (recursive) ──

    private renderGroup(
        parent: HTMLElement,
        group: FilterGroupNode,
        depth: number,
        parentGroup: FilterGroupNode,
        indexInParent: number,
    ): void {
        const groupEl = parent.createDiv('filter-popover__group');

        // Group body with visual accent border and depth-based indentation
        const groupBody = groupEl.createDiv('filter-popover__group-body');
        groupBody.style.setProperty('--depth', String(depth));

        // Render children recursively
        this.renderChildren(groupBody, group, depth);

        // Group footer: [+ Add filter] [+ Add group] [...]
        const groupFooter = groupBody.createDiv('filter-popover__group-footer');

        // Add filter button
        const addBtn = groupFooter.createEl('button', { cls: 'filter-popover__add-btn filter-popover__add-btn--inline' });
        setIcon(addBtn.createSpan(), 'plus');
        addBtn.createSpan().setText('Add filter');
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            group.children.push(createDefaultCondition());
            this.refreshPopover();
        });

        // Add sub-group button (only if depth allows)
        if (depth < MAX_FILTER_DEPTH - 1) {
            const addGroupBtn = groupFooter.createEl('button', { cls: 'filter-popover__add-btn filter-popover__add-btn--inline' });
            setIcon(addGroupBtn.createSpan(), 'plus-square');
            addGroupBtn.createSpan().setText('Add group');
            addGroupBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const newGroup = createFilterGroup();
                newGroup.children.push(createDefaultCondition());
                group.children.push(newGroup);
                this.refreshPopover();
            });
        }

        // Group more menu (...) — only when parent has multiple children
        if (parentGroup.children.length > 1) {
            const groupMoreBtn = groupFooter.createEl('button', { cls: 'filter-popover__more-btn' });
            setIcon(groupMoreBtn, 'more-horizontal');
            groupMoreBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const items: SelectItem[] = [
                    { label: 'Duplicate group', value: 'duplicate-group', checked: false, icon: 'copy' },
                    { label: 'Ungroup', value: 'ungroup', checked: false, icon: 'unfold-horizontal' },
                    { label: 'Remove group', value: 'remove-group', checked: false, icon: 'trash', cls: 'filter-child-popover__item--danger' },
                ];
                this.showSelectPopover(groupMoreBtn, items, (val) => {
                    if (val === 'remove-group') {
                        parentGroup.children.splice(indexInParent, 1);
                        this.refreshPopover();
                    } else if (val === 'duplicate-group') {
                        const dup = deepCloneNode(group) as FilterGroupNode;
                        parentGroup.children.splice(indexInParent + 1, 0, dup);
                        this.refreshPopover();
                    } else if (val === 'ungroup') {
                        // Move all children of this group into the parent
                        parentGroup.children.splice(indexInParent, 1, ...group.children);
                        this.refreshPopover();
                    }
                });
            });
        }
    }

    // ── Condition Row (2-row layout: header + value) ──

    private renderConditionRow(
        parent: HTMLElement,
        ownerGroup: FilterGroupNode,
        condition: FilterConditionNode,
        indexInGroup: number,
    ): void {
        const row = parent.createDiv('filter-popover__row');

        // ── Upper row: [Property] [Operator] [...] ──
        const headerLine = row.createDiv('filter-popover__row-header');

        // Property dropdown (with icon)
        const propBtn = headerLine.createEl('button', { cls: 'filter-popover__dropdown' });
        const propIcon = propBtn.createSpan('filter-popover__dropdown-icon');
        setIcon(propIcon, PROPERTY_ICONS[condition.property]);
        propBtn.createSpan().setText(PROPERTY_LABELS[condition.property]);
        propBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showPropertyMenu(propBtn, condition);
        });

        // Operator dropdown
        const opBtn = headerLine.createEl('button', {
            cls: 'filter-popover__dropdown',
            text: OPERATOR_LABELS[condition.operator],
        });
        opBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showOperatorMenu(opBtn, condition);
        });

        // More menu button (...) — condition-level actions
        const moreBtn = headerLine.createEl('button', { cls: 'filter-popover__more-btn' });
        setIcon(moreBtn, 'more-horizontal');
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const items: SelectItem[] = [
                { label: 'Duplicate', value: 'duplicate', checked: false, icon: 'copy' },
                { label: 'Remove', value: 'remove', checked: false, icon: 'trash', cls: 'filter-child-popover__item--danger' },
            ];
            this.showSelectPopover(moreBtn, items, (val) => {
                if (val === 'remove') {
                    ownerGroup.children.splice(indexInGroup, 1);
                    this.refreshPopover();
                } else if (val === 'duplicate') {
                    const dup = deepCloneNode(condition) as FilterConditionNode;
                    ownerGroup.children.splice(indexInGroup + 1, 0, dup);
                    this.refreshPopover();
                }
            });
        });

        // ── Lower row: Value (only when operator requires a value) ──
        if (!NO_VALUE_OPERATORS.has(condition.operator)) {
            const valueLine = row.createDiv('filter-popover__row-value');
            if (DATE_PROPERTIES.has(condition.property)) {
                this.renderDateValueSelector(valueLine, condition);
            } else {
                this.renderValueSelector(valueLine, condition);
            }
        }
    }

    // ── Value Selector ──

    private renderValueSelector(row: HTMLElement, condition: FilterConditionNode): void {
        if (condition.property === 'content') {
            this.renderTextInput(row, condition);
        } else {
            this.renderValueDropdown(row, condition);
        }
    }

    private renderTextInput(row: HTMLElement, condition: FilterConditionNode): void {
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

    private renderValueDropdown(row: HTMLElement, condition: FilterConditionNode): void {
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

    // ── Date Value Selector ──

    private renderDateValueSelector(row: HTMLElement, condition: FilterConditionNode): void {
        const container = row.createDiv('filter-popover__date-value');

        // Initialize value if needed
        if (condition.value.type !== 'date') {
            condition.value = { type: 'date', value: { mode: 'relative', preset: 'today' } };
        }

        const dateVal = condition.value.value as DateFilterValue;

        // Mode toggle button: "Relative" / "Absolute"
        const modeBtn = container.createEl('button', {
            cls: 'filter-popover__dropdown filter-popover__date-mode-btn',
            text: dateVal.mode === 'relative' ? 'Relative' : 'Absolute',
        });
        modeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (dateVal.mode === 'relative') {
                condition.value = { type: 'date', value: { mode: 'absolute', date: this.getToday() } };
            } else {
                condition.value = { type: 'date', value: { mode: 'relative', preset: 'today' } };
            }
            this.refreshPopover();
        });

        if (dateVal.mode === 'relative') {
            // Relative preset dropdown
            const presetBtn = container.createEl('button', {
                cls: 'filter-popover__dropdown',
                text: dateVal.preset === 'nextNDays'
                    ? `Next ${dateVal.n ?? 7} days`
                    : RELATIVE_DATE_LABELS[dateVal.preset],
            });
            presetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showRelativeDateMenu(presetBtn, condition);
            });

            // Number input for nextNDays
            if (dateVal.preset === 'nextNDays') {
                const nInput = container.createEl('input', {
                    cls: 'filter-popover__n-input',
                    type: 'number',
                });
                nInput.value = String(dateVal.n ?? 7);
                nInput.min = '1';
                nInput.placeholder = 'N';
                nInput.addEventListener('change', () => {
                    const n = parseInt(nInput.value, 10);
                    if (n > 0) {
                        condition.value = { type: 'date', value: { mode: 'relative', preset: 'nextNDays', n } };
                        this.lastCallbacks?.onFilterChange();
                    }
                });
            }
        } else {
            // Absolute date: native date input
            const dateInput = container.createEl('input', {
                cls: 'filter-popover__date-input',
                type: 'date',
            });
            dateInput.value = dateVal.date || this.getToday();
            dateInput.addEventListener('change', () => {
                condition.value = { type: 'date', value: { mode: 'absolute', date: dateInput.value } };
                this.lastCallbacks?.onFilterChange();
            });
        }
    }

    private showRelativeDateMenu(anchorEl: HTMLElement, condition: FilterConditionNode): void {
        const presets: RelativeDatePreset[] = ['today', 'thisWeek', 'nextWeek', 'pastWeek', 'nextNDays'];
        const currentPreset = condition.value.type === 'date' && condition.value.value.mode === 'relative'
            ? condition.value.value.preset : 'today';

        const items: SelectItem[] = presets.map(p => ({
            label: RELATIVE_DATE_LABELS[p],
            value: p,
            checked: currentPreset === p,
        }));

        this.showSelectPopover(anchorEl, items, (val) => {
            const preset = val as RelativeDatePreset;
            const dateValue: DateFilterValue = preset === 'nextNDays'
                ? { mode: 'relative', preset, n: 7 }
                : { mode: 'relative', preset };
            condition.value = { type: 'date', value: dateValue };
            this.refreshPopover();
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

    // ── Property / Operator / Value Menus ──

    private showPropertyMenu(anchorEl: HTMLElement, condition: FilterConditionNode): void {
        const properties: FilterProperty[] = [
            'file', 'tag', 'status', 'content',
            'startDate', 'endDate', 'deadline',
            'color', 'linestyle',
        ];
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
            if (NO_VALUE_OPERATORS.has(condition.operator)) {
                condition.value = { type: 'boolean', value: true };
            } else if (DATE_PROPERTIES.has(prop)) {
                condition.value = { type: 'date', value: { mode: 'relative', preset: 'today' } };
            } else if (prop === 'content') {
                condition.value = { type: 'string', value: '' };
            } else {
                condition.value = { type: 'stringSet', values: [] };
            }
            this.refreshPopover();
        });
    }

    private showOperatorMenu(anchorEl: HTMLElement, condition: FilterConditionNode): void {
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

    private showValueMenu(anchorEl: HTMLElement, condition: FilterConditionNode): void {
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

    // ── Footer Buttons ──

    private renderFooterButtons(parent: HTMLElement, group: FilterGroupNode, depth: number): void {
        const footer = parent.createDiv('filter-popover__footer');

        // Add filter
        const addBtn = footer.createEl('button', { cls: 'filter-popover__add-btn' });
        setIcon(addBtn.createSpan(), 'plus');
        addBtn.createSpan().setText('Add filter');
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            group.children.push(createDefaultCondition());
            this.refreshPopover();
        });

        // Add filter group (only if depth allows)
        if (depth < MAX_FILTER_DEPTH - 1) {
            const addGroupBtn = footer.createEl('button', { cls: 'filter-popover__add-btn' });
            setIcon(addGroupBtn.createSpan(), 'plus-square');
            addGroupBtn.createSpan().setText('Add filter group');
            addGroupBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const newGroup = createFilterGroup();
                newGroup.children.push(createDefaultCondition());
                group.children.push(newGroup);
                this.refreshPopover();
            });
        }
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

    private getToday(): string {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    private getAvailableValues(property: FilterProperty): string[] {
        switch (property) {
            case 'file': return FilterValueCollector.collectFiles(this.lastTasks);
            case 'tag': return FilterValueCollector.collectTags(this.lastTasks);
            case 'status': return FilterValueCollector.collectStatuses(this.lastTasks);
            case 'color': return FilterValueCollector.collectColors(this.lastTasks);
            case 'linestyle': return FilterValueCollector.collectLineStyles(this.lastTasks);
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
