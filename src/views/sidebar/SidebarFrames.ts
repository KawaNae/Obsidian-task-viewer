/**
 * The frames of Timeline's and Calendar's sidebar: the sidebar's panel.
 *
 * The panel holds the frames (`SidebarFrame`): it stacks them down the
 * sidebar in the order of the view's state, adds one, moves and removes one
 * and writes which are collapsed, each by the frame's id. What a frame shows
 * is its kind's (`drawFrame`). A list frame is a saved list, drawn by
 * `TaskListSections`, whose placement the panel is. The panel draws itself
 * on a change of its fields of the state and of the tasks, so a change of
 * the frames does not draw the view.
 *
 * The panel's element outlives the view's draws: the view takes it out
 * before it empties its DOM (`lift`) and puts it back into the sidebar it
 * built (`mount`), so the pages and the opened cards are kept. A draw
 * empties the element and draws every frame anew; the cards are kept by key.
 */

import { setIcon, type Menu } from 'obsidian';
import { t } from '../../i18n';
import { listFrame, listFramesOf, type SidebarFrame } from '../../types';
import type { FilterState } from '../../services/filter/FilterTypes';
import { HostFrameScheduler } from '../../utils/HostWindow';
import { CardReconciler } from '../sharedUI/CardReconciler';
import { shouldRenderForChanges } from '../sharedUI/RenderScheduler';
import type { ListSectionClasses } from '../sharedUI/ListSectionRenderer';
import { TaskListSections, newList, type ListDrawContext, type ListSectionDeps } from '../sharedUI/TaskListSections';

/** The fields of a view's state the panel reads and writes. */
export interface SidebarFramesState {
    /** The frames, in the order they are stacked. */
    sidebar?: SidebarFrame[];
    /** Which frames are collapsed, by frame id. */
    sidebarCollapsed?: Record<string, boolean>;
    filterState?: FilterState;
    maskMode?: boolean;
}

/** What the panel is handed of its view. */
export interface SidebarFramesHost {
    state(): Readonly<SidebarFramesState>;
    subscribe(listener: (patch: Readonly<Partial<SidebarFramesState>>) => void): () => void;
    /** Change the view's state without drawing the view: the panel draws itself. */
    write(patch: Partial<SidebarFramesState>): void;
}

/** The fields whose change the panel shows. */
const PANEL_FIELDS: readonly (keyof SidebarFramesState)[] = ['sidebar', 'sidebarCollapsed', 'filterState', 'maskMode'];

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

export class SidebarFrames {
    private readonly el: HTMLElement;
    private readonly sections: TaskListSections;
    /** The window's animation frames, in which a requested draw runs. */
    private readonly animationFrames = new HostFrameScheduler(() => this.el);
    private pendingDraw: number | null = null;
    private readonly unsubscribers: (() => void)[] = [];

    constructor(
        private readonly deps: ListSectionDeps,
        private readonly host: SidebarFramesHost,
    ) {
        this.el = document.createElement('div');
        this.el.addClass('tv-sidebar__frames');
        this.sections = new TaskListSections(deps, {
            classes: PINNED_LIST_CLASSES,
            scopePrefix: 'pl',
            replaceList: (id, patch) => this.writeFrames(this.frames().map(
                frame => frame.kind === 'list' && frame.id === id ? { ...frame, ...patch } : frame,
            )),
            setCollapsed: (id, collapsed) => this.setCollapsed(id, collapsed),
            insertCopy: (list, copy) => this.insertBelow(list.id, listFrame(copy)),
            appendMenuItems: (menu, list) => this.appendFrameMenuItems(menu, list.id),
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

    /** Stop drawing, and close the popovers the frames opened. */
    close(): void {
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
        if (this.pendingDraw !== null) {
            this.animationFrames.cancel(this.pendingDraw);
            this.pendingDraw = null;
        }
        this.sections.close();
    }

    /**
     * Take the frames out of the view's DOM. The view calls it before it
     * gathers its own cards and empties its DOM, so the frames' cards are
     * neither taken for the view's nor lost.
     */
    lift(): void {
        this.el.remove();
    }

    /** Put the panel into a sidebar the view built: the add button into its header, the frames into its body. */
    mount(header: HTMLElement, body: HTMLElement): void {
        const addBtn = header.createEl('button', { cls: 'tv-icon-btn tv-sidebar__panel-add-btn' });
        setIcon(addBtn, 'plus');
        addBtn.appendText(t('pinnedList.addList'));
        addBtn.addEventListener('click', () => {
            const list = newList();
            // Its name is edited once it is drawn.
            this.sections.scheduleRename(list.id);
            this.writeFrames([...this.frames(), listFrame(list)]);
        });
        body.appendChild(this.el);
    }

    private frames(): SidebarFrame[] {
        return this.host.state().sidebar ?? [];
    }

    private writeFrames(frames: SidebarFrame[]): void {
        this.host.write({ sidebar: frames });
    }

    /** Put `frame` right below the frame `id`. */
    private insertBelow(id: string, frame: SidebarFrame): void {
        const next = [...this.frames()];
        next.splice(next.findIndex(f => f.id === id) + 1, 0, frame);
        this.writeFrames(next);
    }

    /** Write whether the frame `id` is collapsed. */
    private setCollapsed(id: string, collapsed: boolean): void {
        this.host.write({
            sidebarCollapsed: { ...this.host.state().sidebarCollapsed, [id]: collapsed },
        });
    }

    private requestDraw(): void {
        if (this.pendingDraw !== null) return;
        this.pendingDraw = this.animationFrames.request(() => {
            this.pendingDraw = null;
            this.draw();
        });
    }

    private draw(): void {
        // Keep the cards already shown: a frame added, removed or moved
        // reuses them by key.
        const reconciler = new CardReconciler();
        reconciler.detach(this.el);
        this.el.empty();

        const state = this.host.state();
        const frames = state.sidebar ?? [];
        if (frames.length === 0) {
            this.el.createDiv('tv-sidebar__frames--empty').setText(t('sidebar.empty'));
        } else {
            const lists: ListDrawContext = {
                reconciler,
                collapsed: state.sidebarCollapsed ?? {},
                viewFilter: state.filterState,
            };
            this.sections.keepPagesOf(listFramesOf(frames));
            for (const frame of frames) this.drawFrame(frame, lists);
        }
        reconciler.forEachStale(card => this.deps.taskRenderer.dispose(card));
    }

    /** Draw `frame` at the end of the panel, as its kind is drawn. `lists` is what a list frame's draw reads. */
    private drawFrame(frame: SidebarFrame, lists: ListDrawContext): void {
        switch (frame.kind) {
            case 'list':
                this.sections.drawList(this.el, frame, lists);
                break;
        }
    }

    /** The items every frame's menu has: move up and down, and remove. */
    private appendFrameMenuItems(menu: Menu, id: string): void {
        const frames = this.frames();
        const index = frames.findIndex(f => f.id === id);
        const swap = (a: number, b: number) => {
            const next = [...frames];
            [next[a], next[b]] = [next[b], next[a]];
            this.writeFrames(next);
        };

        menu.addSeparator();
        if (index > 0) {
            menu.addItem(item => item
                .setTitle(t('menu.moveUp'))
                .setIcon('arrow-up')
                .onClick(() => swap(index - 1, index)));
        }
        if (index >= 0 && index < frames.length - 1) {
            menu.addItem(item => item
                .setTitle(t('menu.moveDown'))
                .setIcon('arrow-down')
                .onClick(() => swap(index, index + 1)));
        }
        menu.addSeparator();
        menu.addItem(item => {
            item.setTitle(t('menu.remove'))
                .setIcon('trash')
                .onClick(() => this.writeFrames(frames.filter(f => f.id !== id)));
            item.dom?.addClass('is-danger');
        });
    }
}
