import { setIcon } from 'obsidian';
import type { StatusDefinition, Task } from '../../types';
import { getStatusLabel } from '../../constants/statusOptions';
import type {
    FilterState, FilterConditionNode, FilterGroupNode, FilterNode,
    FilterProperty, FilterOperator, DateFilterValue, RelativeDatePreset,
    FilterContext, FilterTarget,
} from '../../services/filter/FilterTypes';
import {
    MAX_FILTER_DEPTH,
    PROPERTY_OPERATORS,
    getOperatorLabel,
    getPropertyLabel,
    PROPERTY_ICONS,
    NO_VALUE_OPERATORS,
    DATE_PROPERTIES,
    NUMBER_PROPERTIES,
    getRelativeDateLabel,
    createDefaultCondition,
    createEmptyFilterState,
    createFilterGroup,
    deepCloneNode,
    hasConditions,
} from '../../services/filter/FilterTypes';
import { t } from '../../i18n';
import { TaskFilterEngine } from '../../services/filter/TaskFilterEngine';
import { FilterValueCollector } from '../../services/filter/FilterValueCollector';

export interface FilterMenuCallbacks {
    onFilterChange: () => void;
    getTasks: () => Task[];
    getStartHour?: () => number;
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
    private startHourProvider: (() => number) | null = null;
    private taskLookupProvider: ((id: string) => Task | undefined) | null = null;
    private statusDefs: StatusDefinition[] = [];

    getFilterState(): FilterState {
        return this.state;
    }

    setFilterState(state: FilterState): void {
        this.state = JSON.parse(JSON.stringify(state));
    }

    setStartHourProvider(provider: () => number): void {
        this.startHourProvider = provider;
    }

    setTaskLookupProvider(provider: (id: string) => Task | undefined): void {
        this.taskLookupProvider = provider;
    }

    setStatusDefinitions(defs: StatusDefinition[]): void {
        this.statusDefs = defs;
    }

    isTaskVisible(task: Task): boolean {
        const context: FilterContext = {};
        if (this.startHourProvider) context.startHour = this.startHourProvider();
        if (this.taskLookupProvider) context.taskLookup = this.taskLookupProvider;
        return TaskFilterEngine.evaluate(task, this.state, Object.keys(context).length > 0 ? context : undefined);
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
                if ((target as HTMLElement).closest?.('.filter-popover__tag-suggest')) return;
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
            this.popoverEl.createDiv('filter-popover__empty').setText(t('filter.noFilters'));
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
            text: group.logic === 'and' ? t('filter.logicAnd') : t('filter.logicOr'),
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
        addBtn.createSpan().setText(t('filter.addFilter'));
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            group.children.push(createDefaultCondition());
            this.refreshPopover();
        });

        // Add sub-group button (only if depth allows)
        if (depth < MAX_FILTER_DEPTH - 1) {
            const addGroupBtn = groupFooter.createEl('button', { cls: 'filter-popover__add-btn filter-popover__add-btn--inline' });
            setIcon(addGroupBtn.createSpan(), 'plus-square');
            addGroupBtn.createSpan().setText(t('filter.addGroup'));
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
                    { label: t('filter.duplicateGroup'), value: 'duplicate-group', checked: false, icon: 'copy' },
                    { label: t('filter.ungroup'), value: 'ungroup', checked: false, icon: 'unfold-horizontal' },
                    { label: t('filter.removeGroup'), value: 'remove-group', checked: false, icon: 'trash', cls: 'filter-child-popover__item--danger' },
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

        // ── Upper row: [Target?] [Property] [Operator] [...] ──
        const headerLine = row.createDiv('filter-popover__row-header');

        // Target dropdown (only shown when not 'self')
        if (condition.target && condition.target !== 'self') {
            const targetBtn = headerLine.createEl('button', {
                cls: 'filter-popover__dropdown filter-popover__dropdown--target',
            });
            const targetIcon = targetBtn.createSpan('filter-popover__dropdown-icon');
            setIcon(targetIcon, 'arrow-up');
            targetBtn.createSpan().setText(t('filter.parent'));
            targetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showTargetMenu(targetBtn, condition);
            });
        } else {
            // Subtle "self" indicator that can be clicked to switch
            const targetBtn = headerLine.createEl('button', {
                cls: 'filter-popover__dropdown filter-popover__dropdown--target-self',
            });
            const targetIcon = targetBtn.createSpan('filter-popover__dropdown-icon');
            setIcon(targetIcon, 'user');
            targetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showTargetMenu(targetBtn, condition);
            });
        }

        // Glue: after target
        const afterTargetGlue = t(`filter.glue.afterTarget.${condition.target || 'self'}`);
        if (afterTargetGlue && !afterTargetGlue.startsWith('filter.glue.')) {
            headerLine.createEl('span', { cls: 'filter-popover__glue', text: afterTargetGlue });
        }

        // Glue: before property
        const beforePropGlue = this.resolveGlue('beforeProperty', condition.property, condition.operator);
        if (beforePropGlue) {
            headerLine.createEl('span', { cls: 'filter-popover__glue', text: beforePropGlue });
        }

        // Property dropdown (with icon)
        const propBtn = headerLine.createEl('button', { cls: 'filter-popover__dropdown' });
        const propIcon = propBtn.createSpan('filter-popover__dropdown-icon');
        setIcon(propIcon, PROPERTY_ICONS[condition.property]);
        propBtn.createSpan().setText(getPropertyLabel(condition.property));
        propBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showPropertyMenu(propBtn, condition);
        });

        // Glue: after property (before operator)
        const afterPropGlue = this.resolveGlue('afterProperty', condition.property, condition.operator);
        if (afterPropGlue) {
            headerLine.createEl('span', { cls: 'filter-popover__glue', text: afterPropGlue });
        }

        // Operator dropdown
        const opBtn = headerLine.createEl('button', {
            cls: 'filter-popover__dropdown',
            text: getOperatorLabel(condition.property, condition.operator),
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
                { label: t('filter.duplicate'), value: 'duplicate', checked: false, icon: 'copy' },
                { label: t('filter.remove'), value: 'remove', checked: false, icon: 'trash', cls: 'filter-child-popover__item--danger' },
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
            } else if (NUMBER_PROPERTIES.has(condition.property)) {
                this.renderNumberValueSelector(valueLine, condition);
            } else {
                this.renderValueSelector(valueLine, condition);
            }
        }
    }

    private resolveGlue(slot: string, property: FilterProperty, operator: FilterOperator): string {
        const glue = t(`filter.glue.${slot}.${property}.${operator}`);
        if (!glue.startsWith(`filter.glue.${slot}.`)) return glue;
        return '';
    }

    // ── Value Selector ──

    private renderValueSelector(row: HTMLElement, condition: FilterConditionNode): void {
        if (condition.property === 'content') {
            this.renderTextInput(row, condition);
        } else if (condition.property === 'property') {
            this.renderValueDropdown(row, condition);
        } else {
            this.renderPillValueSelector(row, condition);
        }
    }

    private renderTextInput(row: HTMLElement, condition: FilterConditionNode): void {
        const input = row.createEl('input', {
            cls: 'filter-popover__text-input',
            type: 'text',
            placeholder: t('filter.enterText'),
        });
        if (typeof condition.value === 'string') {
            input.value = condition.value;
        }
        const applyValue = () => {
            condition.value = input.value;
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
        const currentValues = Array.isArray(condition.value) ? condition.value as string[] : [];
        const label = currentValues.length > 0
            ? this.formatValueLabel(condition.property, currentValues)
            : t('filter.select');

        const btn = row.createEl('button', {
            cls: `filter-popover__dropdown${currentValues.length === 0 ? ' filter-popover__dropdown--placeholder' : ''}`,
            text: label,
        });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showValueMenu(btn, condition);
        });
    }

    private renderPillValueSelector(row: HTMLElement, condition: FilterConditionNode): void {
        const container = row.createDiv('filter-popover__tag-value');
        const currentValues = Array.isArray(condition.value) ? condition.value as string[] : [];
        const prop = condition.property;

        // Pill群 (only if there are selected values)
        if (currentValues.length > 0) {
            const pillContainer = container.createDiv('filter-popover__tag-pills');
            for (const val of currentValues) {
                this.renderValuePill(pillContainer, val, condition);
            }
        }

        // Input + suggest
        const inputWrap = container.createDiv('filter-popover__tag-input-wrap');
        const input = inputWrap.createEl('input', {
            cls: 'filter-popover__tag-input',
            type: 'text',
            attr: { placeholder: prop === 'tag' ? t('filter.typeTag') : t('filter.typeToFilter') },
        });

        // Suggest state
        let suggestEl: HTMLElement | null = null;
        let selectedIdx = -1;
        let suggestItems: { el: HTMLElement; value: string }[] = [];
        let outsideHandler: ((e: MouseEvent) => void) | null = null;

        const closeSuggest = () => {
            if (suggestEl) {
                suggestEl.remove();
                suggestEl = null;
            }
            suggestItems = [];
            selectedIdx = -1;
            if (outsideHandler) {
                document.removeEventListener('pointerdown', outsideHandler, true);
                outsideHandler = null;
            }
        };

        const addValue = (val: string) => {
            const normalized = prop === 'tag' ? val.trim().replace(/^#/, '') : prop === 'status' ? val : val.trim();
            if (!normalized) return;
            const arr = Array.isArray(condition.value) ? condition.value as string[] : [];
            if (!arr.includes(normalized)) {
                condition.value = [...arr, normalized];
                this.lastCallbacks?.onFilterChange();
            }
            input.value = '';
            closeSuggest();
            this.renderContent();
        };

        const showSuggest = (query: string, showAll: boolean) => {
            closeSuggest();
            const available = this.getAvailableValues(prop);
            const selected = new Set(Array.isArray(condition.value) ? condition.value as string[] : []);
            const q = prop === 'tag' ? query.toLowerCase().replace(/^#/, '') : query.toLowerCase();

            const filtered = available.filter(v => {
                if (selected.has(v)) return false;
                if (showAll || !q) return true;
                return this.getValueDisplay(prop, v).toLowerCase().includes(q) || v.toLowerCase().includes(q);
            });
            if (filtered.length === 0) return;

            suggestEl = document.createElement('div');
            suggestEl.className = 'filter-popover__tag-suggest';
            suggestItems = [];
            selectedIdx = -1;

            for (const val of filtered) {
                const item = suggestEl.createDiv('filter-popover__tag-suggest-item');
                if (prop === 'color') {
                    const swatch = item.createSpan('filter-popover__color-swatch');
                    swatch.style.backgroundColor = val;
                } else if (prop === 'status') {
                    const checkbox = item.createEl('input', { cls: 'task-list-item-checkbox filter-popover__status-checkbox' });
                    checkbox.type = 'checkbox';
                    checkbox.checked = val !== ' ';
                    checkbox.readOnly = true;
                    checkbox.tabIndex = -1;
                    if (val !== ' ') checkbox.dataset.task = val;
                }
                item.createSpan().setText(this.getValueDisplay(prop, val));
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    addValue(val);
                });
                suggestItems.push({ el: item, value: val });
            }

            document.body.appendChild(suggestEl);

            // Position below input
            const rect = inputWrap.getBoundingClientRect();
            let x = rect.left;
            let y = rect.bottom + 2;
            const suggestRect = suggestEl.getBoundingClientRect();
            if (x + suggestRect.width > window.innerWidth) {
                x = window.innerWidth - suggestRect.width - 8;
            }
            if (y + suggestRect.height > window.innerHeight) {
                y = rect.top - suggestRect.height - 2;
            }
            suggestEl.style.left = `${Math.max(8, x)}px`;
            suggestEl.style.top = `${Math.max(8, y)}px`;
            suggestEl.style.width = `${rect.width}px`;

            outsideHandler = (e: MouseEvent) => {
                const target = e.target as Node;
                if (suggestEl?.contains(target) || inputWrap.contains(target)) return;
                closeSuggest();
            };
            setTimeout(() => {
                document.addEventListener('pointerdown', outsideHandler!, true);
            }, 0);
        };

        const updateHighlight = () => {
            for (let i = 0; i < suggestItems.length; i++) {
                suggestItems[i].el.classList.toggle('filter-popover__tag-suggest-item--active', i === selectedIdx);
            }
            if (selectedIdx >= 0 && suggestItems[selectedIdx]) {
                suggestItems[selectedIdx].el.scrollIntoView({ block: 'nearest' });
            }
        };

        // Input events
        input.addEventListener('input', () => {
            showSuggest(input.value, false);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!suggestEl) {
                    showSuggest(input.value, !input.value);
                } else if (suggestItems.length > 0) {
                    selectedIdx = (selectedIdx + 1) % suggestItems.length;
                    updateHighlight();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (suggestItems.length > 0) {
                    selectedIdx = selectedIdx <= 0 ? suggestItems.length - 1 : selectedIdx - 1;
                    updateHighlight();
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (selectedIdx >= 0 && suggestItems[selectedIdx]) {
                    addValue(suggestItems[selectedIdx].value);
                } else if (input.value.trim()) {
                    addValue(input.value);
                }
            } else if (e.key === 'Escape') {
                closeSuggest();
            } else if (e.key === 'Backspace' && !input.value && currentValues.length > 0) {
                // Remove last pill on backspace in empty input
                const last = currentValues[currentValues.length - 1];
                const arr = Array.isArray(condition.value) ? condition.value as string[] : [];
                condition.value = arr.filter(v => v !== last);
                this.lastCallbacks?.onFilterChange();
                this.renderContent();
            }
        });

        input.addEventListener('focus', () => {
            showSuggest(input.value, !input.value);
        });
    }

    private renderValuePill(container: HTMLElement, value: string, condition: FilterConditionNode): void {
        const pill = container.createDiv('filter-popover__tag-pill');
        if (condition.property === 'color') {
            const swatch = pill.createSpan('filter-popover__color-swatch');
            swatch.style.backgroundColor = value;
        } else if (condition.property === 'status') {
            const checkbox = pill.createEl('input', { cls: 'task-list-item-checkbox filter-popover__status-checkbox' });
            checkbox.type = 'checkbox';
            checkbox.checked = value !== ' ';
            checkbox.readOnly = true;
            checkbox.tabIndex = -1;
            if (value !== ' ') checkbox.dataset.task = value;
        }
        pill.createSpan().setText(this.getValueDisplay(condition.property, value));
        const removeBtn = pill.createEl('button', { cls: 'filter-popover__tag-pill-remove' });
        setIcon(removeBtn.createSpan(), 'x');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const arr = Array.isArray(condition.value) ? condition.value as string[] : [];
            condition.value = arr.filter(v => v !== value);
            this.lastCallbacks?.onFilterChange();
            this.renderContent();
        });
    }

    // ── Date Value Selector ──

    private renderDateValueSelector(row: HTMLElement, condition: FilterConditionNode): void {
        const container = row.createDiv('filter-popover__date-value');

        // Initialize value if needed
        if (condition.value == null || (typeof condition.value !== 'string' && typeof condition.value !== 'object')) {
            condition.value = { preset: 'today' } as DateFilterValue;
        }

        const dateVal = condition.value as DateFilterValue;
        const isRelative = typeof dateVal === 'object' && 'preset' in dateVal;

        // Mode toggle button: "Relative" / "Absolute"
        const modeBtn = container.createEl('button', {
            cls: 'filter-popover__dropdown filter-popover__date-mode-btn',
            text: isRelative ? t('filter.relative') : t('filter.absolute'),
        });
        modeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isRelative) {
                condition.value = this.getToday();
            } else {
                condition.value = { preset: 'today' } as DateFilterValue;
            }
            this.refreshPopover();
        });

        if (isRelative) {
            const relVal = dateVal as { preset: RelativeDatePreset; n?: number };
            // Relative preset dropdown
            const presetBtn = container.createEl('button', {
                cls: 'filter-popover__dropdown',
                text: relVal.preset === 'nextNDays'
                    ? t('filter.relativeDate.nextNDaysValue', { n: relVal.n ?? 7 })
                    : getRelativeDateLabel(relVal.preset),
            });
            presetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showRelativeDateMenu(presetBtn, condition);
            });

            // Number input for nextNDays
            if (relVal.preset === 'nextNDays') {
                const nInput = container.createEl('input', {
                    cls: 'filter-popover__n-input',
                    type: 'number',
                });
                nInput.value = String(relVal.n ?? 7);
                nInput.min = '1';
                nInput.placeholder = 'N';
                nInput.addEventListener('change', () => {
                    const n = parseInt(nInput.value, 10);
                    if (n > 0) {
                        condition.value = { preset: 'nextNDays', n } as DateFilterValue;
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
            dateInput.value = (typeof dateVal === 'string' ? dateVal : '') || this.getToday();
            dateInput.addEventListener('change', () => {
                condition.value = dateInput.value;
                this.lastCallbacks?.onFilterChange();
            });
        }
    }

    private showRelativeDateMenu(anchorEl: HTMLElement, condition: FilterConditionNode): void {
        const presets: RelativeDatePreset[] = ['today', 'thisWeek', 'nextWeek', 'pastWeek', 'nextNDays', 'thisMonth', 'thisYear'];
        const dateVal = condition.value as DateFilterValue;
        const currentPreset = typeof dateVal === 'object' && 'preset' in dateVal
            ? dateVal.preset : 'today';

        const items: SelectItem[] = presets.map(p => ({
            label: getRelativeDateLabel(p),
            value: p,
            checked: currentPreset === p,
        }));

        this.showSelectPopover(anchorEl, items, (val) => {
            const preset = val as RelativeDatePreset;
            condition.value = preset === 'nextNDays'
                ? { preset, n: 7 } as DateFilterValue
                : { preset } as DateFilterValue;
            this.refreshPopover();
        });
    }

    // ── Number Value Selector (Length filter) ──

    private renderNumberValueSelector(row: HTMLElement, condition: FilterConditionNode): void {
        const container = row.createDiv('filter-popover__number-value');

        if (typeof condition.value !== 'number') {
            condition.value = 1;
            condition.unit = 'hours';
        }
        const unit = condition.unit ?? 'hours';

        // Unit toggle button (Hours / Minutes)
        const unitBtn = container.createEl('button', {
            cls: 'filter-popover__dropdown filter-popover__unit-btn',
            text: unit === 'hours' ? t('filter.hours') : t('filter.minutes'),
        });
        unitBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            condition.unit = unit === 'hours' ? 'minutes' : 'hours';
            this.refreshPopover();
        });

        // Number input
        const input = container.createEl('input', {
            cls: 'filter-popover__n-input',
            type: 'number',
        });
        input.value = String(condition.value);
        input.min = '0';
        input.step = unit === 'hours' ? '0.5' : '1';
        input.addEventListener('change', () => {
            const n = parseFloat(input.value);
            if (Number.isFinite(n) && n >= 0) {
                condition.value = n;
                this.lastCallbacks?.onFilterChange();
            }
        });
    }

    private formatValueLabel(property: FilterProperty, values: string[]): string {
        if (values.length === 0) return t('filter.select');
        if (values.length === 1) {
            const v = values[0];
            if (property === 'file') return v.split('/').pop() || v;
            if (property === 'tag') return `#${v}`;
            if (property === 'status') return this.getStatusLabelForChar(v);
            if (property === 'taskType') return v === 'at-notation' ? t('filter.taskTypeAtNotation') : t('filter.taskTypeFrontmatter');
            return v;
        }
        return t('filter.nSelected', { n: values.length });
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

    // ── Property / Operator / Value Menus ──

    private showPropertyMenu(anchorEl: HTMLElement, condition: FilterConditionNode): void {
        const properties: FilterProperty[] = [
            'file', 'tag', 'status', 'content',
            'startDate', 'endDate', 'due',
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

    private showOperatorMenu(anchorEl: HTMLElement, condition: FilterConditionNode): void {
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

    private showTargetMenu(anchorEl: HTMLElement, condition: FilterConditionNode): void {
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

    private showValueMenu(anchorEl: HTMLElement, condition: FilterConditionNode): void {
        const available = this.getAvailableValues(condition.property);
        const currentValues = new Set(Array.isArray(condition.value) ? condition.value as string[] : []);

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
            condition.value = Array.from(currentValues);
            this.lastCallbacks?.onFilterChange();
        }, true);
    }

    // ── Footer Buttons ──

    private renderFooterButtons(parent: HTMLElement, group: FilterGroupNode, depth: number): void {
        const footer = parent.createDiv('filter-popover__footer');

        // Add filter
        const addBtn = footer.createEl('button', { cls: 'filter-popover__add-btn' });
        setIcon(addBtn.createSpan(), 'plus');
        addBtn.createSpan().setText(t('filter.addFilter'));
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            group.children.push(createDefaultCondition());
            this.refreshPopover();
        });

        // Add filter group (only if depth allows)
        if (depth < MAX_FILTER_DEPTH - 1) {
            const addGroupBtn = footer.createEl('button', { cls: 'filter-popover__add-btn' });
            setIcon(addGroupBtn.createSpan(), 'plus-square');
            addGroupBtn.createSpan().setText(t('filter.addFilterGroup'));
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
            case 'taskType': return FilterValueCollector.collectParserIds(this.lastTasks);
            default: return [];
        }
    }

    private getValueDisplay(property: FilterProperty, value: string): string {
        if (property === 'file') return value.split('/').pop() || value;
        if (property === 'tag') return `#${value}`;
        if (property === 'status') {
            return this.getStatusLabelForChar(value);
        }
        if (property === 'taskType') {
            return value === 'at-notation' ? t('filter.taskTypeAtNotation') : t('filter.taskTypeFrontmatter');
        }
        return value;
    }

    private getStatusLabelForChar(statusChar: string): string {
        return getStatusLabel(statusChar, this.statusDefs);
    }
}
