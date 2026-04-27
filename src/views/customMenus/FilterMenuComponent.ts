import { setIcon } from 'obsidian';
import type { StatusDefinition, Task } from '../../types';
import type {
    FilterState, FilterCondition, FilterGroup,
    FilterProperty, FilterOperator,
} from '../../services/filter/FilterTypes';
import {
    MAX_FILTER_DEPTH,
    PROPERTY_ICONS,
    getOperatorLabel,
    getPropertyLabel,
    NO_VALUE_OPERATORS,
    DATE_PROPERTIES,
    NUMBER_PROPERTIES,
    createDefaultCondition,
    createEmptyFilterState,
    createFilterGroup,
    deepCloneNode,
    hasConditions,
    isFilterCondition,
} from '../../services/filter/FilterTypes';
import { t } from '../../i18n';
import { resolveGlue } from './FilterValueHelpers';
import { FilterDropdownMenus } from './FilterDropdownMenus';
import type { SelectItem } from './FilterDropdownMenus';
import { FilterConditionRenderer } from './FilterConditionRenderer';

export interface FilterMenuCallbacks {
    onFilterChange: () => void;
    getTasks: () => Task[];
    getStartHour?: () => number;
}

/**
 * Notion-style filter popover with recursive group nesting.
 * Groups can contain both conditions and sub-groups up to MAX_FILTER_DEPTH levels.
 */
export class FilterMenuComponent {
    private state: FilterState = createEmptyFilterState();
    private popoverEl: HTMLElement | null = null;
    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private lastTasks: Task[] = [];
    private lastCallbacks: FilterMenuCallbacks | null = null;
    private startHourProvider: (() => number) | null = null;
    private taskLookupProvider: ((id: string) => Task | undefined) | null = null;
    private statusDefs: StatusDefinition[] = [];

    private dropdowns: FilterDropdownMenus;
    private conditionRenderer: FilterConditionRenderer;

    constructor() {
        const refreshPopover = () => this.refreshPopover();
        const renderContent = () => this.renderContent();
        const getStatusDefs = () => this.statusDefs;
        const getLastTasks = () => this.lastTasks;
        const getOnFilterChange = () => this.lastCallbacks?.onFilterChange;

        this.dropdowns = new FilterDropdownMenus(
            refreshPopover,
            renderContent,
            getStatusDefs,
            getLastTasks,
            getOnFilterChange,
        );
        this.conditionRenderer = new FilterConditionRenderer(
            refreshPopover,
            renderContent,
            this.dropdowns,
            getStatusDefs,
            getLastTasks,
            getOnFilterChange,
        );
    }

    getFilterState(): FilterState {
        return this.state;
    }

    setFilterState(state: FilterState): void {
        this.state = structuredClone(state);
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
        this.dropdowns.closeChildPopover();
        if (this.popoverEl) {
            this.popoverEl.remove();
            this.popoverEl = null;
        }
        if (this.outsideClickHandler) {
            document.removeEventListener('pointerdown', this.outsideClickHandler, true);
            this.outsideClickHandler = null;
        }
    }

    // ── Render ──

    private renderContent(): void {
        if (!this.popoverEl) return;
        this.popoverEl.empty();

        if (this.state.filters.length === 0) {
            this.popoverEl.createDiv('filter-popover__empty').setText(t('filter.noFilters'));
        } else {
            this.renderChildren(this.popoverEl, this.state, 0);
        }

        this.renderFooterButtons(this.popoverEl, this.state, 0);
    }

    private refreshPopover(): void {
        if (!this.popoverEl) return;
        this.renderContent();
        this.lastCallbacks?.onFilterChange();
    }

    // ── Recursive Children Rendering ──

    private renderChildren(parent: HTMLElement, group: FilterGroup, depth: number): void {
        for (let i = 0; i < group.filters.length; i++) {
            const child = group.filters[i];

            // Inter-sibling logic separator (between nodes, not before the first)
            if (i > 0) {
                this.renderLogicSeparator(parent, group, depth);
            }

            if (isFilterCondition(child)) {
                this.renderConditionRow(parent, group, child, i);
            } else {
                this.renderGroup(parent, child, depth + 1, group, i);
            }
        }
    }

    // ── Logic Separator ──

    private renderLogicSeparator(parent: HTMLElement, group: FilterGroup, _depth: number): void {
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
        group: FilterGroup,
        depth: number,
        parentGroup: FilterGroup,
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
            group.filters.push(createDefaultCondition());
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
                newGroup.filters.push(createDefaultCondition());
                group.filters.push(newGroup);
                this.refreshPopover();
            });
        }

        // Group more menu (...) — only when parent has multiple children
        if (parentGroup.filters.length > 1) {
            const groupMoreBtn = groupFooter.createEl('button', { cls: 'filter-popover__more-btn' });
            setIcon(groupMoreBtn, 'more-horizontal');
            groupMoreBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const items: SelectItem[] = [
                    { label: t('filter.duplicateGroup'), value: 'duplicate-group', checked: false, icon: 'copy' },
                    { label: t('filter.ungroup'), value: 'ungroup', checked: false, icon: 'unfold-horizontal' },
                    { label: t('filter.removeGroup'), value: 'remove-group', checked: false, icon: 'trash', cls: 'filter-child-popover__item--danger' },
                ];
                this.dropdowns.showSelectPopover(groupMoreBtn, items, (val) => {
                    if (val === 'remove-group') {
                        parentGroup.filters.splice(indexInParent, 1);
                        this.refreshPopover();
                    } else if (val === 'duplicate-group') {
                        const dup = deepCloneNode(group) as FilterGroup;
                        parentGroup.filters.splice(indexInParent + 1, 0, dup);
                        this.refreshPopover();
                    } else if (val === 'ungroup') {
                        // Move all filters of this group into the parent
                        parentGroup.filters.splice(indexInParent, 1, ...group.filters);
                        this.refreshPopover();
                    }
                });
            });
        }
    }

    // ── Condition Row (2-row layout: header + value) ──

    private renderConditionRow(
        parent: HTMLElement,
        ownerGroup: FilterGroup,
        condition: FilterCondition,
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
                this.dropdowns.showTargetMenu(targetBtn, condition);
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
                this.dropdowns.showTargetMenu(targetBtn, condition);
            });
        }

        // Glue: after target
        const afterTargetGlue = t(`filter.glue.afterTarget.${condition.target || 'self'}`);
        if (afterTargetGlue && !afterTargetGlue.startsWith('filter.glue.')) {
            headerLine.createEl('span', { cls: 'filter-popover__glue', text: afterTargetGlue });
        }

        // Glue: before property
        const beforePropGlue = resolveGlue('beforeProperty', condition.property, condition.operator);
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
            this.dropdowns.showPropertyMenu(propBtn, condition);
        });

        // Glue: after property (before operator)
        const afterPropGlue = resolveGlue('afterProperty', condition.property, condition.operator);
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
            this.dropdowns.showOperatorMenu(opBtn, condition);
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
            this.dropdowns.showSelectPopover(moreBtn, items, (val) => {
                if (val === 'remove') {
                    ownerGroup.filters.splice(indexInGroup, 1);
                    this.refreshPopover();
                } else if (val === 'duplicate') {
                    const dup = deepCloneNode(condition) as FilterCondition;
                    ownerGroup.filters.splice(indexInGroup + 1, 0, dup);
                    this.refreshPopover();
                }
            });
        });

        // ── Lower row(s): Value selector ──
        // Property filter: 2 sub-rows ([key:pill] / [value-input]). Other types: single row.
        if (condition.property === 'property') {
            this.conditionRenderer.renderPropertyRows(row, condition);
        } else if (!NO_VALUE_OPERATORS.has(condition.operator)) {
            const valueLine = row.createDiv('filter-popover__row-value');
            if (DATE_PROPERTIES.has(condition.property)) {
                this.conditionRenderer.renderDateValueSelector(valueLine, condition);
            } else if (NUMBER_PROPERTIES.has(condition.property)) {
                this.conditionRenderer.renderNumberValueSelector(valueLine, condition);
            } else {
                this.conditionRenderer.renderValueSelector(valueLine, condition);
            }
        }
    }

    // ── Footer Buttons ──

    private renderFooterButtons(parent: HTMLElement, group: FilterGroup, depth: number): void {
        const footer = parent.createDiv('filter-popover__footer');

        // Add filter
        const addBtn = footer.createEl('button', { cls: 'filter-popover__add-btn' });
        setIcon(addBtn.createSpan(), 'plus');
        addBtn.createSpan().setText(t('filter.addFilter'));
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            group.filters.push(createDefaultCondition());
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
                newGroup.filters.push(createDefaultCondition());
                group.filters.push(newGroup);
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
}
