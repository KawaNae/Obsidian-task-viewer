import type { App } from 'obsidian';
import type { DuplicateOptions, Task } from '../../types';
import { FileOperations } from './utils/FileOperations';
import { InlineTaskWriter } from './writers/InlineTaskWriter';
import { FrontmatterWriter } from './writers/FrontmatterWriter';
import { TaskCloner, type GeneratedChild } from './TaskCloner';
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

    constructor(
        private app: App,
    ) {
        this.fileOps = new FileOperations(app);
        this.inlineWriter = new InlineTaskWriter(app, this.fileOps);
        this.frontmatterWriter = new FrontmatterWriter(app, this.fileOps);
        this.cloner = new TaskCloner(app, this.fileOps);
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

    /** @returns whether the task's lines were removed (see InlineTaskWriter). */
    async deleteTaskFromFile(task: Task): Promise<boolean> {
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

    // --- Heading and frontmatter writes ---

    /** @returns 挿入した行の 0-based 行番号。ファイルが無ければ -1。 */
    async insertLineUnderHeading(filePath: string, lineContent: string, header: string, headerLevel: number): Promise<number> {
        return this.frontmatterWriter.insertLineUnderHeading(filePath, lineContent, header, headerLevel);
    }

    /**
     * Task を介さない frontmatter 書き込みの入口。プロパティ欄のサジェストが
     * 使う（Task ではなくファイルとキーで書き先が決まる）。
     */
    async setFrontmatterKeys(filePath: string, updates: Record<string, string | null>): Promise<void> {
        return this.frontmatterWriter.setKeys(filePath, updates);
    }

    // --- Task Cloning Operations ---

    /** @returns whether the copy was written (see TaskCloner). */
    async duplicateInlineTask(task: Task, options?: DuplicateOptions): Promise<boolean> {
        return this.cloner.duplicateInlineTask(task, options);
    }

    /** @returns whether the copies were written (see TaskCloner). */
    async duplicateInlineTaskInPlace(task: Task, copyLines: string[]): Promise<boolean> {
        return this.cloner.duplicateInlineTaskInPlace(task, copyLines);
    }

    async insertRecurrenceForTask(task: Task, content: string, flowLines: string[] = []): Promise<void> {
        return this.cloner.insertRecurrenceForTask(task, content, flowLines);
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
}
