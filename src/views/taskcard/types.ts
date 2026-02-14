import type { HoverParent } from 'obsidian';
import { Task } from '../../types';

export interface ChildRenderItem {
    markdown: string;
    notation: string | null;
    isCheckbox: boolean;
    handler: CheckboxHandler | null;
}

export type CheckboxHandler =
    | { type: 'task'; taskId: string }
    | { type: 'childLine'; parentTask: Task; childLineIndex: number };

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
