import { Task, ChildLine, isFrontmatterTask } from '../../types';
import { NotationUtils } from './NotationUtils';
import { ChildRenderItem } from './types';
import { getFileBaseName } from '../../services/parsing/utils/TaskContent';

/**
 * Pure conversion: Task / raw line → ChildRenderItem.
 *
 * No resolution logic — only formatting and item creation.
 */
export class ChildRenderItemMapper {
    /**
     * Converts Task to ChildRenderItem.
     * For frontmatter tasks in another file, render as wikilink text.
     */
    createTaskItem(task: Task, indent: string, contextFile: string): ChildRenderItem {
        const char = task.statusChar || ' ';
        if (isFrontmatterTask(task) && task.file !== contextFile) {
            return {
                markdown: `${indent}- [${char}] ${this.formatWikiLink(task.file)}`,
                notation: NotationUtils.buildNotationLabel(task),
                isCheckbox: true,
                handler: { type: 'task', taskId: task.id }
            };
        }

        return {
            markdown: `${indent}- [${char}] ${task.content || '​'}`,
            notation: NotationUtils.buildNotationLabel(task),
            isCheckbox: true,
            handler: { type: 'task', taskId: task.id }
        };
    }

    /**
     * Converts a wikilink-resolved Task to ChildRenderItem.
     */
    createWikiLinkItem(task: Task, indent: string): ChildRenderItem {
        return {
            markdown: `${indent}- [${task.statusChar || ' '}] ${this.formatWikiLink(task.file)}`,
            notation: NotationUtils.buildNotationLabel(task),
            isCheckbox: true,
            handler: { type: 'task', taskId: task.id }
        };
    }

    /**
     * Converts a plain child line to ChildRenderItem.
     * Used for lines NOT recognized as tasks by the parser, so no @notation
     * extraction is performed — the line is rendered as-is. The handler
     * carries `bodyLine` (absolute file line) and a `line` snapshot, so
     * write paths never recompute line numbers.
     */
    createPlainItem(line: ChildLine, bodyLine: number, parentTask: Task, indent: string): ChildRenderItem {
        const isCb = line.checkboxChar !== null;

        let cleaned = line.text.trimEnd();
        if (isCb && /^\s*-\s*\[.\]$/.test(cleaned)) {
            cleaned += ' ​';
        }

        return {
            markdown: indent + cleaned,
            notation: null,
            isCheckbox: isCb,
            handler: isCb
                ? { type: 'childLine', parentTask, line, bodyLine }
                : null,
            propertyKey: line.propertyKey ?? undefined,
        };
    }

    formatWikiLink(filePath: string): string {
        const target = filePath.replace(/\.md$/, '');
        const alias = getFileBaseName(filePath) || target.split('/').pop() || target;
        return `[[${target}|${alias}]]`;
    }
}
