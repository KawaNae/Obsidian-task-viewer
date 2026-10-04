import { setIcon, type App } from 'obsidian';
import type { Task } from '../../types';
import type { FilterState, FilterCondition, FilterGroup, FilterItem } from '../../services/filter/FilterTypes';
import {
    MAX_FILTER_DEPTH,
    PROPERTY_ICONS,
    getOperatorLabel,
    getPropertyLabel,
    createDefaultCondition,
    createEmptyFilterState,
    createFilterGroup,
    isFilterCondition,
    isPresenceOperator,
    isListCondition,
    isDateCondition,
    isPeriodCondition,
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
import { FilterConditionRenderer, type DateRowCondition, type FilterMenuSettings } from './FilterConditionRenderer';
import { PopoverStack } from '../sharedUI/PopoverStack';
import { OverlayShell } from '../sharedUI/OverlayShell';

const anyCondition = (_c: FilterCondition): _c is FilterCondition => true;
const isDateRow = (c: FilterCondition): c is DateRowCondition => isDateCondition(c) || isPeriodCondition(c);

/** What the menu is opened with. */
export interface FilterEditOptions {
    /** The filter to edit. */
    value: FilterState;
    /** Hears every edit, with the filter it made. */
    onChange: (next: FilterState) => void;
    getTasks: () => Task[];
}

/**
 * Notion-style filter popover with recursive group nesting.
 * Groups can contain both conditions and sub-groups up to MAX_FILTER_DEPTH levels.
 *
 * The menu is an editor: it is handed the filter to edit, a value
 * (`FilterState`), and each edit makes a new one from it (`FilterEdit`) and
 * hands it to `onChange`. The owner keeps the filter; the menu holds it only
 * while it is open. What the owner held before stays as it was, so neither
 * side copies.
 */
export class FilterMenuComponent {
    private state: FilterState = createEmptyFilterState();
    private overlay = new OverlayShell();
    private stack = new PopoverStack();
    private rootEl: HTMLElement | null = null;
    private lastTasks: Task[] = [];
    private options: FilterEditOptions | null = null;
    /** Which drawing of the menu is on screen: counted up each time it is drawn. */
    private drawing = 0;

    private dropdowns: FilterDropdownMenus;
    private conditionRenderer: FilterConditionRenderer;

    /**
     * @param app the app: its keymap, whose hotkeys the menu keeps out while it has the focus, and the lists under its fields.
     * @param settings the settings as they are now: the statuses' names, and the week and the day a preset turned to a range counts from.
     */
    constructor(private readonly app: App, settings: () => FilterMenuSettings) {
        const getStack = () => this.stack;
        this.dropdowns = new FilterDropdownMenus(getStack);
        this.conditionRenderer = new FilterConditionRenderer(
            app,
            this.dropdowns,
            settings,
            () => this.lastTasks,
        );
    }

    isOpen(): boolean {
        return this.overlay.isOpen();
    }

    showMenuAtElement(anchorEl: HTMLElement, options: FilterEditOptions): void {
        this.openWith({ kind: 'element', element: anchorEl }, options);
    }

    showMenu(event: MouseEvent, options: FilterEditOptions): void {
        this.openWith({ kind: 'event', event }, options);
    }

    private openWith(
        anchor: { kind: 'element'; element: HTMLElement } | { kind: 'event'; event: MouseEvent },
        options: FilterEditOptions,
    ): void {
        this.state = options.value;
        this.lastTasks = options.getTasks();
        this.options = options;

        this.overlay.open({
            mode: 'anchored',
            anchor,
            panelClass: 'filter-popover',
            childStack: this.stack,
            keymap: this.app.keymap,
            build: (bodyEl) => {
                this.rootEl = bodyEl;
                this.renderContent();
            },
            onClose: () => {
                this.conditionRenderer.closeLists();
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
        // The controls drawn before are gone from here on (`editorAt`).
        this.drawing++;
        this.conditionRenderer.closeLists();
        this.rootEl.empty();

        if (this.state.filters.length === 0) {
            this.rootEl.createDiv('filter-popover__empty').setText(t('filter.noFilters'));
        } else {
            this.renderChildren(this.rootEl, this.state, [], 0);
        }

        this.renderFooterButtons(this.rootEl);
    }

    /**
     * Hold `next` and hand it to the owner. `redraw` draws the menu from it; `keep`
     * leaves the controls, which already show it. An edit that changed
     * nothing tells no one.
     */
    private commit(next: FilterState, after: 'redraw' | 'keep'): void {
        if (next === this.state) return;
        this.state = next;
        if (after === 'redraw') this.renderContent();
        this.options?.onChange(next);
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
     *
     * The editor belongs to one drawing of the menu. A control of a drawing
     * that is gone (a field taken out by a redraw, whose blur comes as it
     * goes) reads the row as it was drawn and edits nothing: what it would
     * write was made for a row that is not there any more.
     */
    private editorAt<C extends FilterCondition>(path: NodePath, isKind: (c: FilterCondition) => c is C): ConditionEditor<C> {
        const drawn = this.drawing;
        const read = (): C => {
            const node = nodeAt(this.state, path);
            if (!isFilterCondition(node) || !isKind(node)) throw new Error(`filter menu: the row at [${path.join(', ')}] changed kind under its controls`);
            return node;
        };
        const asDrawn = read();
        const current = (): C => (drawn === this.drawing ? read() : asDrawn);
        return {
            current,
            update: (edit, after) => {
                if (drawn !== this.drawing) return;
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

        // Target dropdown: the parent spelled out, the task itself a subtle
        // icon. A period row asks about the task itself only: its icon is
        // there, and turns to nothing.
        const onParent = condition.target === 'parent';
        const targetBtn = headerLine.createEl('button', {
            cls: onParent ? 'filter-popover__dropdown filter-popover__dropdown--target' : 'filter-popover__dropdown filter-popover__dropdown--target-self',
        });
        setIcon(targetBtn.createSpan('filter-popover__dropdown-icon'), onParent ? 'arrow-up' : 'user');
        if (onParent) targetBtn.createSpan().setText(t('filter.parent'));
        if (isPeriodCondition(condition)) {
            targetBtn.disabled = true;
        } else {
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
            if (isDateRow(condition)) {
                this.conditionRenderer.renderDateValueSelector(valueLine, this.editorAt(path, isDateRow));
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
