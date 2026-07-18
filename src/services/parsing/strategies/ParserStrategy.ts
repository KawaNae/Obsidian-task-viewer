import type { ParserId, Task } from '../../../types';

/**
 * Interface for task parser strategies.
 * Allows different parsing implementations for various task notation formats.
 *
 * Implemented by line-level leaf parsers (TVInlineParser, DayPlannerParser,
 * TasksPluginParser) that each emit one specific {@link ParserId}, and by
 * the meta-strategy {@link ParserChain} that delegates to leaf parsers.
 * TVFileBuilder is NOT a strategy — file-level building (frontmatter +
 * body → Task) is a separate category with a different input shape.
 */
export interface ParserStrategy {
    /** True when this parser is read-only (no writeback support). */
    readonly isReadOnly: boolean;

    /**
     * Parse a line of text into a Task object.
     */
    parse(line: string, filePath: string, lineNumber: number): Task | null;

    /**
     * Format a Task object back into its string representation.
     */
    format(task: Task): string;
}

/**
 * Leaf parser that stamps a specific {@link ParserId} onto each Task it
 * produces. ParserChain wraps a list of these and propagates `id` to
 * `Task.parserId` after parsing.
 */
export interface LeafParserStrategy extends ParserStrategy {
    readonly id: ParserId;
}
