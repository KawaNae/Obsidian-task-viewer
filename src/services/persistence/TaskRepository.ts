import { type App, TFile } from 'obsidian';
import type { DuplicateOptions, TvFileKeys, Task } from '../../types';
import { FileOperations } from './utils/FileOperations';
import { InlineTaskWriter } from './writers/InlineTaskWriter';
import { FrontmatterWriter } from './writers/FrontmatterWriter';
import { TaskCloner, type GeneratedChild } from './TaskCloner';
import { TaskConverter } from './TaskConverter';
import { getFileBaseName } from '../parsing/utils/TaskContent';
import { TaskLineClassifier } from '../parsing/utils/TaskLineClassifier';
import { ChildLineClassifier } from '../parsing/utils/ChildLineClassifier';
import { CodeFenceTracker } from '../../utils/CodeFenceTracker';
import type { PropertyOp } from './PropertyUpdatePlanner';

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

    /** @returns whether the write actually landed (see InlineTaskWriter). */
    async updateTaskInFile(task: Task, updatedTask: Task, childOps: PropertyOp[] = []): Promise<boolean> {
        return this.inlineWriter.updateTaskInFile(task, updatedTask, childOps);
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

    async insertSiblingAfterTask(
        task: Task,
        lineBody: string,
        opts: { afterCompletedRun?: boolean } = {}
    ): Promise<number> {
        return this.inlineWriter.insertSiblingAfterTask(task, lineBody, opts);
    }

    async insertLineAsFirstChild(task: Task, lineContent: string): Promise<number> {
        return this.inlineWriter.insertLineAsFirstChild(task, lineContent);
    }

    async appendTaskToFile(filePath: string, content: string): Promise<number> {
        return this.inlineWriter.appendTaskToFile(filePath, content);
    }

    async appendTaskWithChildren(destPath: string, content: string, task: Task): Promise<void> {
        return this.inlineWriter.appendTaskWithChildren(destPath, content, task);
    }

    // --- tv-file Task Operations ---

    /** @returns whether the write actually landed (see FrontmatterWriter). */
    async updateTvFile(
        task: Task,
        updates: Partial<Task>,
        frontmatterKeys: TvFileKeys,
        propertyOps: PropertyOp[] = []
    ): Promise<boolean> {
        return this.frontmatterWriter.updateTvFile(task, updates, frontmatterKeys, propertyOps);
    }

    async deleteTvFile(task: Task, frontmatterKeys: TvFileKeys): Promise<void> {
        return this.frontmatterWriter.deleteTvFile(task, frontmatterKeys);
    }

    async insertLineAfterTvFile(filePath: string, lineContent: string, header: string, headerLevel: number): Promise<void> {
        return this.frontmatterWriter.insertLineAfterTvFile(filePath, lineContent, header, headerLevel);
    }

    /**
     * Task を介さない frontmatter 書き込みの入口。タイマーの対象 ID や、
     * プロパティ欄のサジェストが使う（いずれも Task ではなくファイルとキーで
     * 書き先が決まる）。
     */
    async setFrontmatterKeys(filePath: string, updates: Record<string, string | null>): Promise<void> {
        return this.frontmatterWriter.setKeys(filePath, updates);
    }

    async deleteFrontmatterKeyIfValue(filePath: string, key: string, expected: string): Promise<void> {
        return this.frontmatterWriter.deleteKeyIfValue(filePath, key, expected);
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

    /**
     * Write the next instance from a gen block's output. See
     * {@link TaskCloner.insertGeneratedInstance} for what the caller owes and
     * what this layer decides.
     */
    async insertGeneratedInstance(
        task: Task,
        parentLine: string,
        flowLines: string[],
        children: GeneratedChild[],
    ): Promise<void> {
        return this.cloner.insertGeneratedInstance(task, parentLine, flowLines, children);
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
        // property 行 (- key:: value) は frontmatter へ昇格済みのため body から除外。
        // ただしフェンス内の同じ形の行は宣言ではなく見本で、frontmatter へ昇格
        // してもいないので、落とすと本文から消えるだけになる。
        const fenced = CodeFenceTracker.subtreeMask(normalized);
        return normalized.filter((line, i) => fenced[i] || !ChildLineClassifier.isPropertyLine(line));
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
