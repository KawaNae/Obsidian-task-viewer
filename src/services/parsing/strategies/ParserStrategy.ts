import { Task } from '../../../types';

/**
 * Interface for task parser strategies.
 * Allows different parsing implementations for various task notation formats.
 */
export interface ParserStrategy {
    /**
     * Unique identifier for this parser.
     * Examples: 'tv-inline', 'tv-file', 'tasks-plugin', 'day-planner'
     */
    readonly id: string;

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

    /**
     * Check if the task's status should trigger commands (e.g., recurrence).
     */
    isTriggerableStatus(task: Task): boolean;
}
