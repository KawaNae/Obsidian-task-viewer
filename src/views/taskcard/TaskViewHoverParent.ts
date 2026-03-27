import type { HoverParent, HoverPopover } from 'obsidian';

/**
 * Lightweight HoverParent that decouples Page Preview popovers from the
 * view's WorkspaceLeaf.  Using the leaf directly caused state corruption:
 * Page Preview would set leaf.hoverPopover and interact with the leaf's
 * MarkdownView-specific context, eventually causing unrelated editor tabs
 * to navigate away on popover click.
 */
export class TaskViewHoverParent implements HoverParent {
    hoverPopover: HoverPopover | null = null;

    dispose(): void {
        if (this.hoverPopover && 'hide' in this.hoverPopover) {
            (this.hoverPopover as { hide: () => void }).hide();
        }
        this.hoverPopover = null;
    }
}
