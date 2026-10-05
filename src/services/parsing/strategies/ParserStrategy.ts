import type { ParserId } from '../../../types';
import type { UnnamedTask } from '../TaskFactory';

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
     * Parse a line of text into a task, unnamed: a name is the reader's to
     * give (`NoteTasks`).
     */
    parse(line: string, filePath: string, lineNumber: number): UnnamedTask | null;
}

/**
 * Leaf parser that stamps its {@link ParserId} onto each task it produces
 * (`Task.parserId`, through `createBaseTask`). ParserChain wraps a list of
 * these.
 */
export interface LeafParserStrategy extends ParserStrategy {
    readonly id: ParserId;
}
