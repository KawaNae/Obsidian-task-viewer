/**
 * The pinned lists of Timeline and Calendar: the sidebar's panel.
 *
 * The panel is the lists' placement (`TaskListSections`): it stacks them
 * down the sidebar, adds a list, reorders and removes them, and writes the
 * lists and which are collapsed into the view's state. It draws itself on a
 * change of its fields of the state and of the tasks, so a change of the
 * lists does not draw the view.
 *
 * The panel's element outlives the view's draws: the view takes it out
 * before it empties its DOM (`lift`) and puts it back into the sidebar it
 * built (`mount`), so the pages and the opened cards are kept.
 */

import { setIcon, type Menu } from 'obsidian';
import { t } from '../../i18n';
import type { PinnedListDefinition } from '../../types';
import type { FilterState } from '../../services/filter/FilterTypes';
import { HostFrameScheduler } from '../../utils/HostWindow';
import { CardReconciler } from './CardReconciler';
import { shouldRenderForChanges } from './RenderScheduler';
import type { ListSectionClasses } from './ListSectionRenderer';
import { TaskListSections, newList, type ListSectionDeps } from './TaskListSections';

/** The fields of a view's state the panel reads and writes. */
export interface PinnedListsState {
    pinnedLists?: PinnedListDefinition[];
    /** Which lists are collapsed, by list id. */
    pinnedListCollapsed?: Record<string, boolean>;
    filterState?: FilterState;
    maskMode?: boolean;
}

/** What the panel is handed of its view. */
export interface PinnedListPanelHost {
    state(): Readonly<PinnedListsState>;
    subscribe(listener: (patch: Readonly<Partial<PinnedListsState>>) => void): () => void;
    /** Change the view's state without drawing the view: the panel draws itself. */
    write(patch: Partial<PinnedListsState>): void;
}

/** The fields whose change the panel shows. */
const PANEL_FIELDS: readonly (keyof PinnedListsState)[] = ['pinnedLists', 'pinnedListCollapsed', 'filterState', 'maskMode'];

/** A compact row in the sidebar, with no card frame. */
const PINNED_LIST_CLASSES: ListSectionClasses = {
    root: 'pinned-list',
    collapsed: 'pinned-list--collapsed',
    header: 'pinned-list__header',
    toggle: 'pinned-list__toggle',
    name: 'pinned-list__name',
    count: 'pinned-list__count',
    button: 'pinned-list__header-btn',
    body: 'pinned-list__body',
    nameInput: 'pinned-list__name-input',
};

export class PinnedListPanel {
    private readonly el: HTMLElement;
    private readonly sections: TaskListSections;
    private readonly frames = new HostFrameScheduler(() => this.el);
    private pendingFrame: number | null = null;
    private readonly unsubscribers: (() => void)[] = [];

    constructor(
        private readonly deps: ListSectionDeps,
        private readonly host: PinnedListPanelHost,
    ) {
        this.el = document.createElement('div');
        this.el.addClass('tv-sidebar__pinned-lists');
        this.sections = new TaskListSections(deps, {
            classes: PINNED_LIST_CLASSES,
            scopePrefix: 'pl',
            replaceList: (id, patch) => this.writeLists(this.lists().map(l => l.id === id ? { ...l, ...patch } : l)),
            setCollapsed: (id, collapsed) => this.host.write({
                pinnedListCollapsed: { ...this.host.state().pinnedListCollapsed, [id]: collapsed },
            }),
            insertCopy: (list, copy) => {
                const next = [...this.lists()];
                next.splice(next.findIndex(l => l.id === list.id) + 1, 0, copy);
                this.writeLists(next);
            },
            appendMenuItems: (menu, list) => this.appendMenuItems(menu, list),
        });
    }

    /** Start drawing: now, and again on a change of the tasks or of the panel's fields. */
    open(): void {
        this.unsubscribers.push(
            this.deps.index.onChange((_taskId, changes) => {
                if (shouldRenderForChanges(changes)) this.requestDraw();
            }),
            this.host.subscribe((patch) => {
                if (PANEL_FIELDS.some(key => key in patch)) this.requestDraw();
            }),
        );
        this.draw();
    }

    /** Stop drawing, and close the popovers the lists opened. */
    close(): void {
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
        if (this.pendingFrame !== null) {
            this.frames.cancel(this.pendingFrame);
            this.pendingFrame = null;
        }
        this.sections.close();
    }

    /**
     * Take the lists out of the view's DOM. The view calls it before it
     * gathers its own cards and empties its DOM, so the lists' cards are
     * neither taken for the view's nor lost.
     */
    lift(): void {
        this.el.remove();
    }

    /** Put the panel into a sidebar the view built: the title and the add button, and the lists. */
    mount(header: HTMLElement, body: HTMLElement): void {
        header.createEl('p', { cls: 'tv-sidebar__panel-title', text: t('pinnedList.pinnedLists') });
        const addBtn = header.createEl('button', { cls: 'tv-icon-btn tv-sidebar__panel-add-btn' });
        setIcon(addBtn, 'plus');
        addBtn.appendText(t('pinnedList.addList'));
        addBtn.addEventListener('click', () => {
            const list = newList();
            // Its name is edited once it is drawn.
            this.sections.scheduleRename(list.id);
            this.writeLists([...this.lists(), list]);
        });
        body.appendChild(this.el);
    }

    private lists(): PinnedListDefinition[] {
        return this.host.state().pinnedLists ?? [];
    }

    private writeLists(lists: PinnedListDefinition[]): void {
        this.host.write({ pinnedLists: lists });
    }

    private requestDraw(): void {
        if (this.pendingFrame !== null) return;
        this.pendingFrame = this.frames.request(() => {
            this.pendingFrame = null;
            this.draw();
        });
    }

    private draw(): void {
        // Keep the cards already shown: a list added, removed or moved
        // reuses them by key.
        const reconciler = new CardReconciler();
        reconciler.detach(this.el);
        this.el.empty();

        const state = this.host.state();
        const lists = state.pinnedLists ?? [];
        if (lists.length === 0) {
            this.el.createDiv('tv-sidebar__pinned-lists--empty').setText(t('pinnedList.noPinnedLists'));
        } else {
            this.sections.draw(this.el, lists, {
                reconciler,
                collapsed: state.pinnedListCollapsed ?? {},
                viewFilter: state.filterState,
            });
        }
        reconciler.forEachStale(card => this.deps.taskRenderer.dispose(card));
    }

    /** Move up and down, and remove. */
    private appendMenuItems(menu: Menu, list: PinnedListDefinition): void {
        const lists = this.lists();
        const index = lists.findIndex(l => l.id === list.id);
        const swap = (a: number, b: number) => {
            const next = [...lists];
            [next[a], next[b]] = [next[b], next[a]];
            this.writeLists(next);
        };

        menu.addSeparator();
        if (index > 0) {
            menu.addItem(item => item
                .setTitle(t('menu.moveUp'))
                .setIcon('arrow-up')
                .onClick(() => swap(index - 1, index)));
        }
        if (index >= 0 && index < lists.length - 1) {
            menu.addItem(item => item
                .setTitle(t('menu.moveDown'))
                .setIcon('arrow-down')
                .onClick(() => swap(index, index + 1)));
        }
        menu.addSeparator();
        menu.addItem(item => {
            item.setTitle(t('menu.remove'))
                .setIcon('trash')
                .onClick(() => this.writeLists(lists.filter(l => l.id !== list.id)));
            item.dom?.addClass('is-danger');
        });
    }
}
