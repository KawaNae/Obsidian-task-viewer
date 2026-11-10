/**
 * The frames of Timeline's and Calendar's sidebar: the sidebar's panel.
 *
 * The panel holds the frames (`SidebarFrame`): it stacks them down the
 * sidebar in the order of the view's state, adds one, moves and removes one
 * and writes which are collapsed, each by the frame's id. What a frame shows
 * is its kind's (`drawFrame`). A list frame is a saved list, drawn by
 * `TaskListSections`, whose placement the panel is. A markdown frame is a
 * section of a note, drawn by a `MarkdownFrameView` the panel keeps by the
 * frame's id. The panel draws itself on a change of its fields of the state
 * and of the tasks, so a change of the frames does not draw the view.
 *
 * A draw makes every list frame anew, its cards kept by key, and leaves a
 * markdown frame's element where it stands: what a note's blocks drew in it
 * (a query, a chart) is not made again for a change of the tasks, and an
 * element taken out and put back would load what it embeds again. Only a
 * markdown frame out of its place is moved, which is one the user moved.
 *
 * The markdown frames follow their notes through the panel, which hears the
 * vault once for all of them: a note written to is read again, a note
 * renamed or moved has its frame's link written to the new path, and a note
 * made, moved or deleted has every frame look again for the note its link
 * names. A saved setting has them read again, since the keys a section's
 * style is read by are settings.
 *
 * The panel's element outlives the view's draws: the view takes it out
 * before it empties its DOM (`lift`) and puts it back into the sidebar it
 * built (`mount`), so the pages, the opened cards and the markdown frames'
 * bodies are kept.
 */

import { setIcon, type HoverParent, type Menu, type TAbstractFile } from 'obsidian';
import { t } from '../../i18n';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { listFrame, listFramesOf, type MarkdownFrame, type SidebarFrame } from '../../types';
import { frameLinkAt } from '../../services/data/MarkdownFrames';
import type { FilterState } from '../../services/filter/FilterTypes';
import { HostFrameScheduler } from '../../utils/HostWindow';
import { openLink } from '../../utils/NavigationUtils';
import { CardReconciler } from '../sharedUI/CardReconciler';
import { shouldRenderForChanges } from '../sharedUI/RenderScheduler';
import type { ListSectionClasses, SectionHeaderClasses } from '../sharedUI/ListSectionRenderer';
import { TaskListSections, newList, type ListDrawContext, type ListSectionDeps } from '../sharedUI/TaskListSections';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { MarkdownFrameView, isNote, type MarkdownFrameHost } from './MarkdownFrameView';

/** What the panel draws its frames with: what the lists read, and how a link a markdown frame draws is opened and previewed. */
export interface SidebarFramesDeps extends ListSectionDeps {
    /** Opens and previews a link drawn in a markdown frame, as a link on a card. */
    links: TaskLinkInteractionManager;
    /** Where a link's hover preview hangs. */
    getHoverParent: () => HoverParent;
}

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
 * The custom property the plugin's stylesheet sets on the panel's element
 * (`_sidebar.css`), by which the panel tells the stylesheet is applied.
 */
const STYLESHEET_MARK = '--tv-sidebar-frames-styled';

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
    /** The markdown frames drawn, by frame id. One lives while its frame is in the stack. */
    private readonly markdownFrames = new Map<string, MarkdownFrameView>();
    private readonly markdownHost: MarkdownFrameHost;
    /** The window's animation frames, in which a requested draw runs. */
    private readonly animationFrames = new HostFrameScheduler(() => this.el);
    private pendingDraw: number | null = null;
    private readonly unsubscribers: (() => void)[] = [];
    private opened = false;
    /** Whether the plugin's stylesheet was seen applied to the panel. It stays applied while the plugin runs. */
    private styled = false;
    /** Ends the wait for the stylesheet; null while none is waited for. */
    private stopAwaitingStylesheet: (() => void) | null = null;

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
        this.markdownHost = {
            app: deps.plugin.app,
            settings: () => deps.plugin.settings,
            rowClasses: MARKDOWN_FRAME_ROW_CLASSES,
            canRender: () => this.canRenderMarkdown(),
            bindLinks: (el, sourcePath) => deps.links.bind(el, {
                sourcePath,
                hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
                hoverParent: deps.getHoverParent(),
            }),
            setCollapsed: (id, collapsed) => this.setCollapsed(id, collapsed),
            masked: () => this.host.state().maskMode ?? false,
            showMenu: (frame, event) => this.showMarkdownFrameMenu(frame, event),
            remove: (id) => this.removeFrame(id),
        };
    }

    /**
     * Start drawing: now, and again on a change of the tasks or of the
     * panel's fields. Start following the notes of the markdown frames.
     */
    open(): void {
        this.opened = true;
        const { vault, workspace } = this.deps.plugin.app;
        const heard = [
            vault.on('modify', (file) => {
                for (const frame of this.markdownFrames.values()) {
                    if (frame.shows(file)) void frame.read();
                }
            }),
            vault.on('create', () => this.followNotes()),
            vault.on('delete', () => this.followNotes()),
            vault.on('rename', (file) => this.noteMoved(file)),
        ];
        this.unsubscribers.push(
            this.deps.index.onChange((_taskId, changes) => {
                if (shouldRenderForChanges(changes)) this.requestDraw();
            }),
            this.host.subscribe((patch) => {
                if (PANEL_FIELDS.some(key => key in patch)) this.requestDraw();
            }),
            ...heard.map(ref => () => vault.offref(ref)),
        );
        this.draw();
        // A view opened with the workspace is opened before the vault's
        // files are all known: the notes are looked for once they are.
        workspace.onLayoutReady(() => this.followNotes());
    }

    /** Stop drawing and following, close the popovers the frames opened, and end the markdown frames. */
    close(): void {
        this.opened = false;
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
        if (this.pendingDraw !== null) {
            this.animationFrames.cancel(this.pendingDraw);
            this.pendingDraw = null;
        }
        this.stopAwaitingStylesheet?.();
        this.sections.close();
        for (const frame of this.markdownFrames.values()) this.endMarkdownFrame(frame);
        this.markdownFrames.clear();
    }

    /** The settings were saved: the keys a section's style is read by may have changed, so the notes are read again. */
    settingsSaved(): void {
        if (!this.opened) return;
        this.followNotes();
        for (const frame of this.markdownFrames.values()) void frame.read();
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
        this.paintMarkdownFrames();
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
        // drew stays where it stands.
        const kept = this.keepMarkdownFramesOf(frames);
        for (const child of Array.from(this.el.children)) {
            if (!kept.has(child)) child.remove();
        }

        if (frames.length === 0) {
            this.el.createDiv('tv-sidebar__frames--empty').setText(t('sidebar.empty'));
        } else {
            const lists: ListDrawContext = {
                reconciler,
                collapsed: state.sidebarCollapsed ?? {},
                viewFilter: state.filterState,
            };
            this.sections.keepPagesOf(listFramesOf(frames));
            stackInOrder(this.el, frames.map(frame => this.drawFrame(frame, lists)));
        }
        reconciler.forEachStale(card => this.deps.taskRenderer.dispose(card));
    }

    /**
     * Draw `frame` as its kind is drawn, and give back its element, which
     * the caller puts in its place. `lists` is what a list frame's draw
     * reads. A list frame is made anew; a markdown frame is the one already
     * drawn for its id, shown with the frame's link and fold.
     */
    private drawFrame(frame: SidebarFrame, lists: ListDrawContext): HTMLElement {
        switch (frame.kind) {
            case 'list':
                return this.sections.drawList(this.el, frame, lists);
            case 'markdown':
                return this.markdownFrameOf(frame, lists.collapsed[frame.id] ?? false).root;
        }
    }

    // ==================== Markdown frames ====================

    /** End the markdown frames drawn that are not among `frames`, and give the elements of those that are. */
    private keepMarkdownFramesOf(frames: readonly SidebarFrame[]): Set<Element> {
        const ids = new Set(frames.filter(frame => frame.kind === 'markdown').map(frame => frame.id));
        const kept = new Set<Element>();
        for (const [id, frame] of this.markdownFrames) {
            if (ids.has(id)) {
                kept.add(frame.root);
            } else {
                this.endMarkdownFrame(frame);
                this.markdownFrames.delete(id);
            }
        }
        return kept;
    }

    /**
     * The markdown frame drawn for `frame`, made when there is none, with
     * the frame's link and fold, and its card showing what the state asks
     * now: a change of the view's masking is shown here.
     */
    private markdownFrameOf(frame: MarkdownFrame, collapsed: boolean): MarkdownFrameView {
        const drawn = this.markdownFrames.get(frame.id);
        if (drawn) {
            drawn.setLink(frame.link);
            drawn.setCollapsed(collapsed);
            drawn.paint();
            return drawn;
        }
        const made = new MarkdownFrameView(this.markdownHost, frame, collapsed);
        this.markdownFrames.set(frame.id, made);
        if (this.notesKnown()) made.follow();
        return made;
    }

    private endMarkdownFrame(frame: MarkdownFrameView): void {
        frame.close();
        frame.root.remove();
    }

    /**
     * Whether the notes can be looked for: the panel is open, and the
     * vault's files are known. While the vault loads it reports each file
     * as made, and a note not reported yet is not a note that is not there.
     */
    private notesKnown(): boolean {
        return this.opened && this.deps.plugin.app.workspace.layoutReady;
    }

    /** Have every markdown frame look for the note its link names now. */
    private followNotes(): void {
        if (!this.notesKnown()) return;
        for (const frame of this.markdownFrames.values()) frame.follow();
    }

    /**
     * `file` was renamed or moved. A frame that shows it keeps showing it:
     * its link is written to the note's new path, into the view's state.
     * Every frame then looks for its note again, since a name a link
     * resolved may name another file now.
     */
    private noteMoved(file: TAbstractFile): void {
        if (!this.notesKnown()) return;
        if (isNote(file)) {
            let moved = false;
            const frames = this.frames().map((frame) => {
                if (frame.kind !== 'markdown' || !this.markdownFrames.get(frame.id)?.shows(file)) return frame;
                const link = frameLinkAt(frame.link, file.path);
                if (link === frame.link) return frame;
                moved = true;
                return { ...frame, link };
            });
            if (moved) {
                for (const frame of frames) {
                    if (frame.kind === 'markdown') this.markdownFrames.get(frame.id)?.setLink(frame.link);
                }
                this.writeFrames(frames);
            }
        }
        this.followNotes();
    }

    /**
     * Whether a markdown frame's body can be rendered: the panel stands in
     * a document, styled by the plugin's stylesheet. Obsidian applies a
     * plugin's stylesheet after the plugin has loaded, and a view the load
     * opens is drawn before that, its sidebar as wide as the view; a chart
     * rendered then keeps that width. A panel found unstyled has the frames
     * painted once the stylesheet is applied; one that is in no document
     * has them painted when it is put into a sidebar (`mount`).
     */
    private canRenderMarkdown(): boolean {
        if (!this.el.isConnected) return false;
        if (!this.styled) {
            this.styled = getComputedStyle(this.el).getPropertyValue(STYLESHEET_MARK).trim() !== '';
            if (!this.styled) this.awaitStylesheet();
        }
        return this.styled;
    }

    /**
     * Paint the markdown frames once the stylesheet is applied. A
     * stylesheet is applied as a style element put into the document's
     * head, so that is what is waited for.
     */
    private awaitStylesheet(): void {
        if (this.stopAwaitingStylesheet) return;
        const observer = new MutationObserver(() => this.paintMarkdownFrames());
        observer.observe(this.el.ownerDocument.head, { childList: true });
        this.stopAwaitingStylesheet = () => {
            observer.disconnect();
            this.stopAwaitingStylesheet = null;
        };
    }

    /** Render the bodies of the markdown frames that are not rendered yet, when they can be. */
    private paintMarkdownFrames(): void {
        if (this.markdownFrames.size === 0 || !this.canRenderMarkdown()) return;
        this.stopAwaitingStylesheet?.();
        for (const frame of this.markdownFrames.values()) frame.paint();
    }

    /** The ⋯ menu of a markdown frame: open its note, when there is one, then the items every frame has. */
    private showMarkdownFrameMenu(frame: MarkdownFrameView, event: MouseEvent): void {
        const { plugin } = this.deps;
        plugin.menuPresenter.present((menu) => {
            if (frame.note) {
                menu.addItem(item => item
                    .setTitle(t('sidebar.openNote'))
                    .setIcon('file-text')
                    .onClick(() => openLink(plugin.app, frame.link, '', plugin.settings.reuseExistingTab)));
            }
            this.appendFrameMenuItems(menu, frame.id);
        }, { kind: 'mouseEvent', event });
    }

    // ==================== Every frame ====================

    private removeFrame(id: string): void {
        this.writeFrames(this.frames().filter(f => f.id !== id));
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
                .onClick(() => this.removeFrame(id));
            item.dom?.addClass('is-danger');
        });
    }
}
