/**
 * One card of a markdown frame of the sidebar (`MarkdownFrameView`): a
 * `task-card__shape`, so its surface and accent bar are the task card's,
 * and under it one of three things (`CardContent`): a part of the section
 * as rendered markdown, the part's mask in place of it, or that the note or
 * the section is not there.
 *
 * The card is handed what it is to show (`set`) and shows it when it is
 * asked to (`paint`), which does nothing when it shows that already. What
 * renders markdown waits until the frame can render it: until then the card
 * keeps what it shows only when that is of the same kind and rendered
 * against the same path (an older version of it), and else shows nothing.
 * Each render has an element and a `Component` of its own, so one that ends
 * late adds nothing to the one that took its place.
 *
 * A checkbox the markdown draws (`- [ ] …`) does not toggle on a click: the
 * render draws it with nothing that writes the note, so a click would only
 * change how it looks. A checkbox a block of another plugin draws (a
 * Dataview task list) is that plugin's, which writes the note itself, and
 * is left alone.
 */

import { Component, MarkdownRenderer, type App } from 'obsidian';
import { t } from '../../i18n';
import { logError } from '../../log/log';
import { TaskStyling } from '../sharedUI/TaskStyling';

/**
 * What a card shows under its shape:
 *
 * - `body`: the card's markdown, rendered against the note's path
 * - `mask`: the card's mask, in place of its markdown, while the view
 *   masks; under the heading that opens the card, rendered against the
 *   note's path, when one does
 * - `missing`: that the note, or the section, is not there
 */
export type CardContent =
    | { kind: 'body'; markdown: string; path: string }
    | { kind: 'mask'; heading: string | null; text: string; path: string }
    | { kind: 'missing'; what: 'no-note' | 'no-heading' };

/**
 * How a card looks: colored and lined as a task of its section is, and
 * whether a heading nested in the frame's section opens it, as the reading
 * found it (`FrameCard.heading`). The heading that opens a card is sized as
 * the card's name; one the markdown draws first in a card no heading opens
 * is not, whatever the renderer makes of it.
 */
export interface CardStyle {
    color: string | null;
    linestyle: string | null;
    opensWithHeading: boolean;
}

/** What a card is handed of the frame that holds it. */
export interface MarkdownFrameCardHost {
    app: App;
    /**
     * Make the internal links under `el` open their notes and preview on
     * hover. Called again whenever the rendered DOM changes, so it has to
     * leave a link it already took alone.
     */
    bindLinks(el: HTMLElement, sourcePath: string): void;
    /** Take the frame out of the sidebar. */
    remove(): void;
    /** Choose again the section the frame shows. */
    relink(): void;
}

/** What a card shows, and the element it is drawn in; what a render registered too. */
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
 * Whether `target` is a task's checkbox the markdown of `rendered` drew,
 * and not one a code block in it drew. Asked by selector, not by class: an
 * element of a pop-out window is not an instance of this window's classes.
 */
function isMarkdownCheckbox(target: EventTarget | null, rendered: HTMLElement): boolean {
    const el = target as Element | null;
    if (typeof el?.matches !== 'function' || !el.matches('input.task-list-item-checkbox')) return false;
    const block = el.closest(CODE_BLOCK);
    return block === null || !rendered.contains(block);
}

/** Whether a card showing `a` shows `b` already. */
export function sameContent(a: CardContent, b: CardContent): boolean {
    switch (a.kind) {
        case 'body': return b.kind === 'body' && a.markdown === b.markdown && a.path === b.path;
        case 'mask': return b.kind === 'mask' && a.text === b.text && a.heading === b.heading
            && (a.heading === null || a.path === b.path);
        case 'missing': return b.kind === 'missing' && a.what === b.what;
    }
}

/** Whether showing `content` renders markdown, which waits until the frame can render. */
function renders(content: CardContent): content is CardContent & { path: string } {
    return content.kind === 'body' || (content.kind === 'mask' && content.heading !== null);
}

export class MarkdownFrameCard {
    readonly el: HTMLElement;
    private wanted: CardContent;
    private shown: CardShown | null = null;

    /** A card that is to show `content`, styled by `style`, showing nothing yet. The caller puts `el` in place. */
    constructor(private readonly host: MarkdownFrameCardHost, content: CardContent, style: CardStyle) {
        this.el = document.createElement('div');
        this.el.addClass('markdown-frame__card');
        this.el.createDiv('task-card__shape');
        this.wanted = content;
        this.setStyle(style);
    }

    /** What the card is to show; it shows it at the next `paint`. */
    get content(): CardContent {
        return this.wanted;
    }

    /** Have the card show `content` from the next `paint` on, styled by `style` now. */
    set(content: CardContent, style: CardStyle): void {
        this.wanted = content;
        this.setStyle(style);
    }

    /**
     * Show what the card is to show, unless it shows that already. What
     * renders markdown waits while `canRender` is false; meanwhile the card
     * keeps what it shows only when that is of the same kind, rendered
     * against the same path.
     */
    paint(canRender: boolean): void {
        const { wanted, shown } = this;
        if (shown && sameContent(shown.content, wanted)) return;
        if (renders(wanted) && !canRender) {
            if (shown && !(shown.content.kind === wanted.kind && renders(shown.content) && shown.content.path === wanted.path)) this.clear();
            return;
        }

        this.clear();
        switch (wanted.kind) {
            case 'body': {
                const { el, component } = this.render('markdown-frame__content', wanted.markdown, wanted.path);
                this.shown = { content: wanted, el, component };
                break;
            }
            case 'mask':
                this.shown = this.drawMask(wanted);
                break;
            case 'missing':
                this.shown = { content: wanted, el: this.drawMissing(wanted.what), component: null };
                break;
        }
    }

    /** Take out what the card shows, and end what a render registered. The caller takes `el` out. */
    close(): void {
        this.clear();
    }

    private setStyle(style: CardStyle): void {
        TaskStyling.applyTaskColor(this.el, style.color);
        TaskStyling.applyTaskLinestyle(this.el, style.linestyle);
        this.el.toggleClass('markdown-frame__card--headed', style.opensWithHeading);
    }

    /**
     * Render `markdown` against `path` into an element of the class `cls`,
     * in the card or in `parent`, with a Component of its own.
     */
    private render(cls: string, markdown: string, path: string, parent: HTMLElement = this.el): { el: HTMLElement; component: Component } {
        const el = parent.createDiv(`${cls} markdown-rendered`);
        const component = new Component();
        component.load();

        // The links are taken as they come into the element: with the
        // render, and whenever a block in it draws itself again later.
        const observer = new MutationObserver(() => this.host.bindLinks(el, path));
        observer.observe(el, { childList: true, subtree: true });
        component.register(() => observer.disconnect());
        component.registerDomEvent(el, 'click', (event) => {
            if (isMarkdownCheckbox(event.target, el)) event.preventDefault();
        });

        MarkdownRenderer.render(this.host.app, markdown, el, path, component)
            .catch((e: unknown) => {
                logError(`[MarkdownFrame] markdown render failed: ${e instanceof Error ? e.message : String(e)}`, { notice: false });
            });
        return { el, component };
    }

    /**
     * The mask, as a masked task card shows it in place of its text: under
     * the heading that opens the card, rendered as the card's markdown
     * renders it, when one does.
     */
    private drawMask(mask: CardContent & { kind: 'mask' }): CardShown {
        if (mask.heading === null) {
            return { content: mask, el: this.el.createDiv({ cls: 'markdown-frame__mask', text: mask.text }), component: null };
        }
        const el = this.el.createDiv('markdown-frame__masked');
        const { component } = this.render('markdown-frame__heading', mask.heading, mask.path, el);
        el.createDiv({ cls: 'markdown-frame__mask', text: mask.text });
        return { content: mask, el, component };
    }

    /** Say in the card that the note (`no-note`) or the section (`no-heading`) is not there, and offer Choose again and Remove. */
    private drawMissing(what: 'no-note' | 'no-heading'): HTMLElement {
        const el = this.el.createDiv('markdown-frame__missing');
        el.createDiv({
            cls: 'markdown-frame__missing-reason',
            text: t(what === 'no-note' ? 'sidebar.noteNotFound' : 'sidebar.sectionNotFound'),
        });
        const actions = el.createDiv('markdown-frame__missing-actions');
        const relinkBtn = actions.createEl('button', { cls: 'markdown-frame__missing-relink', text: t('sidebar.relink') });
        relinkBtn.addEventListener('click', () => this.host.relink());
        const removeBtn = actions.createEl('button', { cls: 'markdown-frame__missing-remove', text: t('menu.remove') });
        removeBtn.addEventListener('click', () => this.host.remove());
        return el;
    }

    /** Take out what the card shows, and end what a render registered. */
    private clear(): void {
        if (!this.shown) return;
        this.shown.component?.unload();
        this.shown.el.remove();
        this.shown = null;
    }
}
