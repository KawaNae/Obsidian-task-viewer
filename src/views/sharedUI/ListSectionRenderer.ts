/**
 * Renders one saved list as a collapsible section: a header carrying its name,
 * task count and sort / filter / more buttons, plus a body of task cards.
 *
 * Two places show the same thing. PinnedListRenderer stacks these down the
 * sidebar; KanbanView lays them out on a grid, one per cell. Before this file
 * each had its own copy of the header markup, the collapse toggle with its
 * lazy first-paint, and the inline rename lifecycle.
 *
 * The BEM block name is a parameter rather than something this module decides.
 * What genuinely differs between the two is how the section looks — a compact
 * sidebar row versus a card with its own background and border — and the block
 * name is the handle for that. Unifying the names would mean rewriting both
 * stylesheets to no benefit; the 2026-05-03 DOM naming audit reviewed
 * `kanban-view__cell-*` and passed it.
 */

import { setIcon } from 'obsidian';
import { hasConditions, type FilterState } from '../../services/filter/FilterTypes';
import { hasSortRules, type SortState } from '../../services/sort/SortTypes';

/** DOM class names for one variant of the section. */
export interface ListSectionClasses {
    /** Outermost element. */
    root: string;
    /** Added to `root` while collapsed. */
    collapsed: string;
    header: string;
    toggle: string;
    name: string;
    count: string;
    /** Shared by the sort, filter and more buttons. */
    button: string;
    body: string;
    /** Replaces `name` while an inline rename is in progress. */
    nameInput: string;
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
 * Build one section into `container` and return its parts, so callers can
 * reach the name element (for rename) or the body (for paging).
 */
export function renderListSection(
    container: HTMLElement,
    params: ListSectionParams,
): ListSectionHandle {
    const { classes } = params;

    const root = container.createDiv(classes.root);
    if (params.collapsed) root.addClass(classes.collapsed);

    const header = root.createDiv(classes.header);
    const toggle = header.createSpan({ text: params.collapsed ? '▶' : '▼', cls: classes.toggle });
    const nameEl = header.createSpan({ text: params.name, cls: classes.name });
    header.createSpan({ text: `(${params.taskCount})`, cls: classes.count });

    const sortBtn = makeHeaderButton(header, classes.button, 'arrow-up-down');
    if (params.sortState && hasSortRules(params.sortState)) sortBtn.addClass('is-sorted');
    sortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        params.onSortClick(sortBtn);
    });

    const filterBtn = makeHeaderButton(header, classes.button, 'filter');
    if (params.filterState && hasConditions(params.filterState)) filterBtn.addClass('is-filtered');
    filterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        params.onFilterClick(filterBtn);
    });

    const moreBtn = makeHeaderButton(header, classes.button, 'more-horizontal');
    moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        params.onMoreClick(moreBtn, e as MouseEvent);
    });

    const body = root.createDiv(classes.body);
    if (!params.collapsed) {
        params.renderBody(body, { resetPaging: false });
    }

    header.addEventListener('click', () => {
        const nextCollapsed = !root.classList.contains(classes.collapsed);
        if (nextCollapsed) {
            root.addClass(classes.collapsed);
            toggle.textContent = '▶';
        } else {
            root.removeClass(classes.collapsed);
            toggle.textContent = '▼';
            // First expansion: the body was never filled, so paint it now.
            if (body.childElementCount === 0 && params.taskCount > 0) {
                params.renderBody(body, { resetPaging: true });
            }
        }
        params.onCollapsedChange(nextCollapsed);
    });

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

    input.addEventListener('blur', () => commit(input.value.trim() || currentName));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
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
    const btn = header.createEl('button', { cls });
    setIcon(btn.createSpan(), icon);
    return btn;
}
