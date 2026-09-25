import type { App } from 'obsidian';
import type { DuplicateOptions, Task } from '../../types';
import { FileOperations } from './utils/FileOperations';
import { InlineTaskWriter } from './writers/InlineTaskWriter';
import { FrontmatterWriter } from './writers/FrontmatterWriter';
import { TaskCloner, type InPlaceCopyLines } from './TaskCloner';
import type { PropertyOp } from './PropertyUpdatePlanner';
import type { EditorLine, EditorSubtree, LineDraft, NamedRow, WriteAt, WriteChannel, WriteOutcome, WriteSession } from '../../utils/FileLines';
import type { PlacedLine } from './utils/Placement';
import type { InsertTarget, PlannedTarget } from './TaskRefs';
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
     * Where the writers hand what they left and say what they gave up: the
     * channel the index connected, or null before it has and once it has cut
     * it (see `WriteChannels`).
     */
    private channels: ((file: string) => WriteChannel) | null = null;

    constructor(
        private app: App,
    ) {
        this.fileOps = new FileOperations(app);
        const channelOf = (file: string) => this.channelOf(file);
        this.inlineWriter = new InlineTaskWriter(app, this.fileOps, channelOf);
        this.frontmatterWriter = new FrontmatterWriter(app, this.fileOps, channelOf);
        this.cloner = new TaskCloner(app, this.fileOps, channelOf);
    }

    /** @internal For the index to connect once its scanner exists. */
    connect(channels: (file: string) => WriteChannel): void {
        this.channels = channels;
    }

    /** @internal For the index to cut on dispose: a write after it lands nothing and tells nobody. */
    disconnect(): void {
        this.channels = null;
    }

    /** The channel for a write to `file`, or undefined while nothing is connected. */
    channelOf(file: string): WriteChannel | undefined {
        return this.channels?.(file);
    }

    // --- Inline Task Operations ---

    /** @returns what became of the write, and the row as it left it (see InlineTaskWriter). */
    async updateTaskInFile(target: PlannedTarget, updatedTask: Task, childOps: PropertyOp[] = [], fire?: TaskOp): Promise<WriteOutcome> {
        return this.inlineWriter.updateTaskInFile(target, updatedTask, childOps, fire);
    }

    async updateLine(filePath: string, at: EditorLine, newContent: string, fire?: TaskOp): Promise<WriteOutcome> {
        return this.inlineWriter.updateLine(filePath, at, newContent, fire);
    }

    /** The one loop that applies ops to a row, inside a write (see InlineTaskWriter.applyOps). */
    applyOps(draft: LineDraft, session: WriteSession, target: NamedRow | EditorLine, ops: readonly TaskOp[]): boolean {
        return this.inlineWriter.applyOps(draft, session, target, ops);
    }

    /** Ops applied to the row at a coordinate, as `at` holds it (see InlineTaskWriter.applyToLine). */
    async applyToLine(filePath: string, at: EditorSubtree, ops: readonly TaskOp[], opts: { tellRefusal?: boolean } = {}): Promise<WriteOutcome> {
        return this.inlineWriter.applyToLine(filePath, at, ops, opts);
    }

    /** What a move to another file writes to the destination (see InlineTaskWriter.archiveOf). */
    archiveOf(lines: readonly string[], line: number, content: string): { block: PlacedLine[]; subtree: string[] } {
        return this.inlineWriter.archiveOf(lines, line, content);
    }

    /** Append a move's archive to the destination: whether it was written (see InlineTaskWriter.appendArchive). */
    async appendArchive(destPath: string, block: readonly PlacedLine[]): Promise<boolean> {
        return this.inlineWriter.appendArchive(destPath, block);
    }

    async insertLineAfterLine(filePath: string, at: EditorLine, newContent: string): Promise<WriteOutcome> {
        return this.inlineWriter.insertLineAfterLine(filePath, at, newContent);
    }

    async deleteLine(filePath: string, at: EditorSubtree): Promise<WriteOutcome> {
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

    async insertLineAfterTask(target: InsertTarget, lineContent: string): Promise<WriteOutcome> {
        return this.inlineWriter.insertLineAfterTask(target, lineContent);
    }

    async insertSiblingAfterTask(
        target: InsertTarget,
        lineBody: string,
        opts: { afterCompletedRun?: boolean } = {}
    ): Promise<WriteOutcome> {
        return this.inlineWriter.insertSiblingAfterTask(target, lineBody, opts);
    }

    async insertLineAsFirstChild(target: InsertTarget, lineContent: string): Promise<WriteOutcome> {
        return this.inlineWriter.insertLineAsFirstChild(target, lineContent);
    }

    async appendTaskToFile(filePath: string, content: string): Promise<WriteAt> {
        return this.inlineWriter.appendTaskToFile(filePath, content);
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
