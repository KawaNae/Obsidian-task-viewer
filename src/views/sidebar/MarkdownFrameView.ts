/**
 * One markdown frame of the sidebar, drawn: a header row carrying the name
 * of what it shows, which folds the frame, and under it the cards of the
 * section (`MarkdownFrameCard`), one for each card the reading gives: the
 * lines under the section's own heading, when there are any, and the
 * section of each heading nested one level in it.
 *
 * What it shows is what the frame's reader read (`MarkdownFrameReader`),
 * handed to `show`; the view looks nothing up and reads no file.
 *
 * A card is styled as a task of its section is: the section's color and
 * line style go on it through the properties a task card takes
 * (`TaskStyling`), and its surface and accent bar are the task card's
 * (`task-card__shape`).
 *
 * A card's markdown is rendered when it is first shown and when it, or the
 * path it is resolved against, changes; never for a change of the name or
 * of the style, never for a change of another card, nor for a card added,
 * taken out or moved, and never while the frame is folded. The cards a
 * reading gives are met with the cards drawn by what each shows: one that
 * shows the same is kept, its element and what is rendered in it as they
 * are, and moved only when it is out of its place. A block another plugin
 * draws in a card (a Dataview query, a chart) starts over at every render
 * of that card, and keeps itself up to date between them; an iframe in a
 * card that is moved loads again.
 *
 * While the view masks (`MarkdownFrameViewHost.masked`), a card whose
 * section has a mask shows it in place of its markdown, as a masked task
 * card shows it in place of its text, under the card's heading when one
 * opens it: what was rendered is taken out, and rendered again once the
 * view stops masking or the mask is gone. The row's name and the style stay.
 *
 * A frame whose note or section is not there says which, in a card of its
 * own, and offers to choose its section again and to remove itself. It is
 * shown again once the note or the section is found.
 *
 * What the cards show is decided in one place (`wanted`) from what was read
 * and whether the view masks, and put in by `paint`.
 */

import type { App } from 'obsidian';
import { renderSectionHeader, type SectionHeaderClasses, type SectionHeaderHandle } from '../sharedUI/ListSectionRenderer';
import { MarkdownFrameCard, sameContent, type CardContent, type CardStyle } from './MarkdownFrameCard';
import type { FrameRead } from './MarkdownFrameReader';

/** What a frame's view is handed of the panel that holds it: what every frame shares, and what is its own frame's. */
export interface MarkdownFrameViewHost {
    app: App;
    /** The look of the header row, which every frame of the panel shares. */
    rowClasses: SectionHeaderClasses;
    /**
     * Whether markdown can be rendered now: a block that measures the room
     * it has (a chart) is rendered where the frame has its width. The panel
     * asks the frames to paint once it can.
     */
    canRender(): boolean;
    /**
     * Make the internal links under `el` open their notes and preview on
     * hover. Called again whenever a card's DOM changes, so it has to leave
     * a link it already took alone.
     */
    bindLinks(el: HTMLElement, sourcePath: string): void;
    /** Whether the view masks now: a section's mask is shown in place of its markdown. */
    masked(): boolean;
    /** The frame was folded or unfolded from its row; it already shows it. */
    collapsedChanged(collapsed: boolean): void;
    /** Show the frame's ⋯ menu. */
    showMenu(event: MouseEvent): void;
    /** Take the frame out of the sidebar. */
    remove(): void;
    /** Choose again the section the frame shows. */
    relink(): void;
}

/** What one card of the frame is to show, and how it is styled. */
interface WantedCard {
    content: CardContent;
    style: CardStyle;
}

const NO_STYLE: CardStyle = { color: null, linestyle: null, opensWithHeading: false };

export class MarkdownFrameView {
    readonly root: HTMLElement;
    private readonly row: SectionHeaderHandle;
    /** The element the cards stand in, in their order. */
    private readonly cardsEl: HTMLElement;

    private collapsed: boolean;
    /** What was read last; null before the first reading. */
    private read: FrameRead | null = null;
    /** The cards drawn, in their order; none before the first reading. */
    private cards: MarkdownFrameCard[] = [];

    /**
     * Build the frame `id`'s element, its row named `title`, with no card:
     * `show` gives it what was read. The caller puts `root` in place.
     */
    constructor(
        private readonly host: MarkdownFrameViewHost,
        id: string,
        title: string,
        collapsed: boolean,
    ) {
        this.collapsed = collapsed;

        this.root = document.createElement('div');
        this.root.addClass('markdown-frame');
        this.root.dataset.frameId = id;

        this.row = renderSectionHeader(this.root, {
            classes: host.rowClasses,
            name: title,
            collapsed,
            onMoreClick: (_anchorEl, event) => host.showMenu(event),
            onCollapsedChange: (next) => {
                this.applyCollapsed(next);
                host.collapsedChanged(next);
            },
        });

        this.cardsEl = this.root.createDiv('markdown-frame__cards');
    }

    /** Show `read`: its name, and its cards. */
    show(read: FrameRead): void {
        this.read = read;
        this.row.nameEl.setText(read.title);
        this.paint();
    }

    /** Show the frame collapsed or not, as the view's state has it. */
    setCollapsed(collapsed: boolean): void {
        if (collapsed === this.collapsed) return;
        this.row.setCollapsed(collapsed);
        this.applyCollapsed(collapsed);
    }

    /**
     * Have the cards be those the frame shows now (`wanted`), and each show
     * what it is to. A wanted card takes the first drawn card that is to
     * show the same; one that none is takes, in order, a drawn card no
     * wanted card took, which keeps what it shows while it waits to render
     * (`MarkdownFrameCard.paint`); and a card is made for each still left.
     * The drawn cards none took are ended. The cards are then put in their
     * order, moving only those out of their place.
     *
     * Markdown waits while the frame is folded, while its element stands in
     * no document (the frame is made as the state takes it, before the
     * panel puts it in place), or while it cannot be rendered yet
     * (`MarkdownFrameViewHost.canRender`). Called when what was read
     * changes, at the unfold, when the panel can render, and at each draw
     * of the panel, which is where a change of the view's masking comes in.
     */
    paint(): void {
        const wanted = this.wanted();
        if (wanted === null) return;

        const free = [...this.cards];
        const taken: (MarkdownFrameCard | null)[] = wanted.map(({ content }) => {
            const at = free.findIndex(card => sameContent(card.content, content));
            return at < 0 ? null : free.splice(at, 1)[0];
        });
        const cards = wanted.map(({ content, style }, i) => {
            const card = taken[i] ?? free.shift() ?? new MarkdownFrameCard(this.host, content, style);
            card.set(content, style);
            return card;
        });
        for (const card of free) this.end(card);
        this.cards = cards;

        cards.forEach((card, i) => {
            const there = this.cardsEl.children[i] ?? null;
            if (there !== card.el) this.cardsEl.insertBefore(card.el, there);
        });
        this.root.toggleClass('markdown-frame--missing', wanted[0].content.kind === 'missing');

        const canRender = !this.collapsed && this.root.isConnected && this.host.canRender();
        for (const card of cards) card.paint(canRender);
    }

    /** End what the cards' renders registered. The caller takes `root` out. */
    close(): void {
        for (const card of this.cards) this.end(card);
        this.cards = [];
    }

    /**
     * What the cards are to show of what was read: each card's mask while
     * the view masks and its section has one, else its markdown, resolved
     * against the path the note was found at; or a single card of what is
     * not there. Null before the first reading.
     */
    private wanted(): WantedCard[] | null {
        const { read } = this;
        if (!read) return null;
        if (read.path === null) return [{ content: { kind: 'missing', what: 'no-note' }, style: NO_STYLE }];
        const { reading, path } = read;
        if (reading.kind === 'no-heading') return [{ content: { kind: 'missing', what: 'no-heading' }, style: NO_STYLE }];
        const masked = this.host.masked();
        return reading.cards.map(card => ({
            content: masked && card.mask !== null
                ? { kind: 'mask', heading: card.heading, text: card.mask, path }
                : { kind: 'body', markdown: card.markdown, path },
            style: { color: card.color, linestyle: card.linestyle, opensWithHeading: card.heading !== null },
        }));
    }

    private end(card: MarkdownFrameCard): void {
        card.close();
        card.el.remove();
    }

    private applyCollapsed(collapsed: boolean): void {
        this.collapsed = collapsed;
        // The cards are hidden by the row's class, not taken out: what is
        // drawn in them stays as it is. A card that changed meanwhile is
        // rendered now.
        if (!collapsed) this.paint();
    }
}
