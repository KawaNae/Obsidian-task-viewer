import { App, TFile } from 'obsidian';
import type { TvFileKeys, Task } from '../../types';
import { TaskRepository } from '../persistence/TaskRepository';
import { TagExtractor } from '../parsing/utils/TagExtractor';

/**
 * tv-inline タスクを tv-file タスクへ変換する業務フローを担当。
 * - ソースファイルの color / tags 読み取り
 * - 変換先ファイル作成
 * - 元タスクを wikilink へ置換
 */
export class TvInlineToTvFileConverter {
    constructor(
        private app: App,
        private repository: TaskRepository,
    ) {}

    async convertTvInlineToTvFile(
        task: Task,
        headerName: string,
        headerLevel: number,
        frontmatterKeys: TvFileKeys,
    ): Promise<string> {
        const sourceColor = this.getSourceFileColor(task.file, frontmatterKeys.color);
        const sourceSharedTags = this.getSourceFileSharedTags(task.file);

        // 削除範囲(replaceInlineTaskWithWikilink)と同一の生子行を移送する。
        // @notation 子・孫・説明文を含む全子要素が tv-file へ引き継がれる。
        const bodyChildLines = await this.repository.collectChildBodyLines(task);

        const newPath = await this.repository.createTvFile(
            task,
            headerName,
            headerLevel,
            sourceColor,
            sourceSharedTags,
            frontmatterKeys,
            bodyChildLines,
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

    private getSourceFileSharedTags(filePath: string): string[] {
        const sourceFile = this.app.vault.getAbstractFileByPath(filePath);
        if (!(sourceFile instanceof TFile)) return [];

        const cache = this.app.metadataCache.getFileCache(sourceFile);
        return TagExtractor.fromFrontmatter(cache?.frontmatter?.['tags']);
    }
}
