import { Task } from '../types';
import { ParserStrategy } from './parsers/ParserStrategy';
import { TaskViewerParser } from './parsers/TaskViewerParser';

/**
 * TaskParser facade - delegates to the active parser strategy.
 * Currently uses TaskViewerParser by default.
 * Future: Can switch strategies to support Tasks plugin, Day Planner, etc.
 */
export class TaskParser {
    private static strategy: ParserStrategy = new TaskViewerParser();

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
