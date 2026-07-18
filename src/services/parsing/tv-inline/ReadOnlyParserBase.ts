import type { ParserId, Task } from '../../../types';
import type { LeafParserStrategy } from '../strategies/ParserStrategy';
import { createBaseTask } from '../TaskFactory';
import { TaskIdGenerator } from '../../display/TaskIdGenerator';
import { TagExtractor } from '../utils/TagExtractor';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';

export interface ReadOnlyTaskParams {
    filePath: string;
    lineNumber: number;
    line: string;
    content: string;
    statusChar: string;
    startDate?: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    due?: string;
    blockId?: string;
}

/**
 * Abstract base class for read-only parsers.
 * Read-only parsers parse external task formats for display only — no writeback.
 */
export abstract class ReadOnlyParserBase implements LeafParserStrategy {
    abstract readonly id: ParserId;
    readonly isReadOnly = true;

    abstract parse(line: string, filePath: string, lineNumber: number): Task | null;

    /** Read-only: return the original text unchanged. */
    format(task: Task): string {
        return task.originalText;
    }

    /** Build a Task from parsed fields. Sets isReadOnly: true. */
    protected buildTask(params: ReadOnlyTaskParams): Task {
        return createBaseTask({
            id: TaskIdGenerator.generate(
                this.id,
                params.filePath,
                TaskIdGenerator.resolveAnchor({
                    parserId: this.id,
                    line: params.lineNumber,
                    blockId: params.blockId,
                }),
            ),
            file: params.filePath,
            line: params.lineNumber,
            content: params.content,
            statusChar: params.statusChar,
            parserId: this.id,
            originalText: params.line,
        }, {
            startDate: params.startDate,
            startTime: params.startTime,
            endDate: params.endDate,
            endTime: params.endTime,
            due: params.due,
            tags: TagExtractor.fromContent(params.content),
            blockId: params.blockId,
            isReadOnly: true,
        });
    }

    /** Extract trailing ^block-id from content. Delegates to the shared implementation. */
    protected extractBlockId(content: string): { content: string; blockId?: string } {
        const { text, blockId } = TaskLineClassifier.extractBlockId(content);
        return { content: text, blockId };
    }

    /** Classify a line as a task checkbox. Delegates to TaskLineClassifier. */
    protected classify(line: string) {
        return TaskLineClassifier.classify(line);
    }
}
