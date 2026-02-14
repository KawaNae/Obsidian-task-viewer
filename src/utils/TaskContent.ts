import { Task } from '../types';

/**
 * Returns true when task has explicit non-empty content.
 */
export function hasTaskContent(task: Pick<Task, 'content'>): boolean {
    return task.content.trim().length > 0;
}

/**
 * Returns the basename of a file path (without .md extension).
 */
export function getFileBaseName(filePath: string): string {
    const withoutExt = filePath.replace(/\.md$/, '');
    return withoutExt.split('/').pop()?.trim() || '';
}

/**
 * Returns true when task content matches file basename.
 * Used to avoid redundant display like "project : [[project|project]]".
 */
export function isContentMatchingBaseName(task: Pick<Task, 'content' | 'file'>): boolean {
    if (!hasTaskContent(task)) {
        return false;
    }

    return task.content.trim() === getFileBaseName(task.file);
}

/**
 * Returns UI display name for a task.
 * Falls back to file basename when content is empty.
 */
export function getTaskDisplayName(task: Pick<Task, 'content' | 'file'>): string {
    if (hasTaskContent(task)) {
        return task.content.trim();
    }

    const baseName = getFileBaseName(task.file);
    if (baseName && baseName.length > 0) {
        return baseName;
    }

    return 'Untitled';
}
