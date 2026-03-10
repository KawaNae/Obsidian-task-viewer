import { Task, ChildLine } from '../../types';
import { NotationUtils } from './NotationUtils';
import { ChildRenderItem } from './types';
import { getFileBaseName } from '../../utils/TaskContent';

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
        if (task.parserId === 'frontmatter' && task.file !== contextFile) {
            return {
                markdown: `${indent}- [${char}] ${this.formatWikiLink(task.file)}`,
                notation: NotationUtils.buildNotationLabel(task),
                isCheckbox: true,
                handler: { type: 'task', taskId: task.id }
            };
        }

        return {
            markdown: `${indent}- [${char}] ${task.content || '\u200B'}`,
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
     * Converts plain child line to ChildRenderItem.
     * This path is only reached for lines NOT recognized as tasks by the parser,
     * so no @notation extraction or removal is performed — the line is rendered as-is.
     */
    processChildLine(cl: ChildLine, idx: number, task: Task, indent: string): ChildRenderItem {
        const isCb = cl.checkboxChar !== null;

        let cleaned = cl.text.trimEnd();
        if (isCb && /^\s*-\s*\[.\]$/.test(cleaned)) {
            cleaned += ' \u200B';
        }

        return {
            markdown: indent + cleaned,
            notation: null,
            isCheckbox: isCb,
            handler: isCb
                ? { type: 'childLine', parentTask: task, childLineIndex: idx }
                : null
        };
    }

    formatWikiLink(filePath: string): string {
        const target = filePath.replace(/\.md$/, '');
        const alias = getFileBaseName(filePath) || target.split('/').pop() || target;
        return `[[${target}|${alias}]]`;
    }
}
