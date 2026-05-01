import type { HoverParent } from 'obsidian';
import { Task, ChildLine } from '../../types';

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
 * - `task`: route through TaskWriteService.updateTask(taskId).
 * - `childLine`: route through TaskWriteService.updateLine(parentTask.file, bodyLine).
 *   `line` is a snapshot captured at render time (current text/state).
 *   `bodyLine` is the absolute file line — already resolved, never recomputed.
 */
export type CheckboxHandler =
    | { type: 'task'; taskId: string }
    | { type: 'childLine'; parentTask: Task; line: ChildLine; bodyLine: number };

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
