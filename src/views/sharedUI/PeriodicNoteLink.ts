import type { App, HoverParent } from 'obsidian';
import { linkTarget, type PeriodicNote } from '../../utils/PeriodicNotes';
import { openPeriodicNoteInLeaf, type PeriodicNoteOpener } from '../sharedLogic/OpenPeriodicNote';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';

/** What a link to a periodic note opens and previews with. */
export interface PeriodicLinkContext {
    app: App;
    notes: PeriodicNoteOpener;
    links: TaskLinkInteractionManager;
    hoverParent: HoverParent;
}

/** Point `link` at the periodic note of `date`: what its hover previews. */
export function pointPeriodicLink(link: HTMLElement, note: PeriodicNote, date: string): void {
    const target = linkTarget(note, date);
    link.dataset.href = target;
    link.setAttribute('href', target);
}

/**
 * A link to the periodic note of `date` (`YYYY-MM-DD`): an
 * `a.internal-link` whose hover previews the note, and a click on
 * `opensFrom` (the link, or a cell around it) opens the note in the current
 * leaf, made from its template when it is not there
 * (`openPeriodicNoteInLeaf`). The link's own navigation is not used.
 */
export function periodicNoteLink(
    parent: HTMLElement,
    ctx: PeriodicLinkContext,
    note: PeriodicNote,
    date: string,
    options: { cls?: string; text?: string; ariaLabel?: string; opensFrom?: HTMLElement } = {},
): HTMLAnchorElement {
    const link = parent.createEl('a', { cls: ['internal-link', ...(options.cls ? [options.cls] : [])] });
    if (options.text !== undefined) link.setText(options.text);
    if (options.ariaLabel) link.setAttribute('aria-label', options.ariaLabel);
    pointPeriodicLink(link, note, date);
    link.addEventListener('click', (event: MouseEvent) => event.preventDefault());

    const opensFrom = options.opensFrom ?? link;
    opensFrom.addEventListener('click', (event: MouseEvent) => {
        // Opened by the link itself, the click stops there: the cell around
        // it is not clicked as well.
        if (opensFrom === link) event.stopPropagation();
        void openPeriodicNoteInLeaf(ctx.app, ctx.notes, note, date);
    });

    ctx.links.bind(parent, {
        sourcePath: '',
        hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
        hoverParent: ctx.hoverParent,
    }, { bindClick: false });
    return link;
}
