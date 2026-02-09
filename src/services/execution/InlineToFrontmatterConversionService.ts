import { App, TFile } from 'obsidian';
import type { Task } from '../../types';
import { TaskRepository } from '../persistence/TaskRepository';

/**
 * inline タスクを frontmatter タスクファイルへ変換する業務フローを担当。
 * - ソースファイルの color 読み取り
 * - 変換先ファイル作成
 * - 元タスクを wikilink へ置換
 */
export class InlineToFrontmatterConversionService {
    constructor(
        private app: App,
        private repository: TaskRepository,
    ) {}

    async convertInlineTaskToFrontmatter(
        task: Task,
        headerName: string,
        headerLevel: number,
        colorKey: string,
    ): Promise<string> {
        const sourceColor = this.getSourceFileColor(task.file, colorKey);

        const newPath = await this.repository.createFrontmatterTaskFile(
            task,
            headerName,
            headerLevel,
            sourceColor,
            colorKey,
        );

        await this.repository.replaceInlineTaskWithWikilink(task, newPath);
        return newPath;
    }

    private getSourceFileColor(filePath: string, colorKey: string): string | undefined {
        if (!colorKey.trim()) return undefined;

        const sourceFile = this.app.vault.getAbstractFileByPath(filePath);
        if (!(sourceFile instanceof TFile)) return undefined;

        const cache = this.app.metadataCache.getFileCache(sourceFile);
        const value = cache?.frontmatter?.[colorKey];
        if (value === null || value === undefined) return undefined;

        const normalized = String(value).trim();
        return normalized.length > 0 ? normalized : undefined;
    }
}
