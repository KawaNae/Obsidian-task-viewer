import type { Task, ChildLine } from '../../types';
import { NotationUtils } from './NotationUtils';
import type { ChildRenderItem } from './types';

/**
 * Pure conversion: Task / raw line → ChildRenderItem.
 *
 * No resolution logic — only formatting and item creation.
 */
export class ChildRenderItemMapper {
    /** Converts Task to ChildRenderItem. */
    createTaskItem(task: Task, indent: string): ChildRenderItem {
        const char = task.statusChar || ' ';
        return {
            markdown: `${indent}- [${char}] ${task.content || '​'}`,
            notation: NotationUtils.buildNotationLabel(task),
            isCheckbox: true,
            handler: { type: 'task', taskId: task.id }
        };
    }

    /**
     * Converts a plain child line to ChildRenderItem, rendered as-is.
     *
     * A child line is never a checkbox — every checkbox is a task. A `- [ ]`
     * that shows up here sits inside a code fence, where it is an example and
     * must stay inert.
     */
    createPlainItem(line: ChildLine, indent: string): ChildRenderItem {
        return {
            markdown: indent + line.text.trimEnd(),
            notation: null,
            isCheckbox: false,
            handler: null,
            propertyKey: line.propertyKey ?? undefined,
        };
    }
}
