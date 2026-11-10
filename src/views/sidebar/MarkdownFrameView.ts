/**
 * One markdown frame of the sidebar, drawn: a header row carrying the name
 * of what it shows, which folds the frame, and under it a card holding the
 * section's body as rendered markdown.
 *
 * The frame finds its note as a link finds one (`noteAt`), reads the note's
 * lines and shows the section its link names (`readFrameContent`). When to
 * look again is the panel's to say (`SidebarFrames`, which hears the vault):
 * `follow` for which file the link names, `read` for what the file holds.
 *
 * The card is styled as a task of the section is: the section's color and
 * line style go on it through the properties a task card takes
 * (`TaskStyling`), and its surface and accent bar are the task card's
 * (`task-card__shape`).
 *
 * The body is rendered when it is first shown and when it, or the path it
 * is resolved against, changes; never for a change of the name or of the
 * style, and never while the frame is folded. A block another plugin draws
 * in it (a Dataview query, a chart) starts over at every render, and keeps
 * itself up to date between them. Each render has an element of its own, so
 * one that ends late adds nothing to the one that took its place.
 *
 * While the view masks (`MarkdownFrameHost.masked`), a section that has a
 * mask shows it in place of its body, as a masked task card shows it in
 * place of its text: the body is taken out, and rendered again once the
 * view stops masking or the mask is gone. The row's name and the style stay.
 *
 * A frame whose note or section is not there says which, in its card, and
 * offers to remove itself. It is shown again once the note or the section
 * is found.
 *
 * What the card shows is one of the three (`CardContent`), decided in one
 * place (`wanted`) from what was read and whether the view masks, and put
 * in by `paint`, which takes out what the card showed before.
 */

import { Component, MarkdownRenderer, type App, type TAbstractFile, type TFile } from 'obsidian';
import { t } from '../../i18n';
import { logError } from '../../log/log';
import { frameTarget, frameTitle, readFrameContent, type FrameReading } from '../../services/data/MarkdownFrames';
import { splitLines } from '../../services/persistence/FileLines';
import type { MarkdownFrame, TaskViewerSettings } from '../../types';
import { noteAt } from '../../utils/NoteLink';
import { renderSectionHeader, type SectionHeaderClasses, type SectionHeaderHandle } from '../sharedUI/ListSectionRenderer';
import { TaskStyling } from '../sharedUI/TaskStyling';

/** What a frame is handed of the panel that holds it. */
export interface MarkdownFrameHost {
    app: App;
    settings(): TaskViewerSettings;
    /** The look of the header row, which every frame of the panel shares. */
    rowClasses: SectionHeaderClasses;
    /**
     * Whether a body can be rendered now: a block that measures the room it
     * has (a chart) is rendered where the frame has its width. The panel
     * asks the frames to paint once it can.
     */
    canRender(): boolean;
    /**
     * Make the internal links under `el` open their notes and preview on
     * hover. Called again whenever the body's DOM changes, so it has to
     * leave a link it already took alone.
     */
    bindLinks(el: HTMLElement, sourcePath: string): void;
    /** Keep whether the frame `id` is collapsed; the frame already shows it. */
    setCollapsed(id: string, collapsed: boolean): void;
    /** Whether the view masks now: a section's mask is shown in place of its body. */
    masked(): boolean;
    /** Show the ⋯ menu of `frame`. */
    showMenu(frame: MarkdownFrameView, event: MouseEvent): void;
    /** Take the frame `id` out of the sidebar. */
    remove(id: string): void;
}

/**
 * What a frame's card shows under its shape:
 *
 * - `body`: the section's markdown, rendered against the note's path
 * - `mask`: the section's mask, in place of the body, while the view masks
 * - `missing`: that the note, or the section, is not there
 */
type CardContent =
    | { kind: 'body'; markdown: string; path: string }
    | { kind: 'mask'; text: string }
    | { kind: 'missing'; what: 'no-note' | 'no-heading' };

/** What a card shows, and the element it is drawn in; for a body, what its render registered too. */
interface CardShown {
    content: CardContent;
    el: HTMLElement;
    component: Component | null;
}

function sameContent(a: CardContent, b: CardContent): boolean {
    switch (a.kind) {
        case 'body': return b.kind === 'body' && a.markdown === b.markdown && a.path === b.path;
        case 'mask': return b.kind === 'mask' && a.text === b.text;
        case 'missing': return b.kind === 'missing' && a.what === b.what;
    }
}

export class MarkdownFrameView {
    readonly id: string;
    readonly root: HTMLElement;
    private readonly row: SectionHeaderHandle;
    private readonly card: HTMLElement;

    private frameLink: string;
    private collapsed: boolean;
    /** Whether `follow` was called: before it, the note is not looked for. */
    private following = false;
    /**
     * The note the link names, and the path it had when it was found: a
     * body is resolved against the path, so the same file at a new path is
     * another note to show.
     */
    private found: { file: TFile; path: string } | null = null;
    /** What was read last; null before the first reading. */
    private reading: FrameReading | null = null;
    /** Counts the readings begun, so that one overtaken by a later one is dropped. */
    private reads = 0;

    /** What the card shows; null while it shows nothing. */
    private shown: CardShown | null = null;

    /**
     * Build the frame's element, with the name its link gives it and no
     * body. `follow` turns it to its note; the caller puts `root` in place.
     */
    constructor(
        private readonly host: MarkdownFrameHost,
        frame: MarkdownFrame,
        collapsed: boolean,
    ) {
        this.id = frame.id;
        this.frameLink = frame.link;
        this.collapsed = collapsed;

        this.root = document.createElement('div');
        this.root.addClass('markdown-frame');
        this.root.dataset.frameId = frame.id;

        this.row = renderSectionHeader(this.root, {
            classes: host.rowClasses,
            name: frameTitle(frame.link, { kind: 'no-note' }, null),
            collapsed,
            onMoreClick: (_anchorEl, event) => host.showMenu(this, event),
            onCollapsedChange: (next) => {
                this.applyCollapsed(next);
                host.setCollapsed(this.id, next);
            },
        });

        this.card = this.root.createDiv('markdown-frame__card');
        this.card.createDiv('task-card__shape');
    }

    /** The link the frame shows the section of. */
    get link(): string {
        return this.frameLink;
    }

    /** The note found for the link; null when there is none, or it was not looked for yet. */
    get note(): TFile | null {
        return this.found?.file ?? null;
    }

    /** The frame's link is `link` now: its note is looked for and read anew. */
    setLink(link: string): void {
        if (link === this.frameLink) return;
        this.frameLink = link;
        if (this.following) this.turnTo(noteAt(this.host.app.metadataCache, frameTarget(link).path));
    }

    /** Show the frame collapsed or not, as the view's state has it. */
    setCollapsed(collapsed: boolean): void {
        if (collapsed === this.collapsed) return;
        this.row.setCollapsed(collapsed);
        this.applyCollapsed(collapsed);
    }

    /**
     * Turn to the note the link names now, and read it, unless it is the
     * note already shown, at the path it was found at. Called first once
     * the vault's files are known, and whenever a file made, moved or
     * deleted may have changed which note that is.
     */
    follow(): void {
        const file = noteAt(this.host.app.metadataCache, frameTarget(this.frameLink).path);
        if (this.following && file === this.note && file?.path === this.found?.path) return;
        this.following = true;
        this.turnTo(file);
    }

    /** Read the note again and show what the link names of it now. */
    async read(): Promise<void> {
        const { found } = this;
        if (!found) return;
        const turn = ++this.reads;
        let content: string;
        try {
            content = await this.host.app.vault.cachedRead(found.file);
        } catch (e) {
            logError(`[MarkdownFrame] reading ${found.path} failed: ${e instanceof Error ? e.message : String(e)}`, { notice: false });
            return;
        }
        if (turn !== this.reads) return;
        this.show(readFrameContent(splitLines(content).lines, frameTarget(this.frameLink).subpath, this.host.settings()));
    }

    /**
     * Have the card show what the frame shows now (`wanted`), unless it
     * shows that already. A body waits while the frame is folded or cannot
     * be rendered yet (`MarkdownFrameHost.canRender`), and the card keeps
     * what it shows until then; the rest is shown at once. Called when what
     * was read changes, at the unfold, when the panel can render, and at
     * each draw of the panel, which is where a change of the view's masking
     * comes in.
     */
    paint(): void {
        const wanted = this.wanted();
        if (!wanted || (this.shown && sameContent(this.shown.content, wanted))) return;
        if (wanted.kind === 'body' && (this.collapsed || !this.host.canRender())) return;

        this.clearCard();
        this.root.toggleClass('markdown-frame--missing', wanted.kind === 'missing');
        switch (wanted.kind) {
            case 'body':
                this.shown = this.renderBody(wanted);
                break;
            case 'mask':
                this.shown = { content: wanted, el: this.card.createDiv({ cls: 'markdown-frame__mask', text: wanted.text }), component: null };
                break;
            case 'missing':
                this.shown = { content: wanted, el: this.drawMissing(wanted.what), component: null };
                break;
        }
    }

    /** End what the body's render registered, and drop a reading under way. The caller takes `root` out. */
    close(): void {
        this.reads++;
        this.clearCard();
    }

    /** Whether the note shown is `file`. */
    shows(file: TAbstractFile): boolean {
        return this.found?.file === file;
    }

    /** Show `file` as the frame's note, read anew; null for no note. A reading under way is dropped. */
    private turnTo(file: TFile | null): void {
        this.reads++;
        this.found = file ? { file, path: file.path } : null;
        if (file) void this.read();
        else this.show({ kind: 'no-note' });
    }

    /** Show `reading`: its name, its style, and in the card what it gives. */
    private show(reading: FrameReading): void {
        this.reading = reading;
        this.row.nameEl.setText(frameTitle(this.frameLink, reading, this.note?.basename ?? null));

        const section = 'markdown' in reading ? reading : null;
        TaskStyling.applyTaskColor(this.card, section?.color ?? null);
        TaskStyling.applyTaskLinestyle(this.card, section?.linestyle ?? null);
        this.paint();
    }

    /**
     * What the card is to show of what was read: the mask while the view
     * masks and the section has one, else the body; or what is not there.
     * Null before the first reading.
     */
    private wanted(): CardContent | null {
        const { reading, found } = this;
        if (!reading) return null;
        if (!('markdown' in reading)) return { kind: 'missing', what: reading.kind };
        if (!found) return null;
        if (reading.mask !== null && this.host.masked()) return { kind: 'mask', text: reading.mask };
        return { kind: 'body', markdown: reading.markdown, path: found.path };
    }

    /** Render `body` into an element of its own in the card, with a Component of its own. */
    private renderBody(body: CardContent & { kind: 'body' }): CardShown {
        const el = this.card.createDiv('markdown-frame__content markdown-rendered');
        const component = new Component();
        component.load();

        // The links are taken as they come into the body: with the render,
        // and whenever a block in it draws itself again later.
        const observer = new MutationObserver(() => this.host.bindLinks(el, body.path));
        observer.observe(el, { childList: true, subtree: true });
        component.register(() => observer.disconnect());

        MarkdownRenderer.render(this.host.app, body.markdown, el, body.path, component)
            .catch((e: unknown) => {
                logError(`[MarkdownFrame] markdown render failed: ${e instanceof Error ? e.message : String(e)}`, { notice: false });
            });
        return { content: body, el, component };
    }

    /** Say in the card that the note (`no-note`) or the section (`no-heading`) is not there, and offer Remove. */
    private drawMissing(what: 'no-note' | 'no-heading'): HTMLElement {
        const el = this.card.createDiv('markdown-frame__missing');
        el.createDiv({
            cls: 'markdown-frame__missing-reason',
            text: t(what === 'no-note' ? 'sidebar.noteNotFound' : 'sidebar.sectionNotFound'),
        });
        const removeBtn = el.createEl('button', { cls: 'markdown-frame__missing-remove', text: t('menu.remove') });
        removeBtn.addEventListener('click', () => this.host.remove(this.id));
        return el;
    }

    private applyCollapsed(collapsed: boolean): void {
        this.collapsed = collapsed;
        // The card is hidden by the row's class, not taken out: what is
        // drawn in it stays as it is. A body that changed meanwhile is
        // rendered now.
        if (!collapsed) this.paint();
    }

    /** Take out what the card shows, and end what a body's render registered. */
    private clearCard(): void {
        if (!this.shown) return;
        this.shown.component?.unload();
        this.shown.el.remove();
        this.shown = null;
    }
}
