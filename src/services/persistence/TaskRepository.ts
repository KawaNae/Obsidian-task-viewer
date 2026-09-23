import type { App } from 'obsidian';
import type { DuplicateOptions, Task } from '../../types';
import { FileOperations } from './utils/FileOperations';
import { InlineTaskWriter } from './writers/InlineTaskWriter';
import { FrontmatterWriter } from './writers/FrontmatterWriter';
import { TaskCloner, type InPlaceCopyLines } from './TaskCloner';
import type { PropertyOp } from './PropertyUpdatePlanner';
import { WriteObserver } from './WriteObserver';
import type { EditorLine, WriteAt, WriteOrigin, WriteOutcome } from '../../utils/FileLines';
import type { PlannedTarget } from './TaskRefs';
import type { TaskOp } from './TaskOps';

/**
 * TaskRepository - タスクのファイル操作を統括するファサードクラス
 * 各種ライター（InlineTaskWriter, FrontmatterWriter, TaskCloner）に処理を委譲
 */
export class TaskRepository {
    private fileOps: FileOperations;
    private inlineWriter: InlineTaskWriter;
    private frontmatterWriter: FrontmatterWriter;
    private cloner: TaskCloner;
    /**
     * Where the writers say what they did to a file's lines. Handed out here
     * and connected by the index once its scanner exists (see WriteObserver).
     */
    private readonly writes = new WriteObserver();

    constructor(
        private app: App,
    ) {
        this.fileOps = new FileOperations(app);
        this.inlineWriter = new InlineTaskWriter(app, this.fileOps, this.writes);
        this.frontmatterWriter = new FrontmatterWriter(app, this.fileOps, this.writes);
        this.cloner = new TaskCloner(app, this.fileOps, this.writes);
    }

    /** @internal For the index to connect and, on dispose, to cut. */
    getWriteObserver(): WriteObserver {
        return this.writes;
    }

    // --- Inline Task Operations ---

    /** @returns what became of the write, and the row as it left it (see InlineTaskWriter). */
    async updateTaskInFile(target: PlannedTarget, updatedTask: Task, childOps: PropertyOp[] = []): Promise<WriteOutcome> {
        return this.inlineWriter.updateTaskInFile(target, updatedTask, childOps);
    }

    async updateLine(filePath: string, at: EditorLine, newContent: string): Promise<WriteOutcome> {
        return this.inlineWriter.updateLine(filePath, at, newContent);
    }

    async insertLineAfterLine(filePath: string, at: EditorLine, newContent: string): Promise<WriteOutcome> {
        return this.inlineWriter.insertLineAfterLine(filePath, at, newContent);
    }

    async deleteLine(filePath: string, at: EditorLine): Promise<WriteOutcome> {
        return this.inlineWriter.deleteLine(filePath, at);
    }

    /** @returns whether the task's lines were removed (see InlineTaskWriter). */
    async deleteTaskFromFile(target: PlannedTarget): Promise<WriteOutcome> {
        return this.inlineWriter.deleteTaskFromFile(target);
    }

    /**
     * Everything one operation does to one row, as one write
     * (see {@link InlineTaskWriter.applyToTask}).
     */
    async applyToTask(
        target: PlannedTarget,
        ops: readonly TaskOp[],
        opts: { tellRefusal?: boolean } = {},
    ): Promise<WriteOutcome> {
        return this.inlineWriter.applyToTask(target, ops, opts);
    }

    async insertLineAfterTask(task: Task, lineContent: string): Promise<WriteOutcome> {
        return this.inlineWriter.insertLineAfterTask(task, lineContent);
    }

    async insertSiblingAfterTask(
        task: Task,
        lineBody: string,
        opts: { afterCompletedRun?: boolean } = {}
    ): Promise<WriteOutcome> {
        return this.inlineWriter.insertSiblingAfterTask(task, lineBody, opts);
    }

    async insertLineAsFirstChild(task: Task, lineContent: string): Promise<WriteOutcome> {
        return this.inlineWriter.insertLineAsFirstChild(task, lineContent);
    }

    async appendTaskToFile(filePath: string, content: string, origin: WriteOrigin): Promise<WriteAt> {
        return this.inlineWriter.appendTaskToFile(filePath, content, origin);
    }

    /** @returns the source subtree archived, or null when nothing was written (see InlineTaskWriter). */
    async appendTaskWithChildren(
        destPath: string,
        content: string,
        source: PlannedTarget,
    ): Promise<readonly string[] | null> {
        return this.inlineWriter.appendTaskWithChildren(destPath, content, source);
    }

    // --- Heading and frontmatter writes ---

    /** @returns 挿入した行の 0-based 行番号。ファイルが無ければ -1。 */
    async insertLineUnderHeading(filePath: string, lineContent: string, header: string, headerLevel: number): Promise<WriteAt> {
        return this.frontmatterWriter.insertLineUnderHeading(filePath, lineContent, header, headerLevel);
    }

    /**
     * Task を介さない frontmatter 書き込みの入口。プロパティ欄のサジェストが
     * 使う（Task ではなくファイルとキーで書き先が決まる）。
     */
    async setFrontmatterKeys(filePath: string, updates: Record<string, string | null>): Promise<WriteOutcome> {
        return this.frontmatterWriter.setKeys(filePath, updates);
    }

    // --- Task Cloning Operations ---

    /** @returns whether the copy was written (see TaskCloner). */
    async duplicateInlineTask(target: PlannedTarget, options?: DuplicateOptions): Promise<WriteOutcome> {
        return this.cloner.duplicateInlineTask(target, options);
    }

    /** @returns whether the copies were written (see TaskCloner). */
    async duplicateInlineTaskInPlace(target: PlannedTarget, copies: InPlaceCopyLines): Promise<WriteOutcome> {
        return this.cloner.duplicateInlineTaskInPlace(target, copies);
    }

}
