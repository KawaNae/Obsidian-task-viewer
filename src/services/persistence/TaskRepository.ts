import type { App } from 'obsidian';
import { InlineTaskWriter } from './writers/InlineTaskWriter';
import { SendWriter, type SendCompleting, type SendHearing, type SendOutcome, type SendTo, type SentRow } from './writers/SendWriter';
import { FrontmatterWriter } from './writers/FrontmatterWriter';
import type { LineDraft, Refusal, RowRef, RowTarget, WriteAt, WriteChannel, WriteOutcome, WriteSession } from './FileLines';
import type { CompletionFire, FiringOutcome, SubtreeReplacement, TaskOp } from './TaskOps';
import type { Section } from './Destination';

/**
 * The write layer as the index holds it: the writers, built over the one
 * channel the index connects, and the ways in to them. It keeps no state but
 * that channel, and every way in is a writer's own.
 */
export class TaskRepository {
    private inlineWriter: InlineTaskWriter;
    private frontmatterWriter: FrontmatterWriter;
    private sendWriter: SendWriter;
    /**
     * Where the writers hand what they left and say what they gave up: the
     * channel the index connected, or null before it has and once it has cut
     * it (see `WriteChannels`).
     */
    private channels: ((file: string) => WriteChannel) | null = null;

    constructor(app: App) {
        const channelOf = (file: string) => this.channelOf(file);
        this.inlineWriter = new InlineTaskWriter(app, channelOf);
        this.frontmatterWriter = new FrontmatterWriter(app, channelOf);
        this.sendWriter = new SendWriter(app, this.inlineWriter, channelOf);
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

    // --- Rows ---

    /** Ops applied to the row `target` names, as one write, with the row's fire when it completes (see InlineTaskWriter.write). */
    async write<F extends CompletionFire = CompletionFire>(
        file: string,
        target: RowRef,
        ops: readonly TaskOp[],
        opts: { fire?: F; refused?: (refusal: Refusal) => void } = {},
    ): Promise<FiringOutcome<F>> {
        return this.inlineWriter.write(file, target, ops, opts);
    }

    /** The row and its subtree written anew, each row it completes fired (see InlineTaskWriter.replaceSubtreeInFile). */
    async replaceSubtree<F extends CompletionFire>(
        file: string,
        target: RowRef,
        replacement: SubtreeReplacement,
        completing: { completes(before: string, after: string): boolean; fire(): F },
        opts: { refused?: (refusal: Refusal) => void } = {},
    ): Promise<FiringOutcome<F>> {
        return this.inlineWriter.replaceSubtreeInFile(file, target, replacement, completing, opts);
    }

    /** Rows and their subtrees sent to a section of a note, what went taken back when a note they came from refused (see SendWriter.send). */
    async send<F extends CompletionFire>(
        rows: ReadonlyArray<{ file: string; row: SentRow }>,
        to: SendTo,
        completing: SendCompleting<F>,
        opts: SendHearing = {},
    ): Promise<SendOutcome<F>> {
        return this.sendWriter.send(rows, to, completing, opts);
    }

    /** The one loop that applies ops to a row, inside a write (see InlineTaskWriter.applyOps). */
    applyOps(draft: LineDraft, session: WriteSession, target: RowTarget, ops: readonly TaskOp[]): boolean {
        return this.inlineWriter.applyOps(draft, session, target, ops);
    }

    async appendTaskToFile(filePath: string, content: string): Promise<WriteAt> {
        return this.inlineWriter.appendTaskToFile(filePath, content);
    }

    // --- Heading and frontmatter writes ---

    /** @returns 挿入した行の 0-based 行番号を持つ書き込みの結果か、拒否。 */
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
}
