import type { Task, TaskViewerSettings } from '../../types';
import { ParserStrategy } from './strategies/ParserStrategy';
import { ParserChain } from './strategies/ParserChain';
import { AtNotationParser } from './inline/AtNotationParser';
import { DayPlannerParser } from './inline/DayPlannerParser';
import { TasksPluginParser } from './inline/TasksPluginParser';

/**
 * TaskParser facade - delegates to the active parser strategy.
 * Call rebuildChain() to update the parser chain based on settings.
 */
export class TaskParser {
    private static strategy: ParserStrategy = new ParserChain([
        new AtNotationParser()
    ]);

    /**
     * Rebuild the parser chain based on current settings.
     * AtNotationParser is always first (native format, highest priority).
     */
    static rebuildChain(settings: TaskViewerSettings): void {
        const parsers: ParserStrategy[] = [new AtNotationParser()];
        if (settings.enableDayPlanner) {
            parsers.push(new DayPlannerParser());
        }
        if (settings.enableTasksPlugin) {
            parsers.push(new TasksPluginParser(settings.tasksPluginMapping));
        }
        this.strategy = new ParserChain(parsers);
    }

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
