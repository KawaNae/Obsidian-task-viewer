/**
 * One markdown frame of the sidebar, drawn: a header row carrying the name
 * of what it shows, which folds the frame, and under it a card holding the
 * section's body as rendered markdown.
 *
 * What it shows is what the frame's reader read (`MarkdownFrameReader`),
 * handed to `show`; the view looks nothing up and reads no file.
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
 * Only a body waits to be rendered. While it waits, the card keeps what it
 * shows only when that is a body rendered against the same path, which may
 * be an older version of it; anything else is taken out at once. A body
 * rendered against the path a renamed note had resolved its links, and had
 * them bound, against that path.
 *
 * While the view masks (`MarkdownFrameViewHost.masked`), a section that has
 * a mask shows it in place of its body, as a masked task card shows it in
 * place of its text: the body is taken out, and rendered again once the
 * view stops masking or the mask is gone. The row's name and the style stay.
 *
 * A checkbox the body's markdown draws (`- [ ] …`) does not toggle on a
 * click: the render draws it with nothing that writes the note, so a click
 * would only change how it looks. A checkbox a block of another plugin
 * draws (a Dataview task list) is that plugin's, which writes the note
 * itself, and is left alone.
 *
 * A frame whose note or section is not there says which, in its card, and
 * offers to remove itself. It is shown again once the note or the section
 * is found.
 *
 * What the card shows is one of the three (`CardContent`), decided in one
 * place (`wanted`) from what was read and whether the view masks, and put
 * in by `paint`, which takes out what the card showed before.
 */

import { Component, MarkdownRenderer, type App } from 'obsidian';
import { t } from '../../i18n';
import { logError } from '../../log/log';
import { renderSectionHeader, type SectionHeaderClasses, type SectionHeaderHandle } from '../sharedUI/ListSectionRenderer';
import { TaskStyling } from '../sharedUI/TaskStyling';
import type { FrameRead } from './MarkdownFrameReader';

/** What a frame's view is handed of the panel that holds it: what every frame shares, and what is its own frame's. */
export interface MarkdownFrameViewHost {
    app: App;
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
    /** Whether the view masks now: a section's mask is shown in place of its body. */
    masked(): boolean;
    /** The frame was folded or unfolded from its row; it already shows it. */
    collapsedChanged(collapsed: boolean): void;
    /** Show the frame's ⋯ menu. */
    showMenu(event: MouseEvent): void;
    /** Take the frame out of the sidebar. */
    remove(): void;
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

/**
 * The block a plugin draws for a fenced code block of its language
 * (`block-language-dataview`): what is in it is the plugin's.
 */
const CODE_BLOCK = '[class^="block-language-"], [class*=" block-language-"]';

/**
 * Whether `target` is a task's checkbox the markdown of `body` drew, and
 * not one a code block in it drew. Asked by selector, not by class: an
 * element of a pop-out window is not an instance of this window's classes.
 */
function isMarkdownCheckbox(target: EventTarget | null, body: HTMLElement): boolean {
    const el = target as Element | null;
    if (typeof el?.matches !== 'function' || !el.matches('input.task-list-item-checkbox')) return false;
    const block = el.closest(CODE_BLOCK);
    return block === null || !body.contains(block);
}

function sameContent(a: CardContent, b: CardContent): boolean {
    switch (a.kind) {
        case 'body': return b.kind === 'body' && a.markdown === b.markdown && a.path === b.path;
        case 'mask': return b.kind === 'mask' && a.text === b.text;
        case 'missing': return b.kind === 'missing' && a.what === b.what;
    }
}

export class MarkdownFrameView {
    readonly root: HTMLElement;
    private readonly row: SectionHeaderHandle;
    private readonly card: HTMLElement;

    private collapsed: boolean;
    /** What was read last; null before the first reading. */
    private read: FrameRead | null = null;
    /** What the card shows; null while it shows nothing. */
    private shown: CardShown | null = null;

    /**
     * Build the frame `id`'s element, its row named `title`, with no body:
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

        this.card = this.root.createDiv('markdown-frame__card');
        this.card.createDiv('task-card__shape');
    }

    /** Show `read`: its name, its style, and in the card what it gives. */
    show(read: FrameRead): void {
        this.read = read;
        this.row.nameEl.setText(read.title);

        const section = 'markdown' in read.reading ? read.reading : null;
        TaskStyling.applyTaskColor(this.card, section?.color ?? null);
        TaskStyling.applyTaskLinestyle(this.card, section?.linestyle ?? null);
        this.paint();
    }

    /** Show the frame collapsed or not, as the view's state has it. */
    setCollapsed(collapsed: boolean): void {
        if (collapsed === this.collapsed) return;
        this.row.setCollapsed(collapsed);
        this.applyCollapsed(collapsed);
    }

    /**
     * Have the card show what the frame shows now (`wanted`), unless it
     * shows that already. A body waits while the frame is folded, while its
     * element stands in no document (the frame is made as the state takes
     * it, before the panel puts it in place), or while it cannot be
     * rendered yet (`MarkdownFrameViewHost.canRender`); until then the card
     * keeps what it shows only if that is a body rendered against the same
     * path, and else shows nothing. The rest is shown at once. Called when
     * what was read changes, at the unfold, when the panel can render, and
     * at each draw of the panel, which is where a change of the view's
     * masking comes in.
     */
    paint(): void {
        const wanted = this.wanted();
        if (!wanted || (this.shown && sameContent(this.shown.content, wanted))) return;
        if (wanted.kind === 'body' && (this.collapsed || !this.root.isConnected || !this.host.canRender())) {
            const { shown } = this;
            if (shown && !(shown.content.kind === 'body' && shown.content.path === wanted.path)) this.clearCard();
            return;
        }

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

    /** End what the body's render registered. The caller takes `root` out. */
    close(): void {
        this.clearCard();
    }

    /**
     * What the card is to show of what was read: the mask while the view
     * masks and the section has one, else the body, resolved against the
     * path the note was found at; or what is not there. Null before the
     * first reading.
     */
    private wanted(): CardContent | null {
        const { read } = this;
        if (!read) return null;
        if (read.path === null) return { kind: 'missing', what: 'no-note' };
        if (!('markdown' in read.reading)) return { kind: 'missing', what: read.reading.kind };
        if (read.reading.mask !== null && this.host.masked()) return { kind: 'mask', text: read.reading.mask };
        return { kind: 'body', markdown: read.reading.markdown, path: read.path };
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
        component.registerDomEvent(el, 'click', (event) => {
            if (isMarkdownCheckbox(event.target, el)) event.preventDefault();
        });

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
        removeBtn.addEventListener('click', () => this.host.remove());
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
        this.root.removeClass('markdown-frame--missing');
    }
}
