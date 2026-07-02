import { App, TFile } from 'obsidian';
import type { DuplicateOptions, TvFileKeys, Task } from '../../types';
import { FileOperations } from './utils/FileOperations';
import { InlineTaskWriter } from './writers/InlineTaskWriter';
import { FrontmatterWriter } from './writers/FrontmatterWriter';
import { TaskCloner } from './TaskCloner';
import { TaskConverter } from './TaskConverter';
import { getFileBaseName } from '../parsing/utils/TaskContent';
import { TaskLineClassifier } from '../parsing/utils/TaskLineClassifier';
import { ChildLineClassifier } from '../parsing/utils/ChildLineClassifier';

/**
 * TaskRepository - タスクのファイル操作を統括するファサードクラス
 * 各種ライター（InlineTaskWriter, FrontmatterWriter, TaskCloner）に処理を委譲
 */
export class TaskRepository {
    private fileOps: FileOperations;
    private inlineWriter: InlineTaskWriter;
    private frontmatterWriter: FrontmatterWriter;
    private cloner: TaskCloner;
    private converter: TaskConverter;

    constructor(
        private app: App,
    ) {
        this.fileOps = new FileOperations(app);
        this.inlineWriter = new InlineTaskWriter(app, this.fileOps);
        this.frontmatterWriter = new FrontmatterWriter(app, this.fileOps);
        this.cloner = new TaskCloner(app, this.fileOps);
        this.converter = new TaskConverter(app, this.fileOps);
    }

    // --- Inline Task Operations ---

    async updateTaskInFile(task: Task, updatedTask: Task): Promise<void> {
        return this.inlineWriter.updateTaskInFile(task, updatedTask);
    }

    async updateLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        return this.inlineWriter.updateLine(filePath, lineNumber, newContent);
    }

    async insertLineAfterLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        return this.inlineWriter.insertLineAfterLine(filePath, lineNumber, newContent);
    }

    async deleteLine(filePath: string, lineNumber: number): Promise<void> {
        return this.inlineWriter.deleteLine(filePath, lineNumber);
    }

    async deleteTaskFromFile(task: Task): Promise<void> {
        return this.inlineWriter.deleteTaskFromFile(task);
    }

    async stripFlow(task: Task): Promise<void> {
        return this.inlineWriter.stripFlow(task);
    }

    async insertLineAfterTask(task: Task, lineContent: string): Promise<number> {
        return this.inlineWriter.insertLineAfterTask(task, lineContent);
    }

    async insertLineAsFirstChild(task: Task, lineContent: string): Promise<number> {
        return this.inlineWriter.insertLineAsFirstChild(task, lineContent);
    }

    async appendTaskToFile(filePath: string, content: string): Promise<void> {
        return this.inlineWriter.appendTaskToFile(filePath, content);
    }

    async appendTaskWithChildren(destPath: string, content: string, task: Task): Promise<void> {
        return this.inlineWriter.appendTaskWithChildren(destPath, content, task);
    }

    // --- tv-file Task Operations ---

    async updateTvFile(
        task: Task,
        updates: Partial<Task>,
        frontmatterKeys: TvFileKeys
    ): Promise<void> {
        return this.frontmatterWriter.updateTvFile(task, updates, frontmatterKeys);
    }

    async deleteTvFile(task: Task, frontmatterKeys: TvFileKeys): Promise<void> {
        return this.frontmatterWriter.deleteTvFile(task, frontmatterKeys);
    }

    async insertLineAfterTvFile(filePath: string, lineContent: string, header: string, headerLevel: number): Promise<void> {
        return this.frontmatterWriter.insertLineAfterTvFile(filePath, lineContent, header, headerLevel);
    }

    // --- Task Cloning Operations ---

    async duplicateInlineTask(task: Task, options?: DuplicateOptions): Promise<void> {
        return this.cloner.duplicateInlineTask(task, options);
    }

    async duplicateTvFile(task: Task, keys: TvFileKeys, options?: DuplicateOptions): Promise<void> {
        return this.cloner.duplicateTvFile(task, keys, options);
    }

    async insertRecurrenceForTask(task: Task, content: string, copyChildren = true, flowLines: string[] = []): Promise<void> {
        return this.cloner.insertRecurrenceForTask(task, content, copyChildren, flowLines);
    }

    // --- Task Conversion Operations ---

    async createTvFile(
        task: Task,
        headerName: string,
        headerLevel: number,
        sourceFileColor?: string,
        sourceSharedTags?: string[],
        frontmatterKeys?: TvFileKeys,
        bodyChildLines: string[] = []
    ): Promise<string> {
        return this.converter.convertToTvFile(
            task,
            headerName,
            headerLevel,
            sourceFileColor,
            sourceSharedTags,
            frontmatterKeys,
            bodyChildLines
        );
    }

    /**
     * 変換元ファイルから親タスク直下の生の子行を収集し、tv-file body 用に
     * 正規化する(最浅インデント除去・property 行除外)。@notation 子・孫・説明文・
     * 通常チェックボックスを区別せず全て含む — replaceInlineTaskWithWikilink の
     * 削除範囲(collectChildrenFromLines)と同一ソースなので、消すのに移さない
     * (データ消失)が起きない。
     */
    async collectChildBodyLines(task: Task): Promise<string[]> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return [];

        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        const idx = this.fileOps.findTaskLineNumber(lines, task);
        if (idx < 0 || idx >= lines.length) return [];

        const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, idx);
        const firstChild = childrenLines.find(l => l.trim() !== '');
        const childIndent = firstChild ? (firstChild.match(/^\s*/)?.[0] ?? '') : '';
        const normalized = FileOperations.adjustChildIndentation(childrenLines, childIndent);
        // property 行 (- key:: value) は frontmatter へ昇格済みのため body から除外
        return normalized.filter(line => !ChildLineClassifier.isPropertyLine(line));
    }

    /**
     * タスク行 + childLines を wikilink に置き換える。
     */
    async replaceInlineTaskWithWikilink(task: Task, targetPath: string): Promise<void> {
        const linkTarget = targetPath.replace(/\.md$/, '');
        const fileName = getFileBaseName(targetPath) || 'task';
        const marker = TaskLineClassifier.extractMarker(task.originalText);
        const wikilinkLine = `${marker} [[${linkTarget}|${fileName}]]`;

        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return content;

            // 元のインデントを保持
            const originalIndent = lines[currentLine].match(/^(\s*)/)?.[1] || '';

            // childLines を収集して削除範囲を決定
            const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);

            // task + children を wikilink に置き換え
            lines.splice(currentLine, 1 + childrenLines.length, originalIndent + wikilinkLine);

            return lines.join('\n');
        });
    }
}
