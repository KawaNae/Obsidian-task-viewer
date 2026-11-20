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
 * A checkbox the markdown draws (`- [ ] …`) writes its line of the note on
 * a click, through the frame (`MarkdownFrameCardHost.writeBox`): the render
 * draws it with nothing that writes the note. The click is taken by the
 * element the markdown is rendered in, for every checkbox in it. Which line
 * the checkbox writes is decided off two renders of the markdown that are
 * never shown (`FrameCheckboxes`), against the checkboxes the card shows at
 * the click. The checkbox does not change how it looks on the click: the
 * line written has the note read again, and the card rendered anew from it.
 * The line is written at the reading the checkbox stands in: the one the
 * card was handed last when it shows that markdown still, with where its
 * lines are now; else the one it rendered, as a card that waits to render
 * keeps it though it is handed the markdown of a note that has changed.
 * Whether the note still reads so is the write's to decide, and to tell.
 *
 * A checkbox of a note embedded in the markdown (`![[…]]`) writes nothing,
 * and says so: the render draws it as that note's, and the card knows
 * nothing of its lines. The renders never shown draw the embed as a link,
 * so they read no other note and run none of its scripts. A checkbox another plugin draws (a Dataview task list, of a code
 * block or of an inline query) is that plugin's, which writes the note
 * itself, and is left alone.
 */

import { Component, MarkdownRenderer, Notice, type App } from 'obsidian';
import { t } from '../../i18n';
import { logError } from '../../log/log';
import type { ContentKey } from '../../services/core/ContentKey';
import { confirms, markLines, markedLine, turnLine, type BoxLine } from '../../services/data/FrameCheckboxes';
import { TaskStyling } from '../sharedUI/TaskStyling';

/**
 * What a card shows under its shape:
 *
 * - `body`: the card's markdown, rendered against the note's path, with
 *   where its lines are in the note: the key of the note's lines it was read
 *   from (`FrameRead.key`), and the line there each line of the markdown is
 *   (`CardRows.lines`). Where its lines are is no part of what the card
 *   shows: a card whose markdown and path are the same shows the same
 *   (`sameContent`), and is only handed where its lines are now
 * - `mask`: the card's mask, in place of its markdown, while the view
 *   masks; under the heading that opens the card, rendered against the
 *   note's path, when one does
 * - `missing`: that the note, or the section, is not there
 */
export type CardContent =
    | { kind: 'body'; markdown: string; path: string; key: ContentKey; lines: readonly number[] }
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
    /**
     * Write `write` to the note at `path`, its line a line of the content
     * whose key is `key`: written only while the note reads as that content,
     * and told when it is not. The content may be older than the one the
     * card was handed last: the one it still shows.
     */
    writeBox(path: string, key: ContentKey, write: BoxLine): void;
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
 * What Dataview draws, a task list of its inline query too: its items and
 * their checkboxes carry its class. An inline query is drawn only in a
 * render whose `Component` is loaded, so the renders never shown draw none.
 */
const DATAVIEW = '.dataview';
/** What another plugin draws, whose checkboxes are that plugin's. */
const PLUGIN_DRAWN = `${CODE_BLOCK}, ${DATAVIEW}`;
/** A note embedded in the markdown (`![[…]]`), drawn as that note's. */
const EMBED = '.internal-embed';
/** A task's checkbox, as the render draws it. */
const CHECKBOX = 'input.task-list-item-checkbox';

/**
 * Whether `el` is under an element `rendered` holds that matches
 * `selector`, or is one. Asked by selector, not by class: an element of a
 * pop-out window is not an instance of this window's classes.
 */
function within(el: Element, rendered: HTMLElement, selector: string): boolean {
    const at = el.closest(selector);
    return at !== null && rendered.contains(at);
}

/**
 * The checkboxes the markdown of `rendered` drew of its own lines, in
 * order: not one of a note embedded in it, nor one another plugin drew.
 */
function ownCheckboxes(rendered: HTMLElement): Element[] {
    return Array.from(rendered.querySelectorAll(CHECKBOX))
        .filter(box => !within(box, rendered, EMBED) && !within(box, rendered, PLUGIN_DRAWN));
}

/** The `data-task` of the item of each of `boxes`: the status the render wrote on it, null for a checkbox with none. */
function statusesOf(boxes: readonly Element[]): (string | null)[] {
    return boxes.map(box => box.closest('li')?.getAttribute('data-task') ?? null);
}

/**
 * Whether a card showing `a` shows `b` already. Where a body's lines are in
 * the note is not compared: every change to the note gives it a new key, and
 * a line put above the card moves its lines, neither of which changes what
 * the card shows.
 */
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
                const { el, component } = this.render('markdown-frame__content', wanted, wanted.markdown);
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
     * Render `markdown`, a part of what the card shows (`drawn`), against
     * its path into an element of the class `cls`, in the card or in
     * `parent`, with a Component of its own.
     */
    private render(cls: string, drawn: CardContent & { path: string }, markdown: string, parent: HTMLElement = this.el): { el: HTMLElement; component: Component } {
        const { path } = drawn;
        const el = parent.createDiv(`${cls} markdown-rendered`);
        const component = new Component();
        component.load();

        // The links are taken as they come into the element: with the
        // render, and whenever a block in it draws itself again later.
        const observer = new MutationObserver(() => this.host.bindLinks(el, path));
        observer.observe(el, { childList: true, subtree: true });
        component.register(() => observer.disconnect());
        component.registerDomEvent(el, 'click', (event) => this.clicked(event, el, drawn));

        MarkdownRenderer.render(this.host.app, markdown, el, path, component)
            .catch((e: unknown) => {
                logError(`[MarkdownFrame] markdown render failed: ${e instanceof Error ? e.message : String(e)}`, { notice: false });
            });
        return { el, component };
    }

    /**
     * A click in `rendered`, the element a render of `drawn` drew into: on
     * a checkbox the markdown drew, the checkbox is kept as it is and its
     * line written (`press`). One another plugin drew is left to it; one of
     * an embedded note writes nothing, and says it is that note's. The listener lives as long as the
     * render's component, so `drawn` is what the card shows at the click. A
     * heading over a mask holds no lines of a task, so a checkbox drawn
     * there (one the markdown writes as HTML) writes nothing either.
     */
    private clicked(event: MouseEvent, rendered: HTMLElement, drawn: CardContent): void {
        const target = event.target as Element | null;
        if (typeof target?.matches !== 'function' || !target.matches(CHECKBOX) || within(target, rendered, PLUGIN_DRAWN)) return;
        event.preventDefault();
        if (within(target, rendered, EMBED)) {
            new Notice(t('sidebar.checkboxEmbedded'));
            return;
        }
        const boxes = ownCheckboxes(rendered);
        const index = boxes.indexOf(target);
        if (drawn.kind === 'body' && index >= 0) this.press(drawn, statusesOf(boxes), index);
        else new Notice(t('sidebar.checkboxUnmatched'));
    }

    /**
     * Write the line of the checkbox `index` of those the card shows, whose
     * items' `data-task` are `shown`, read at the click; else tell the user
     * nothing was written. The line is of the reading the checkbox stands
     * in: the one the card was handed last when it is to show what it shows
     * (`sameContent`), its key and lines those of the note now; else
     * `drawn`, which the note may have left, and then the write is refused
     * where it is made. The reading is taken at the click and kept through
     * the renders it waits for, whatever the card is handed meanwhile.
     */
    private press(drawn: CardContent & { kind: 'body' }, shown: readonly (string | null)[], index: number): void {
        const { wanted } = this;
        const reading = wanted.kind === 'body' && sameContent(drawn, wanted) ? wanted : drawn;
        void this.lineOf(reading, shown, index).then((write) => {
            if (write) this.host.writeBox(reading.path, reading.key, write);
            else new Notice(t('sidebar.checkboxUnmatched'));
        });
    }

    /**
     * The line the checkbox `index` writes, of the card's `markdown`: the
     * line the render with each line named (`markLines`) names at its
     * place, written only when the render with that line turned draws what
     * the click asks for (`confirms`). Null when no line is named, or the
     * render does not confirm it.
     */
    private async lineOf(reading: CardContent & { kind: 'body' }, shown: readonly (string | null)[], index: number): Promise<BoxLine | null> {
        try {
            const k = markedLine(statusesOf(await this.drawUnshown(markLines(reading.markdown), reading.path))[index] ?? null);
            const turned = k === null ? null : turnLine(reading.markdown, reading.lines, k, shown[index] ?? null);
            if (turned === null) return null;
            const tried = statusesOf(await this.drawUnshown(turned.markdown, reading.path));
            return confirms(shown, tried, index, turned.drawn) ? turned.write : null;
        } catch (e: unknown) {
            logError(`[MarkdownFrame] checkbox render failed: ${e instanceof Error ? e.message : String(e)}`, { notice: false });
            return null;
        }
    }

    /**
     * Render `markdown` against `path` into an element never put in a
     * document, and give the checkboxes it drew of its own lines. The
     * element is made by the card's document, a pop-out window's for a card
     * in one. Its `Component` is not loaded, so what is drawn only on load
     * (an inline query) is not; it draws the checkboxes and their items'
     * statuses by the time the render ends.
     */
    private async drawUnshown(markdown: string, path: string): Promise<Element[]> {
        const el = this.el.ownerDocument.createElement('div');
        const component = new Component();
        try {
            await MarkdownRenderer.render(this.host.app, markdown, el, path, component);
            return ownCheckboxes(el);
        } finally {
            component.unload();
        }
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
        const { component } = this.render('markdown-frame__heading', mask, mask.heading, el);
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
