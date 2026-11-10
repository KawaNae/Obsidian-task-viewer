/**
 * The markdown frames of Timeline's and Calendar's sidebar: what the list
 * frames' `TaskListSections` is to the lists. Each frame is a reader of its
 * note (`MarkdownFrameReader`) and a view that draws what was read
 * (`MarkdownFrameView`), kept by the frame's id while the frame is in the
 * view's state.
 *
 * The frames sit in the sidebar's panel (`SidebarFrames`), which holds them
 * in the view's state and stacks their elements; what the panel does for
 * them is its placement's (`MarkdownFramePlacement`), the only way a frame
 * writes anything. The panel has the frames take the state's frames and
 * folds (`sync`) as soon as the state changes, before it draws, so a frame
 * in the state always has its reader, which knows the note it found and
 * the path it found it at. `sync` is the one way a link or a fold reaches a
 * frame. The panel's draw asks for each frame's element where it stands
 * (`elementOf`).
 *
 * The frames follow their notes through this, which hears the vault once
 * for all of them: a note written to is read again, a note a frame found
 * that is at another path now has the frame's link written to that path,
 * through the placement, and a note made, moved or deleted has every frame
 * look again for the note its link names. A saved setting has them read
 * again, since the keys a section's style is read by are settings.
 *
 * A body that measures the room it has (a chart) is rendered once the panel
 * stands in a document, styled by the plugin's stylesheet (`canRender`).
 */

import type { EventRef, HoverParent, Menu } from 'obsidian';
import { t } from '../../i18n';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import type { PluginContext } from '../../PluginContext';
import { frameLinkAt } from '../../services/data/MarkdownFrames';
import type { SidebarFrame } from '../../types';
import { openLink } from '../../utils/NavigationUtils';
import type { SectionHeaderClasses } from '../sharedUI/ListSectionRenderer';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { MarkdownFrameReader } from './MarkdownFrameReader';
import { MarkdownFrameView } from './MarkdownFrameView';

/** What the markdown frames read and draw with: the plugin, and how a link drawn in a body is opened and previewed. */
export interface MarkdownFrameDeps {
    plugin: PluginContext;
    /** Opens and previews a link drawn in a markdown frame, as a link on a card. */
    links: TaskLinkInteractionManager;
    /** Where a link's hover preview hangs. */
    getHoverParent(): HoverParent;
}

/** Where the markdown frames sit, and what only that place does. It holds the frames. */
export interface MarkdownFramePlacement {
    /** The look of a frame's header row in this place. */
    rowClasses: SectionHeaderClasses;
    /** Write the markdown frames `links` names with the links it gives, by id, at once. */
    relink(links: ReadonlyMap<string, string>): void;
    /** Write whether the frame `id` is collapsed; the frame already shows it. */
    setCollapsed(id: string, collapsed: boolean): void;
    /** Take the frame `id` out. */
    remove(id: string): void;
    /** The ⋯ menu's items of this place, below the frame's own. */
    appendMenuItems(menu: Menu, id: string): void;
    /** Whether the view masks now: a section's mask is shown in place of its body. */
    masked(): boolean;
}

/** One markdown frame: what reads its note, and what draws it. */
interface MarkdownFramePair {
    reader: MarkdownFrameReader;
    view: MarkdownFrameView;
}

/**
 * The custom property the plugin's stylesheet sets on the panel's element
 * (`_sidebar.css`), by which the frames tell the stylesheet is applied.
 */
const STYLESHEET_MARK = '--tv-sidebar-frames-styled';

export class MarkdownFrameSections {
    /** The markdown frames, by frame id. One lives while its frame is in the state. */
    private readonly frames = new Map<string, MarkdownFramePair>();
    private readonly heard: EventRef[] = [];
    private opened = false;
    /** Whether the plugin's stylesheet was seen applied to the container. It stays applied while the plugin runs. */
    private styled = false;
    /** Ends the wait for the stylesheet; null while none is waited for. */
    private stopAwaitingStylesheet: (() => void) | null = null;

    /** `container` is the element the frames are stacked in, whose place in a document and style tell when a body can be rendered. */
    constructor(
        private readonly deps: MarkdownFrameDeps,
        private readonly placement: MarkdownFramePlacement,
        private readonly container: HTMLElement,
    ) {}

    /** Start following the notes of the frames. */
    open(): void {
        this.opened = true;
        const { vault, workspace } = this.deps.plugin.app;
        this.heard.push(
            vault.on('modify', (file) => {
                for (const { reader } of this.frames.values()) {
                    if (reader.shows(file)) void reader.read();
                }
            }),
            vault.on('create', () => this.followNotes()),
            vault.on('delete', () => this.followNotes()),
            vault.on('rename', () => this.noteMoved()),
        );
        // A view opened with the workspace is opened before the vault's
        // files are all known: the notes are looked for once they are.
        workspace.onLayoutReady(() => this.followNotes());
    }

    /** Stop following, and end every frame. */
    close(): void {
        this.opened = false;
        const { vault } = this.deps.plugin.app;
        for (const ref of this.heard.splice(0)) vault.offref(ref);
        this.stopAwaitingStylesheet?.();
        for (const frame of this.frames.values()) this.end(frame);
        this.frames.clear();
    }

    /**
     * The settings were saved: the keys a section's style is read by may
     * have changed, so the notes are read again. Which note a link names
     * reads no setting, so the frames do not look for their notes again.
     */
    settingsSaved(): void {
        if (!this.opened) return;
        for (const { reader } of this.frames.values()) void reader.read();
    }

    /**
     * Have the frames be those of `frames`, the state's: a frame that is
     * not among them is ended and its element taken out, one that is new is
     * made and follows its note once the notes are known, and one that is
     * kept takes its link and its fold (`collapsed`, by id). Called whenever
     * the state's frames or folds change, and when the panel opens.
     */
    sync(frames: readonly SidebarFrame[], collapsed: Readonly<Record<string, boolean>>): void {
        const markdown = frames.filter(frame => frame.kind === 'markdown');
        const ids = new Set(markdown.map(frame => frame.id));
        for (const [id, frame] of this.frames) {
            if (ids.has(id)) continue;
            this.end(frame);
            this.frames.delete(id);
        }
        for (const frame of markdown) {
            const folded = collapsed[frame.id] ?? false;
            const kept = this.frames.get(frame.id);
            if (kept) {
                kept.reader.setLink(frame.link);
                kept.view.setCollapsed(folded);
            } else {
                this.make(frame.id, frame.link, folded);
            }
        }
    }

    /** The element of the frame `id`; it has to be among the frames last synced. */
    elementOf(id: string): HTMLElement {
        const frame = this.frames.get(id);
        if (!frame) throw new Error(`[MarkdownFrameSections] no markdown frame "${id}"`);
        return frame.view.root;
    }

    /** Whether `el` is the element of one of the frames. */
    holds(el: Element): boolean {
        for (const { view } of this.frames.values()) {
            if (view.root === el) return true;
        }
        return false;
    }

    /**
     * Have every frame's card show what it shows now: a change of the
     * view's masking comes in here, and a body that waited is rendered once
     * it can be.
     */
    paint(): void {
        for (const { view } of this.frames.values()) view.paint();
    }

    /**
     * The container may stand where a body can be rendered now: put into a
     * sidebar, or styled. The frames are painted when it can, and the wait
     * for the stylesheet ends.
     */
    placed(): void {
        if (this.frames.size === 0 || !this.canRender()) return;
        this.stopAwaitingStylesheet?.();
        this.paint();
    }

    private make(id: string, link: string, collapsed: boolean): void {
        const { plugin, links, getHoverParent } = this.deps;
        const reader = new MarkdownFrameReader(
            { app: plugin.app, settings: () => plugin.settings },
            link,
            read => view.show(read),
        );
        const view: MarkdownFrameView = new MarkdownFrameView({
            app: plugin.app,
            rowClasses: this.placement.rowClasses,
            canRender: () => this.canRender(),
            bindLinks: (el, sourcePath) => links.bind(el, {
                sourcePath,
                hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
                hoverParent: getHoverParent(),
            }),
            masked: () => this.placement.masked(),
            collapsedChanged: next => this.placement.setCollapsed(id, next),
            showMenu: event => this.showMenu(id, reader, event),
            remove: () => this.placement.remove(id),
        }, id, reader.untitled(), collapsed);
        this.frames.set(id, { reader, view });
        if (this.notesKnown()) reader.follow();
    }

    private end({ reader, view }: MarkdownFramePair): void {
        reader.close();
        view.close();
        view.root.remove();
    }

    /**
     * Whether the notes can be looked for: the frames follow them, and the
     * vault's files are known. While the vault loads it reports each file
     * as made, and a note not reported yet is not a note that is not there.
     */
    private notesKnown(): boolean {
        return this.opened && this.deps.plugin.app.workspace.layoutReady;
    }

    /** Have every frame look for the note its link names now. */
    private followNotes(): void {
        if (!this.notesKnown()) return;
        for (const { reader } of this.frames.values()) reader.follow();
    }

    /**
     * A file was renamed or moved. A frame whose note is at another path
     * than it was found at keeps showing it: its link is written to the new
     * path, through the placement, which has the frames take it at once
     * (`sync`). Which frames those are is asked of what each frame found,
     * whichever file was reported: a folder renamed is reported first, its
     * notes' paths still old, and then each of its notes, once its path is
     * new.
     * Every frame then looks for its note again, since a name a link
     * resolved may name another file now.
     */
    private noteMoved(): void {
        if (!this.notesKnown()) return;
        const moved = new Map<string, string>();
        for (const [id, { reader }] of this.frames) {
            const path = reader.movedTo();
            if (path === null) continue;
            const link = frameLinkAt(reader.link, path);
            if (link !== reader.link) moved.set(id, link);
        }
        if (moved.size > 0) this.placement.relink(moved);
        this.followNotes();
    }

    /**
     * Whether a body can be rendered: the container stands in a document,
     * styled by the plugin's stylesheet. Obsidian applies a plugin's
     * stylesheet after the plugin has loaded, and a view the load opens is
     * drawn before that, its sidebar as wide as the view; a chart rendered
     * then keeps that width. A container found unstyled has the frames
     * painted once the stylesheet is applied; one that is in no document
     * has them painted when the panel is put into a sidebar (`placed`).
     */
    private canRender(): boolean {
        if (!this.container.isConnected) return false;
        if (!this.styled) {
            this.styled = getComputedStyle(this.container).getPropertyValue(STYLESHEET_MARK).trim() !== '';
            if (!this.styled) this.awaitStylesheet();
        }
        return this.styled;
    }

    /**
     * Paint the frames once the stylesheet is applied. A stylesheet is
     * applied as a style element put into the document's head, so that is
     * what is waited for.
     */
    private awaitStylesheet(): void {
        if (this.stopAwaitingStylesheet) return;
        const observer = new MutationObserver(() => this.placed());
        observer.observe(this.container.ownerDocument.head, { childList: true });
        this.stopAwaitingStylesheet = () => {
            observer.disconnect();
            this.stopAwaitingStylesheet = null;
        };
    }

    /** The ⋯ menu of the frame `id`: open its note, when there is one, then the placement's items. */
    private showMenu(id: string, reader: MarkdownFrameReader, event: MouseEvent): void {
        const { plugin } = this.deps;
        plugin.menuPresenter.present((menu) => {
            if (reader.note) {
                menu.addItem(item => item
                    .setTitle(t('sidebar.openNote'))
                    .setIcon('file-text')
                    .onClick(() => openLink(plugin.app, reader.link, '', plugin.settings.reuseExistingTab)));
            }
            this.placement.appendMenuItems(menu, id);
        }, { kind: 'mouseEvent', event });
    }
}
