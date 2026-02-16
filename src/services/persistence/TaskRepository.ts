import { App, TFile } from 'obsidian';
import type { FrontmatterTaskKeys, Task } from '../../types';
import { FileOperations } from './utils/FileOperations';
import { InlineTaskWriter } from './writers/InlineTaskWriter';
import { FrontmatterWriter } from './writers/FrontmatterWriter';
import { TaskCloner } from './TaskCloner';
import { TaskConverter } from './TaskConverter';
import { getFileBaseName } from '../../utils/TaskContent';

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

    async deleteTaskFromFile(task: Task): Promise<void> {
        return this.inlineWriter.deleteTaskFromFile(task);
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

    // --- Frontmatter Task Operations ---

    async updateFrontmatterTask(
        task: Task,
        updates: Partial<Task>,
        frontmatterKeys: FrontmatterTaskKeys
    ): Promise<void> {
        return this.frontmatterWriter.updateFrontmatterTask(task, updates, frontmatterKeys);
    }

    async deleteFrontmatterTask(task: Task, frontmatterKeys: FrontmatterTaskKeys): Promise<void> {
        return this.frontmatterWriter.deleteFrontmatterTask(task, frontmatterKeys);
    }

    async insertLineAfterFrontmatter(filePath: string, lineContent: string, header: string, headerLevel: number): Promise<void> {
        return this.frontmatterWriter.insertLineAfterFrontmatter(filePath, lineContent, header, headerLevel);
    }

    // --- Task Cloning Operations ---

    async duplicateTaskInFile(task: Task): Promise<void> {
        return this.cloner.duplicateTaskInFile(task);
    }

    async duplicateTaskForTomorrow(task: Task): Promise<void> {
        return this.cloner.duplicateTaskForTomorrow(task);
    }

    async duplicateTaskForWeek(task: Task): Promise<void> {
        return this.cloner.duplicateTaskForWeek(task);
    }

    async duplicateFrontmatterTask(task: Task): Promise<void> {
        return this.cloner.duplicateFrontmatterTask(task);
    }

    async duplicateFrontmatterTaskForTomorrow(task: Task, frontmatterKeys: FrontmatterTaskKeys): Promise<void> {
        return this.cloner.duplicateFrontmatterTaskForTomorrow(task, frontmatterKeys);
    }

    async duplicateFrontmatterTaskForWeek(task: Task, frontmatterKeys: FrontmatterTaskKeys): Promise<void> {
        return this.cloner.duplicateFrontmatterTaskForWeek(task, frontmatterKeys);
    }

    async insertRecurrenceForTask(task: Task, content: string, newTask?: Task): Promise<void> {
        return this.cloner.insertRecurrenceForTask(task, content, newTask);
    }

    // --- Task Conversion Operations ---

    async createFrontmatterTaskFile(
        task: Task,
        headerName: string,
        headerLevel: number,
        sourceFileColor?: string,
        frontmatterKeys?: FrontmatterTaskKeys
    ): Promise<string> {
        return this.converter.convertToFrontmatterTask(
            task,
            headerName,
            headerLevel,
            sourceFileColor,
            frontmatterKeys
        );
    }

    /**
     * タスク行 + childLines を wikilink に置き換える。
     */
    async replaceInlineTaskWithWikilink(task: Task, targetPath: string): Promise<void> {
        const linkTarget = targetPath.replace(/\.md$/, '');
        const fileName = getFileBaseName(targetPath) || 'task';
        const wikilinkLine = `- [[${linkTarget}|${fileName}]]`;

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
