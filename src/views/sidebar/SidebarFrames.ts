/**
 * The frames of Timeline's and Calendar's sidebar: the sidebar's panel.
 *
 * The panel holds the frames (`SidebarFrame`): it stacks them down the
 * sidebar in the order of the view's state, adds one, moves and removes one,
 * writes which are collapsed and writes a markdown frame's link, each by the
 * frame's id. What a frame shows is its kind's (`drawFrame`). A list frame is
 * a saved list, drawn by `TaskListSections`; a markdown frame is a section
 * of a note, drawn by `MarkdownFrameSections`. The panel is the placement of
 * both. The panel draws itself on a change of its fields of the state and of
 * the tasks, so a change of the frames does not draw the view. The markdown
 * frames take a change of the frames or folds at once, not at the draw,
 * which only puts their elements in place.
 *
 * A draw makes every list frame anew, its cards kept by key, and leaves a
 * markdown frame's element where it stands: what a note's blocks drew in it
 * (a query, a chart) is not made again for a change of the tasks, and an
 * element taken out and put back would load what it embeds again. Only a
 * markdown frame out of its place is moved, which is one the user moved.
 *
 * The panel's element outlives the view's draws: the view takes it out
 * before it empties its DOM (`lift`) and puts it back into the sidebar it
 * built (`mount`), so the pages, the opened cards and the markdown frames'
 * bodies are kept.
 */

import { setIcon, type Menu } from 'obsidian';
import { t } from '../../i18n';
import { listFrame, listFramesOf, type SidebarFrame } from '../../types';
import type { FilterState } from '../../services/filter/FilterTypes';
import { HostFrameScheduler } from '../../utils/HostWindow';
import { CardReconciler } from '../sharedUI/CardReconciler';
import { shouldRenderForChanges } from '../sharedUI/RenderScheduler';
import type { ListSectionClasses, SectionHeaderClasses } from '../sharedUI/ListSectionRenderer';
import { TaskListSections, newList, type ListDrawContext, type ListSectionDeps } from '../sharedUI/TaskListSections';
import { MarkdownFrameSections, type MarkdownFrameDeps } from './MarkdownFrameSections';

/** What the panel draws its frames with: what the lists read, and what the markdown frames read. */
export interface SidebarFramesDeps extends ListSectionDeps, MarkdownFrameDeps {}

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

/** The header row of a frame, whatever its kind: a compact row in the sidebar. */
const ROW_CLASSES = {
    header: 'pinned-list__header',
    toggle: 'pinned-list__toggle',
    name: 'pinned-list__name',
    button: 'pinned-list__header-btn',
};

/** A list frame: the row, and the cards under it with no card frame. */
const PINNED_LIST_CLASSES: ListSectionClasses = {
    ...ROW_CLASSES,
    root: 'pinned-list',
    collapsed: 'pinned-list--collapsed',
    count: 'pinned-list__count',
    body: 'pinned-list__body',
    nameInput: 'pinned-list__name-input',
};

/** A markdown frame: the row, over a card of its own (`MarkdownFrameView`). */
const MARKDOWN_FRAME_ROW_CLASSES: SectionHeaderClasses = {
    ...ROW_CLASSES,
    collapsed: 'markdown-frame--collapsed',
};

/**
 * Put `wanted` in `parent`, in order, from its first child on. Only an
 * element that is not where it goes is moved, so of elements already there
 * in the order wanted none is taken out and put back.
 */
export function stackInOrder(parent: Pick<HTMLElement, 'children' | 'insertBefore'>, wanted: readonly HTMLElement[]): void {
    wanted.forEach((el, i) => {
        const at = parent.children[i] ?? null;
        if (at !== el) parent.insertBefore(el, at);
    });
}

export class SidebarFrames {
    private readonly el: HTMLElement;
    private readonly sections: TaskListSections;
    private readonly markdown: MarkdownFrameSections;
    /** The window's animation frames, in which a requested draw runs. */
    private readonly animationFrames = new HostFrameScheduler(() => this.el);
    private pendingDraw: number | null = null;
    private readonly unsubscribers: (() => void)[] = [];

    constructor(
        private readonly deps: SidebarFramesDeps,
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
        this.markdown = new MarkdownFrameSections(deps, {
            rowClasses: MARKDOWN_FRAME_ROW_CLASSES,
            relink: links => this.relink(links),
            setCollapsed: (id, collapsed) => this.setCollapsed(id, collapsed),
            remove: id => this.removeFrame(id),
            appendMenuItems: (menu, id) => this.appendFrameMenuItems(menu, id),
            masked: () => this.host.state().maskMode ?? false,
        }, this.el);
    }

    /**
     * Start drawing: now, and again on a change of the tasks or of the
     * panel's fields. Start following the notes of the markdown frames,
     * which take the state's frames and folds now and at once whenever they
     * change, ahead of the draw: a note renamed before the draw is followed
     * by the frame that shows it.
     */
    open(): void {
        this.markdown.open();
        this.syncMarkdown();
        this.unsubscribers.push(
            this.deps.index.onChange((_taskId, changes) => {
                if (shouldRenderForChanges(changes)) this.requestDraw();
            }),
            this.host.subscribe((patch) => {
                if ('sidebar' in patch || 'sidebarCollapsed' in patch) this.syncMarkdown();
                if (PANEL_FIELDS.some(key => key in patch)) this.requestDraw();
            }),
        );
        this.draw();
    }

    /** Stop drawing and following, close the popovers the frames opened, and end the markdown frames. */
    close(): void {
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
        if (this.pendingDraw !== null) {
            this.animationFrames.cancel(this.pendingDraw);
            this.pendingDraw = null;
        }
        this.sections.close();
        this.markdown.close();
    }

    /** The settings were saved: the markdown frames read their notes again (`MarkdownFrameSections.settingsSaved`). */
    settingsSaved(): void {
        this.markdown.settingsSaved();
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
        // A body that waited for the panel to stand in a sidebar is rendered now.
        this.markdown.placed();
    }

    /** Have the markdown frames be the state's, folded as it says. */
    private syncMarkdown(): void {
        const state = this.host.state();
        this.markdown.sync(state.sidebar ?? [], state.sidebarCollapsed ?? {});
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

        const state = this.host.state();
        const frames = state.sidebar ?? [];

        // What is drawn anew goes; what a markdown frame still in the stack
        // drew stays where it stands. The markdown frames are the state's
        // already: they took it when it changed.
        const collapsed = state.sidebarCollapsed ?? {};
        for (const child of Array.from(this.el.children)) {
            if (!this.markdown.holds(child)) child.remove();
        }

        if (frames.length === 0) {
            this.el.createDiv('tv-sidebar__frames--empty').setText(t('sidebar.empty'));
        } else {
            const lists: ListDrawContext = {
                reconciler,
                collapsed,
                viewFilter: state.filterState,
            };
            this.sections.keepPagesOf(listFramesOf(frames));
            stackInOrder(this.el, frames.map(frame => this.drawFrame(frame, lists)));
        }
        // A change of the view's masking is shown here, and a body made
        // before its frame stood in the panel is rendered now, at the width
        // it has there.
        this.markdown.paint();
        reconciler.forEachStale(card => this.deps.taskRenderer.dispose(card));
    }

    /**
     * Draw `frame` as its kind is drawn, and give back its element, which
     * the caller puts in its place. `lists` is what a list frame's draw
     * reads. A list frame is made anew; a markdown frame's element is the
     * one kept for its id, which took the frame's link and fold when the
     * state changed.
     */
    private drawFrame(frame: SidebarFrame, lists: ListDrawContext): HTMLElement {
        switch (frame.kind) {
            case 'list':
                return this.sections.drawList(this.el, frame, lists);
            case 'markdown':
                return this.markdown.elementOf(frame.id);
        }
    }

    // ==================== Every frame ====================

    /** Write the link `links` gives a markdown frame, by id, into each it names. A frame of another kind is left as it is. */
    private relink(links: ReadonlyMap<string, string>): void {
        let changed = false;
        const frames = this.frames().map((frame) => {
            if (frame.kind !== 'markdown') return frame;
            const link = links.get(frame.id);
            if (link === undefined || link === frame.link) return frame;
            changed = true;
            return { ...frame, link };
        });
        if (changed) this.writeFrames(frames);
    }

    private removeFrame(id: string): void {
        this.writeFrames(this.frames().filter(f => f.id !== id));
    }

    /**
     * Swap the frame `id` with the one `by` places from it, in the frames
     * the state holds now: the frames may have changed since the menu that
     * asks it was opened (a note renamed meanwhile rewrites a link). Nothing
     * moves when the frame is gone or at that end.
     */
    private moveFrame(id: string, by: -1 | 1): void {
        const next = [...this.frames()];
        const from = next.findIndex(f => f.id === id);
        const to = from + by;
        if (from < 0 || to < 0 || to >= next.length) return;
        [next[from], next[to]] = [next[to], next[from]];
        this.writeFrames(next);
    }

    /** The items every frame's menu has: move up and down, offered by where the frame stands as the menu opens, and remove. */
    private appendFrameMenuItems(menu: Menu, id: string): void {
        const frames = this.frames();
        const index = frames.findIndex(f => f.id === id);

        menu.addSeparator();
        if (index > 0) {
            menu.addItem(item => item
                .setTitle(t('menu.moveUp'))
                .setIcon('arrow-up')
                .onClick(() => this.moveFrame(id, -1)));
        }
        if (index >= 0 && index < frames.length - 1) {
            menu.addItem(item => item
                .setTitle(t('menu.moveDown'))
                .setIcon('arrow-down')
                .onClick(() => this.moveFrame(id, 1)));
        }
        menu.addSeparator();
        menu.addItem(item => {
            item.setTitle(t('menu.remove'))
                .setIcon('trash')
                .onClick(() => this.removeFrame(id));
            item.dom?.addClass('is-danger');
        });
    }
}
