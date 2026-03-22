import { App, TFile } from 'obsidian';
import { Task, isFrontmatterTask } from '../../types';

/**
 * Resolves the absolute line number for a child line within a task.
 * Returns -1 if the line number cannot be determined.
 */
export function resolveChildLineNumber(app: App, task: Task, childLineIndex: number): number {
    if (isFrontmatterTask(task)) {
        const bodyOffset = task.childLineBodyOffsets[childLineIndex];
        if (bodyOffset === undefined) return -1;

        const fmEndLine = getFrontmatterEndLine(app, task.file);
        if (fmEndLine === -1) return -1;
        return fmEndLine + 1 + bodyOffset;
    }

    return task.line + 1 + childLineIndex;
}

function getFrontmatterEndLine(app: App, filePath: string): number {
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return -1;
    const cache = app.metadataCache.getFileCache(file);
    return cache?.frontmatterPosition?.end?.line ?? -1;
}
