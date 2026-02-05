import { Task } from '../types';
import { ParserStrategy } from './parsers/ParserStrategy';
import { ParserChain } from './parsers/ParserChain';
import { TaskViewerParser } from './parsers/TaskViewerParser';

/**
 * TaskParser facade - delegates to the active parser strategy.
 * Currently uses TaskViewerParser by default.
 * 
 * To support multiple parsers simultaneously:
 * ```
 * import { ParserChain } from './parsers/ParserChain';
 * import { TaskViewerParser } from './parsers/TaskViewerParser';
 * import { DataviewParser } from './parsers/DataviewParser';
 * 
 * TaskParser.setStrategy(new ParserChain([
 *     new TaskViewerParser(),
 *     new DataviewParser(),
 * ]));
 * ```
 */
export class TaskParser {
    private static strategy: ParserStrategy = new ParserChain([
        new TaskViewerParser()
    ]);

    /**
     * Set a different parser strategy.
     * @param strategy The parser strategy to use
     */
    static setStrategy(strategy: ParserStrategy): void {
        this.strategy = strategy;
    }

    /**
     * Get the current parser strategy.
     */
    static getStrategy(): ParserStrategy {
        return this.strategy;
    }

    /**
     * Parse a line of text into a Task object.
     */
    static parse(line: string, filePath: string, lineNumber: number): Task | null {
        return this.strategy.parse(line, filePath, lineNumber);
    }

    /**
     * Format a Task object back into its string representation.
     */
    static format(task: Task): string {
        return this.strategy.format(task);
    }

    /**
     * Check if the task's status should trigger commands.
     */
    static isTriggerableStatus(task: Task): boolean {
        return this.strategy.isTriggerableStatus(task);
    }
}
