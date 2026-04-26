import type { Task } from '../../../types';
import { ParserStrategy } from '../strategies/ParserStrategy';
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
export abstract class ReadOnlyParserBase implements ParserStrategy {
    abstract readonly id: string;
    readonly isReadOnly = true;

    abstract parse(line: string, filePath: string, lineNumber: number): Task | null;

    /** Read-only: return the original text unchanged. */
    format(task: Task): string {
        return task.originalText;
    }

    /** Read-only: never trigger flow commands. */
    isTriggerableStatus(): boolean {
        return false;
    }

    /** Build a Task from parsed fields. Sets isReadOnly: true. */
    protected buildTask(params: ReadOnlyTaskParams): Task {
        return {
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
            indent: 0,
            childIds: [],
            childLines: [],
            childLineBodyOffsets: [],
            startDate: params.startDate,
            startTime: params.startTime,
            endDate: params.endDate,
            endTime: params.endTime,
            due: params.due,
            tags: TagExtractor.fromContent(params.content),
            originalText: params.line,
            parserId: this.id,
            blockId: params.blockId,
            properties: {},
            isReadOnly: true,
        };
    }

    /** Extract trailing ^block-id from content. Returns cleaned content and blockId. */
    protected extractBlockId(content: string): { content: string; blockId?: string } {
        const match = content.match(/\s\^([A-Za-z0-9-]+)\s*$/);
        if (!match) return { content };
        return {
            content: content.slice(0, match.index).trimEnd(),
            blockId: match[1],
        };
    }

    /** Classify a line as a task checkbox. Delegates to TaskLineClassifier. */
    protected classify(line: string) {
        return TaskLineClassifier.classify(line);
    }
}
