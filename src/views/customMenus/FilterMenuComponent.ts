import { setIcon } from 'obsidian';
import type { StatusDefinition, Task } from '../../types';
import type { FilterState, FilterCondition, FilterGroup, FilterItem } from '../../services/filter/FilterTypes';
import {
    MAX_FILTER_DEPTH,
    PROPERTY_ICONS,
    getOperatorLabel,
    getPropertyLabel,
    createDefaultCondition,
    createEmptyFilterState,
    createFilterGroup,
    hasConditions,
    isFilterCondition,
    isPresenceOperator,
    isListCondition,
    isDateCondition,
    isLengthCondition,
    isContentCondition,
    isPropertyCondition,
} from '../../services/filter/FilterTypes';
import {
    type NodePath, nodeAt, updateGroupAt, updateConditionAt, replaceAt, appendTo, toggleLogic,
} from '../../services/filter/FilterEdit';
import { t } from '../../i18n';
import { resolveGlue, type ConditionEditor } from './FilterValueHelpers';
import { FilterDropdownMenus } from './FilterDropdownMenus';
import type { SelectItem } from './FilterDropdownMenus';
import { FilterConditionRenderer } from './FilterConditionRenderer';
import { PopoverStack } from '../sharedUI/PopoverStack';
import { OverlayShell } from '../sharedUI/OverlayShell';

const anyCondition = (_c: FilterCondition): _c is FilterCondition => true;

export interface FilterMenuCallbacks {
    onFilterChange: () => void;
    getTasks: () => Task[];
}

/**
 * Notion-style filter popover with recursive group nesting.
 * Groups can contain both conditions and sub-groups up to MAX_FILTER_DEPTH levels.
 *
 * The menu holds the filter it edits, a value (`FilterState`): each edit
 * makes a new one from the one held (`FilterEdit`) and tells the owner,
 * which reads it with `getFilterState`. What the owner read before stays as
 * it was, so neither side copies.
 */
export class FilterMenuComponent {
    private state: FilterState = createEmptyFilterState();
    private overlay = new OverlayShell();
    private stack = new PopoverStack();
    private rootEl: HTMLElement | null = null;
    private lastTasks: Task[] = [];
    private lastCallbacks: FilterMenuCallbacks | null = null;
    private statusDefs: StatusDefinition[] = [];

    private dropdowns: FilterDropdownMenus;
    private conditionRenderer: FilterConditionRenderer;

    constructor() {
        const getStack = () => this.stack;
        this.dropdowns = new FilterDropdownMenus(getStack);
        this.conditionRenderer = new FilterConditionRenderer(
            this.dropdowns,
            () => this.statusDefs,
            () => this.lastTasks,
            getStack,
        );
    }

    getFilterState(): FilterState {
        return this.state;
    }

    setFilterState(state: FilterState): void {
        this.state = state;
    }

    setStatusDefinitions(defs: StatusDefinition[]): void {
        this.statusDefs = defs;
    }

    hasActiveFilters(): boolean {
        return hasConditions(this.state);
    }

    isOpen(): boolean {
        return this.overlay.isOpen();
    }

    showMenuAtElement(anchorEl: HTMLElement, callbacks: FilterMenuCallbacks): void {
        this.openWith({ kind: 'element', element: anchorEl }, callbacks);
    }

    showMenu(event: MouseEvent, callbacks: FilterMenuCallbacks): void {
        this.openWith({ kind: 'event', event }, callbacks);
    }

    private openWith(
        anchor: { kind: 'element'; element: HTMLElement } | { kind: 'event'; event: MouseEvent },
        callbacks: FilterMenuCallbacks,
    ): void {
        this.lastTasks = callbacks.getTasks();
        this.lastCallbacks = callbacks;

        this.overlay.open({
            mode: 'anchored',
            anchor,
            panelClass: 'filter-popover',
            childStack: this.stack,
            build: (bodyEl) => {
                this.rootEl = bodyEl;
                this.renderContent();
            },
            onClose: () => {
                this.stack.closeAll();
                this.rootEl = null;
            },
        });
    }

    close(): void {
        this.overlay.close();
    }

    // ── Render ──

    private renderContent(): void {
        if (!this.rootEl) return;
        this.rootEl.empty();

        if (this.state.filters.length === 0) {
            this.rootEl.createDiv('filter-popover__empty').setText(t('filter.noFilters'));
        } else {
            this.renderChildren(this.rootEl, this.state, [], 0);
        }

        this.renderFooterButtons(this.rootEl);
    }

    /**
     * Hold `next` and tell the owner. `redraw` draws the menu from it; `keep`
     * leaves the controls, which already show it. An edit that changed
     * nothing tells no one.
     */
    private commit(next: FilterState, after: 'redraw' | 'keep'): void {
        if (next === this.state) return;
        this.state = next;
        if (after === 'redraw') this.renderContent();
        this.lastCallbacks?.onFilterChange();
    }

    private editGroup(path: NodePath, edit: (group: FilterGroup) => FilterGroup): void {
        this.commit(updateGroupAt(this.state, path, edit), 'redraw');
    }

    /** Replace the node at `path` by what `edit` makes of it (none, itself twice, its children). */
    private replaceNode(path: NodePath, edit: (node: FilterItem) => readonly FilterItem[]): void {
        this.commit(replaceAt(this.state, path, edit), 'redraw');
    }

    /**
     * The editor of the row at `path`, for a control that edits a condition
     * of the kind `isKind` tells. A row changes kind only by its property
     * menu, which redraws it, so the row's controls always find their kind.
     */
    private editorAt<C extends FilterCondition>(path: NodePath, isKind: (c: FilterCondition) => c is C): ConditionEditor<C> {
        const current = (): C => {
            const node = nodeAt(this.state, path);
            if (!isFilterCondition(node) || !isKind(node)) throw new Error(`filter menu: the row at [${path.join(', ')}] changed kind under its controls`);
            return node;
        };
        return {
            current,
            update: (edit, after) => {
                this.commit(updateConditionAt(this.state, path, () => edit(current())), after);
            },
        };
    }

    // ── Recursive Children Rendering ──

    private renderChildren(parent: HTMLElement, group: FilterGroup, path: NodePath, depth: number): void {
        for (let i = 0; i < group.filters.length; i++) {
            const child = group.filters[i];

            // Inter-sibling logic separator (between nodes, not before the first)
            if (i > 0) {
                this.renderLogicSeparator(parent, group, path);
            }

            if (isFilterCondition(child)) {
                this.renderConditionRow(parent, child, [...path, i]);
            } else {
                this.renderGroup(parent, child, [...path, i], depth + 1, group.filters.length);
            }
        }
    }

    // ── Logic Separator ──

    private renderLogicSeparator(parent: HTMLElement, group: FilterGroup, path: NodePath): void {
        const logicRow = parent.createDiv('filter-popover__logic-separator');
        const logicBtn = logicRow.createEl('button', {
            cls: 'filter-popover__logic-btn',
            text: group.logic === 'and' ? t('filter.logicAnd') : t('filter.logicOr'),
        });
        logicBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.editGroup(path, toggleLogic);
        });
    }

    // ── Group Rendering (recursive) ──

    private renderGroup(
        parent: HTMLElement,
        group: FilterGroup,
        path: NodePath,
        depth: number,
        siblingCount: number,
    ): void {
        const groupEl = parent.createDiv('filter-popover__group');

        // Group body with visual accent border and depth-based indentation
        const groupBody = groupEl.createDiv('filter-popover__group-body');
        groupBody.style.setProperty('--depth', String(depth)); // indent calc 用
        groupBody.dataset.depth = String(depth); // 背景シェーディングのセレクタ用

        // Render children recursively
        this.renderChildren(groupBody, group, path, depth);

        // Group footer: [+ Add filter] [+ Add group] [...]
        const groupFooter = groupBody.createDiv('filter-popover__group-footer');

        // Add filter button
        const addBtn = groupFooter.createEl('button', { cls: 'filter-popover__add-btn filter-popover__add-btn--inline' });
        setIcon(addBtn.createSpan(), 'plus');
        addBtn.createSpan().setText(t('filter.addFilter'));
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.editGroup(path, g => appendTo(g, createDefaultCondition()));
        });

        // Add sub-group button (only if depth allows)
        if (depth < MAX_FILTER_DEPTH - 1) {
            const addGroupBtn = groupFooter.createEl('button', { cls: 'filter-popover__add-btn filter-popover__add-btn--inline' });
            setIcon(addGroupBtn.createSpan(), 'plus-square');
            addGroupBtn.createSpan().setText(t('filter.addGroup'));
            addGroupBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.editGroup(path, g => appendTo(g, createFilterGroup()));
            });
        }

        // Group more menu (...) — only when parent has multiple children
        if (siblingCount > 1) {
            const groupMoreBtn = groupFooter.createEl('button', { cls: 'tv-icon-btn filter-popover__more-btn' });
            setIcon(groupMoreBtn.createSpan(), 'more-horizontal');
            groupMoreBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const items: SelectItem[] = [
                    { label: t('filter.duplicateGroup'), value: 'duplicate-group', checked: false, icon: 'copy' },
                    { label: t('filter.ungroup'), value: 'ungroup', checked: false, icon: 'unfold-horizontal' },
                    { label: t('filter.removeGroup'), value: 'remove-group', checked: false, icon: 'trash', cls: 'filter-child-popover__item--danger' },
                ];
                this.dropdowns.showSelectPopover(groupMoreBtn, items, (val) => {
                    if (val === 'remove-group') {
                        this.replaceNode(path, () => []);
                    } else if (val === 'duplicate-group') {
                        // A value: the copy and the original can be the same object.
                        this.replaceNode(path, node => [node, node]);
                    } else if (val === 'ungroup') {
                        // Move all filters of this group into the parent
                        this.replaceNode(path, node => (isFilterCondition(node) ? [node] : node.filters));
                    }
                });
            });
        }
    }

    // ── Condition Row (2-row layout: header + value) ──

    private renderConditionRow(
        parent: HTMLElement,
        condition: FilterCondition,
        path: NodePath,
    ): void {
        const row = parent.createDiv('filter-popover__row');
        const edit = this.editorAt(path, anyCondition);

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
                this.dropdowns.showTargetMenu(targetBtn, edit);
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
                this.dropdowns.showTargetMenu(targetBtn, edit);
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
            this.dropdowns.showPropertyMenu(propBtn, edit);
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
            this.dropdowns.showOperatorMenu(opBtn, edit);
        });

        // More menu button (...) — condition-level actions
        const moreBtn = headerLine.createEl('button', { cls: 'tv-icon-btn filter-popover__more-btn' });
        setIcon(moreBtn.createSpan(), 'more-horizontal');
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const items: SelectItem[] = [
                { label: t('filter.duplicate'), value: 'duplicate', checked: false, icon: 'copy' },
                { label: t('filter.remove'), value: 'remove', checked: false, icon: 'trash', cls: 'filter-child-popover__item--danger' },
            ];
            this.dropdowns.showSelectPopover(moreBtn, items, (val) => {
                if (val === 'remove') {
                    this.replaceNode(path, () => []);
                } else if (val === 'duplicate') {
                    this.replaceNode(path, node => [node, node]);
                }
            });
        });

        // ── Lower row(s): Value selector ──
        // Property filter: 2 sub-rows ([key:pill] / [value-input]). Other types: single row.
        if (isPropertyCondition(condition)) {
            this.conditionRenderer.renderPropertyRows(row, this.editorAt(path, isPropertyCondition));
        } else if (!isPresenceOperator(condition.operator)) {
            const valueLine = row.createDiv('filter-popover__row-value');
            if (isDateCondition(condition)) {
                this.conditionRenderer.renderDateValueSelector(valueLine, this.editorAt(path, isDateCondition));
            } else if (isLengthCondition(condition)) {
                this.conditionRenderer.renderNumberValueSelector(valueLine, this.editorAt(path, isLengthCondition));
            } else if (isContentCondition(condition)) {
                this.conditionRenderer.renderTextInput(valueLine, this.editorAt(path, isContentCondition));
            } else if (isListCondition(condition)) {
                this.conditionRenderer.renderPillValueSelector(valueLine, this.editorAt(path, isListCondition));
            }
        }
    }

    // ── Footer Buttons ──

    private renderFooterButtons(parent: HTMLElement): void {
        const footer = parent.createDiv('filter-popover__footer');

        // Add filter
        const addBtn = footer.createEl('button', { cls: 'filter-popover__add-btn' });
        setIcon(addBtn.createSpan(), 'plus');
        addBtn.createSpan().setText(t('filter.addFilter'));
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.editGroup([], g => appendTo(g, createDefaultCondition()));
        });

        // Add filter group (the root is depth 0, below the limit)
        if (MAX_FILTER_DEPTH > 1) {
            const addGroupBtn = footer.createEl('button', { cls: 'filter-popover__add-btn' });
            setIcon(addGroupBtn.createSpan(), 'plus-square');
            addGroupBtn.createSpan().setText(t('filter.addFilterGroup'));
            addGroupBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.editGroup([], g => appendTo(g, createFilterGroup()));
            });
        }
    }

}
