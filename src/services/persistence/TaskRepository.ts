import { App } from 'obsidian';
import type { Task, TaskViewerSettings } from '../../types';
import { FileOperations } from './utils/FileOperations';
import { InlineTaskWriter } from './writers/InlineTaskWriter';
import { FrontmatterWriter } from './writers/FrontmatterWriter';
import { TaskCloner } from './TaskCloner';

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
        private settings: TaskViewerSettings
    ) {
        this.fileOps = new FileOperations(app);
        this.inlineWriter = new InlineTaskWriter(app, this.fileOps);
        this.frontmatterWriter = new FrontmatterWriter(app, this.fileOps, settings);
        this.cloner = new TaskCloner(app, this.fileOps);
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

    async updateFrontmatterTask(task: Task, updates: Partial<Task>): Promise<void> {
        return this.frontmatterWriter.updateFrontmatterTask(task, updates);
    }

    async deleteFrontmatterTask(task: Task): Promise<void> {
        return this.frontmatterWriter.deleteFrontmatterTask(task);
    }

    async insertLineAfterFrontmatter(filePath: string, lineContent: string): Promise<void> {
        return this.frontmatterWriter.insertLineAfterFrontmatter(filePath, lineContent);
    }

    // --- Task Cloning Operations ---

    async duplicateTaskInFile(task: Task): Promise<void> {
        return this.cloner.duplicateTaskInFile(task);
    }

    async duplicateTaskForWeek(task: Task): Promise<void> {
        return this.cloner.duplicateTaskForWeek(task);
    }

    async duplicateFrontmatterTask(task: Task): Promise<void> {
        return this.cloner.duplicateFrontmatterTask(task);
    }

    async duplicateFrontmatterTaskForWeek(task: Task): Promise<void> {
        return this.cloner.duplicateFrontmatterTaskForWeek(task);
    }

    async insertRecurrenceForTask(task: Task, content: string, newTask?: Task): Promise<void> {
        return this.cloner.insertRecurrenceForTask(task, content, newTask);
    }
}
