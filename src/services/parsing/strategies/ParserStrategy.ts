import type { ParserId, Task } from '../../../types';

/**
 * Reads a line as a task, or declines it.
 * Allows different parsing implementations for various task notation formats.
 *
 * Implemented by line-level leaf parsers (TVInlineParser, DayPlannerParser,
 * TasksPluginParser) that each emit one specific {@link ParserId}, and by
 * the meta-strategy {@link ParserChain} that delegates to leaf parsers.
 *
 * Writing a line is not a parser's job: every line the plugin writes is
 * spelled by `TaskLineFormat` (`formatTaskLine`, `formatRow`).
 */
export interface ParserStrategy {
    /**
     * Parse a line of text into a Task object.
     */
    parse(line: string, filePath: string, lineNumber: number): Task | null;
}

/**
 * Leaf parser that stamps a specific {@link ParserId} onto each Task it
 * produces. ParserChain wraps a list of these and propagates `id` to
 * `Task.parserId` after parsing.
 */
export interface LeafParserStrategy extends ParserStrategy {
    readonly id: ParserId;
}
