import { type App, type Component, MarkdownRenderer } from 'obsidian';
import { logError, logWarn } from '../../log/log';

/**
 * What a markdown draw leaves to come later: it settles when the content
 * that is truly asynchronous (an image that loads, an embed, math, code
 * highlighting, mermaid, another plugin's post-processor) has come in. It
 * never rejects; a failure is logged.
 */
export type LateContent = Promise<void>;

let warnedEmpty = false;

/**
 * Draw `markdown` into `el`, the one place a card calls
 * `MarkdownRenderer.render`.
 *
 * A card is drawn whole when its draw returns (`TaskCardRenderer.render`):
 * what comes after the body (the children's notation, the checkboxes, the
 * links, the mask) is laid on the body at once. That rests on Obsidian
 * putting the body into `el` within the call, which its renderer does today
 * but its API does not promise. Should a later Obsidian put it in later, the
 * card would be drawn without those, so an empty `el` right after the call
 * is logged, once a session.
 *
 * Nobody waits on the returned promise to draw; it tells only when the late
 * content is in (`LateContent`).
 */
export function renderCardMarkdown(
    app: App,
    markdown: string,
    el: HTMLElement,
    sourcePath: string,
    component: Component,
): LateContent {
    const before = el.children.length;
    const pending = MarkdownRenderer.render(app, markdown, el, sourcePath, component);
    if (!warnedEmpty && markdown.trim() !== '' && el.children.length === before) {
        warnedEmpty = true;
        logWarn('[TaskCardRenderer] MarkdownRenderer.render put nothing into the card within the call; '
            + 'the notation, checkboxes, links and mask of a card are laid on its body when it returns.');
    }
    return pending.catch((e: unknown) => {
        logError(`[TaskCardRenderer] markdown render failed: ${e instanceof Error ? e.message : String(e)}`, { notice: false });
    });
}

/** Where Obsidian puts the text of a list item's line, when not in the item itself. */
const LINE_HOSTS = [
    ':scope > .task-list-item-description',
    ':scope > p',
    ':scope > label',
] as const;

/**
 * Put `el` at the end of the line of `item`, a list item `renderCardMarkdown`
 * drew: after the item's text, before a list nested in it, and inside the
 * paragraph that holds the text when the list is loose.
 *
 * What a card puts after a line's text (the link to the task's note, a
 * child's notation or menu button) is put into the drawn DOM here, never
 * written into the markdown. Written after the user's text, it would be read
 * with that text as one inline: an `_` in a task's name and one in its
 * note's path make an emphasis that takes the link apart.
 */
export function appendToLine(item: HTMLElement, el: HTMLElement): void {
    for (const selector of LINE_HOSTS) {
        const host = item.querySelector<HTMLElement>(selector);
        if (host) {
            host.appendChild(el);
            return;
        }
    }
    const nested = Array.from(item.children).find(child => child.matches('ul, ol') || child.querySelector('ul, ol') !== null);
    item.insertBefore(el, nested ?? null);
}
