import type { App } from 'obsidian';
import type { DuplicateOptions, Task } from '../../types';
import { FileOperations } from './utils/FileOperations';
import { InlineTaskWriter } from './writers/InlineTaskWriter';
import { SendWriter, type SendCompleting, type SendOutcome, type SendTo, type SentRow } from './writers/SendWriter';
import { FrontmatterWriter } from './writers/FrontmatterWriter';
import { TaskCloner, type InPlaceCopyLines } from './TaskCloner';
import type { PropertyOp } from './PropertyUpdatePlanner';
import type { EditorLine, LineDraft, Refusal, RowTarget, WriteAt, WriteChannel, WriteOutcome, WriteSession } from './FileLines';
import type { PlannedTarget } from './TaskRefs';
import type { CompletionFire, FiringOutcome, SubtreeReplacement, TaskOp } from './TaskOps';
import type { Section } from './Destination';

/**
 * TaskRepository - タスクのファイル操作を統括するファサードクラス
 * 各種ライター（InlineTaskWriter, FrontmatterWriter, TaskCloner）に処理を委譲
 */
export class TaskRepository {
    private fileOps: FileOperations;
    private inlineWriter: InlineTaskWriter;
    private frontmatterWriter: FrontmatterWriter;
    private cloner: TaskCloner;
    private sendWriter: SendWriter;
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
        this.sendWriter = new SendWriter(app, this.inlineWriter, this.fileOps, channelOf);
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
    async updateTaskInFile<F extends CompletionFire>(target: PlannedTarget, updatedTask: Task, childOps: PropertyOp[] = [], fire?: F): Promise<FiringOutcome<F>> {
        return this.inlineWriter.updateTaskInFile(target, updatedTask, childOps, fire);
    }

    /** The row and its subtree written anew, each row it completes fired (see InlineTaskWriter.replaceSubtreeInFile). */
    async replaceSubtreeInFile<F extends CompletionFire>(
        target: PlannedTarget,
        replacement: SubtreeReplacement,
        completing: { completes(before: string, after: string): boolean; fire(): F },
        opts: { refused?: (refusal: Refusal) => void } = {},
    ): Promise<FiringOutcome<F>> {
        return this.inlineWriter.replaceSubtreeInFile(target, replacement, completing, opts);
    }

    /** Rows and their subtrees sent to a section of a note, what went taken back when a note they came from refused (see SendWriter.send). */
    async send<F extends CompletionFire>(
        rows: ReadonlyArray<{ file: string; row: SentRow }>,
        to: SendTo,
        completing: SendCompleting<F>,
        opts: { refused?: (refusal: Refusal) => void } = {},
    ): Promise<SendOutcome<F>> {
        return this.sendWriter.send(rows, to, completing, opts);
    }

    /** The one loop that applies ops to a row, inside a write (see InlineTaskWriter.applyOps). */
    applyOps(draft: LineDraft, session: WriteSession, target: RowTarget, ops: readonly TaskOp[]): boolean {
        return this.inlineWriter.applyOps(draft, session, target, ops);
    }

    /** Ops applied to the row at a line the editor pointed at, as `at` holds it (see InlineTaskWriter.applyToLine). */
    async applyToLine<F extends CompletionFire>(filePath: string, at: EditorLine, ops: readonly TaskOp[], opts: { refused?: (refusal: Refusal) => void; fire?: F } = {}): Promise<FiringOutcome<F>> {
        return this.inlineWriter.applyToLine(filePath, at, ops, opts);
    }

    /**
     * Everything one operation does to one row, as one write
     * (see {@link InlineTaskWriter.applyToTask}).
     */
    async applyToTask(
        target: PlannedTarget,
        ops: readonly TaskOp[],
        opts: { refused?: (refusal: Refusal) => void } = {},
    ): Promise<WriteOutcome> {
        return this.inlineWriter.applyToTask(target, ops, opts);
    }

    async appendTaskToFile(filePath: string, content: string): Promise<WriteAt> {
        return this.inlineWriter.appendTaskToFile(filePath, content);
    }

    // --- Heading and frontmatter writes ---

    /** @returns 挿入した行の 0-based 行番号。ファイルが無ければ -1。 */
    async insertLineUnderHeading(filePath: string, lineContent: string, to: Section): Promise<WriteAt> {
        return this.frontmatterWriter.insertLineUnderHeading(filePath, lineContent, to);
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
