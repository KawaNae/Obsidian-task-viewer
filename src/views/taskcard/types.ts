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