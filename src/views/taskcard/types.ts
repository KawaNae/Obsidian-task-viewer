import type { HoverParent } from 'obsidian';

export interface ChildRenderItem {
    markdown: string;
    notation: string | null;
    isCheckbox: boolean;
    handler: CheckboxHandler | null;
    /** Set when line is a key-value property (e.g. "- 金額: 2000") */
    propertyKey?: string;
}

/**
 * Click target for a rendered child item.
 *
 * Every checkbox is a task, so a click routes through
 * TaskWriteService.updateTask(taskId).
 */
export type CheckboxHandler = { type: 'task'; taskId: string };

export interface TaskCardLinkRuntime {
    hoverSource: string;
    getHoverParent: () => HoverParent;
}

export interface TaskLinkBindContext {
    sourcePath: string;
    hoverSource: string;
    hoverParent: HoverParent;
}

export interface HoverLinkPayload {
    event: MouseEvent | FocusEvent;
    source: string;
    hoverParent: HoverParent;
    targetEl: HTMLElement;
    linktext: string;
    sourcePath: string;
}
