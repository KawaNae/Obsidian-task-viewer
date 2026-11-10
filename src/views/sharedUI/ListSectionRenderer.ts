/**
 * Renders one saved list as a collapsible section: a header carrying its name,
 * task count and sort / filter / more buttons, plus a body of task cards.
 *
 * `TaskListSections` builds every saved list with it: the pinned lists
 * stacked down the sidebar (`SidebarFrames`) and Kanban's cells on its
 * grid, one per cell.
 *
 * The header row is a part of its own (`renderSectionHeader`): the mark of
 * the fold, the name and the ⋯ button, and the fold a click on the row
 * works. A section that is no list (a markdown frame of the sidebar) is
 * headed by the same row.
 *
 * The BEM block name is a parameter rather than something this module decides.
 * What genuinely differs between the two is how the section looks — a compact
 * sidebar row versus a card with its own background and border — and the block
 * name is the handle for that. Unifying the names would mean rewriting both
 * stylesheets to no benefit, so `kanban-view__cell-*` keeps its name.
 */

import { setIcon } from 'obsidian';
import { hasConditions, type FilterState } from '../../services/filter/FilterTypes';
import { hasSortRules, type SortState } from '../../services/sort/SortTypes';
import { onFormEnter } from '../../modals/form/formEnter';

/** DOM class names of a section's header row, and of the fold it works. */
export interface SectionHeaderClasses {
    /** Added to the section's outermost element while collapsed. */
    collapsed: string;
    header: string;
    toggle: string;
    name: string;
    /** The ⋯ button's, shared with whatever other buttons the row is given. */
    button: string;
}

/** DOM class names for one variant of the section. */
export interface ListSectionClasses extends SectionHeaderClasses {
    /** Outermost element. */
    root: string;
    count: string;
    body: string;
    /** Replaces `name` while an inline rename is in progress. */
    nameInput: string;
}

export interface SectionHeaderParams {
    classes: SectionHeaderClasses;
    name: string;
    collapsed: boolean;
    /** Put what the section shows between its name and the ⋯ button into the row. */
    fill?: (header: HTMLElement) => void;
    onMoreClick: (anchorEl: HTMLElement, event: MouseEvent) => void;
    /** The row was clicked, and shows the section collapsed or not already. */
    onCollapsedChange: (collapsed: boolean) => void;
}

export interface SectionHeaderHandle {
    header: HTMLElement;
    nameEl: HTMLElement;
    /** Show the section collapsed or not: the class on its outermost element, and the row's mark. */
    setCollapsed(collapsed: boolean): void;
}

export interface ListSectionParams {
    classes: ListSectionClasses;
    /** Shown in the header, next to the count. */
    name: string;
    /** Rendered as `(n)`. */
    taskCount: number;
    collapsed: boolean;
    /** Marks the sort button active. */
    sortState: SortState | undefined;
    /** Marks the filter button active. */
    filterState: FilterState | undefined;
    /** Text between the count and the buttons is view-specific; leave it out. */
    onSortClick: (anchorEl: HTMLElement) => void;
    onFilterClick: (anchorEl: HTMLElement) => void;
    onMoreClick: (anchorEl: HTMLElement, event: MouseEvent) => void;
    onCollapsedChange: (collapsed: boolean) => void;
    /**
     * Fill the body with task cards. Called on the initial paint when the
     * section is expanded, and again the first time it is expanded by hand —
     * that second call passes `resetPaging`, since a body being painted for
     * the first time should start at page one.
     */
    renderBody: (body: HTMLElement, opts: { resetPaging: boolean }) => void;
}

export interface ListSectionHandle {
    root: HTMLElement;
    header: HTMLElement;
    nameEl: HTMLElement;
    body: HTMLElement;
}

/**
 * Build the header row of a section into `root`, the section's outermost
 * element: the mark of the fold, the name, what `fill` puts in, and the ⋯
 * button. A click on the row folds or unfolds the section, on `root`, and
 * then tells the caller, whose it is to fill what was unfolded and to keep
 * the fold.
 */
export function renderSectionHeader(root: HTMLElement, params: SectionHeaderParams): SectionHeaderHandle {
    const { classes } = params;

    const header = root.createDiv(classes.header);
    const toggle = header.createSpan({ cls: classes.toggle });
    const nameEl = header.createSpan({ text: params.name, cls: classes.name });
    params.fill?.(header);

    const moreBtn = makeHeaderButton(header, classes.button, 'more-horizontal');
    moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        params.onMoreClick(moreBtn, e as MouseEvent);
    });

    const setCollapsed = (collapsed: boolean) => {
        if (collapsed) root.addClass(classes.collapsed);
        else root.removeClass(classes.collapsed);
        toggle.textContent = collapsed ? '▶' : '▼';
    };
    setCollapsed(params.collapsed);

    header.addEventListener('click', () => {
        const collapsed = !root.classList.contains(classes.collapsed);
        setCollapsed(collapsed);
        params.onCollapsedChange(collapsed);
    });

    return { header, nameEl, setCollapsed };
}

/**
 * Build one section into `container` and return its parts, so callers can
 * reach the name element (for rename) or the body (for paging).
 */
export function renderListSection(
    container: HTMLElement,
    params: ListSectionParams,
): ListSectionHandle {
    const { classes } = params;

    const root = container.createDiv(classes.root);
    const { header, nameEl } = renderSectionHeader(root, {
        classes,
        name: params.name,
        collapsed: params.collapsed,
        fill: (row) => {
            row.createSpan({ text: `(${params.taskCount})`, cls: classes.count });

            const sortBtn = makeHeaderButton(row, classes.button, 'arrow-up-down');
            if (params.sortState && hasSortRules(params.sortState)) sortBtn.addClass('is-sorted');
            sortBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                params.onSortClick(sortBtn);
            });

            const filterBtn = makeHeaderButton(row, classes.button, 'filter');
            if (params.filterState && hasConditions(params.filterState)) filterBtn.addClass('is-filtered');
            filterBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                params.onFilterClick(filterBtn);
            });
        },
        onMoreClick: params.onMoreClick,
        onCollapsedChange: (collapsed) => {
            // First expansion: the body was never filled, so paint it now.
            if (!collapsed && body.childElementCount === 0 && params.taskCount > 0) {
                params.renderBody(body, { resetPaging: true });
            }
            params.onCollapsedChange(collapsed);
        },
    });

    const body = root.createDiv(classes.body);
    if (!params.collapsed) {
        params.renderBody(body, { resetPaging: false });
    }

    return { root, header, nameEl, body };
}

/**
 * Swap the name element for a text input and commit on blur or Enter; Escape
 * puts the old name back. The input swallows pointer events so that clicking
 * into it does not reach the header's collapse handler.
 */
export function startListSectionRename(
    nameEl: HTMLElement,
    classes: Pick<ListSectionClasses, 'name' | 'nameInput'>,
    currentName: string,
    onCommit: (newName: string) => void,
): void {
    const input = nameEl.ownerDocument.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = classes.nameInput;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = (newName: string) => {
        if (committed) return;
        committed = true;
        onCommit(newName);
        // Put a plain span back rather than re-rendering the whole section.
        const span = input.ownerDocument.createElement('span');
        span.className = classes.name;
        span.textContent = newName;
        if (input.parentElement) input.replaceWith(span);
    };

    // The form's Enter commits by itself: a blur does not come to a window
    // that is not in front, and a name left in the field then is lost.
    const commitTyped = () => commit(input.value.trim() || currentName);
    input.addEventListener('blur', commitTyped);
    onFormEnter(input, commitTyped);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); commit(currentName); }
    });
    // Keep the header's collapse handler out of it.
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
}

/**
 * Header buttons put the icon inside a span rather than directly in the
 * button: WebKit does not paint an SVG that is an immediate child of an
 * inline-flex button, which is what these are.
 */
function makeHeaderButton(header: HTMLElement, cls: string, icon: string): HTMLElement {
    const btn = header.createEl('button', { cls: `tv-icon-btn ${cls}` });
    setIcon(btn.createSpan(), icon);
    return btn;
}
