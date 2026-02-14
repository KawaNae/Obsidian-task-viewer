import { App } from 'obsidian';
import type { HoverLinkPayload, TaskLinkBindContext } from './types';

export class TaskLinkInteractionManager {
    private boundLinks: WeakSet<HTMLElement> = new WeakSet();

    constructor(private app: App) { }

    bind(container: HTMLElement, context: TaskLinkBindContext): void {
        const internalLinks = container.querySelectorAll<HTMLElement>('a.internal-link[data-href]');
        internalLinks.forEach((linkEl) => {
            this.bindLink(linkEl, context);
        });
    }

    private bindLink(linkEl: HTMLElement, context: TaskLinkBindContext): void {
        if (this.boundLinks.has(linkEl)) {
            return;
        }
        this.boundLinks.add(linkEl);

        linkEl.addEventListener('click', (event: MouseEvent) => {
            this.handleClick(event, linkEl, context);
        });
        linkEl.addEventListener('pointerdown', (event: PointerEvent) => {
            event.stopPropagation();
        });
        linkEl.addEventListener('mouseover', (event: MouseEvent) => {
            this.emitHoverLink(event, linkEl, context);
        });
        linkEl.addEventListener('focusin', (event: FocusEvent) => {
            this.emitHoverLink(event, linkEl, context);
        });
    }

    private handleClick(event: MouseEvent, linkEl: HTMLElement, context: TaskLinkBindContext): void {
        event.preventDefault();
        event.stopPropagation();

        const target = linkEl.dataset.href;
        if (!target) {
            return;
        }

        void this.app.workspace.openLinkText(target, context.sourcePath, true);
    }

    private emitHoverLink(
        event: MouseEvent | FocusEvent,
        linkEl: HTMLElement,
        context: TaskLinkBindContext,
    ): void {
        const target = linkEl.dataset.href;
        if (!target) {
            return;
        }

        // Custom views must emit hover-link manually for the core Page Preview plugin.
        const payload: HoverLinkPayload = {
            event,
            source: context.hoverSource,
            hoverParent: context.hoverParent,
            targetEl: linkEl,
            linktext: target,
            sourcePath: context.sourcePath,
        };

        try {
            this.app.workspace.trigger('hover-link', payload);
        } catch (error) {
            console.error('[TaskViewer] Failed to trigger hover-link event:', error);
        }
    }
}

