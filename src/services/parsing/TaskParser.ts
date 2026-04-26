import type { Task, TaskViewerSettings } from '../../types';
import { ParserStrategy } from './strategies/ParserStrategy';
import { ParserChain } from './strategies/ParserChain';
import { TVInlineParser } from './tv-inline/TVInlineParser';
import { DayPlannerParser } from './tv-inline/DayPlannerParser';
import { TasksPluginParser } from './tv-inline/TasksPluginParser';

/**
 * TaskParser facade - delegates to the active parser strategy.
 * Call rebuildChain() to update the parser chain based on settings.
 */
export class TaskParser {
    private static strategy: ParserStrategy = new ParserChain([
        new TVInlineParser(),
    ]);

    /**
     * Rebuild the parser chain based on current settings.
     *
     * External notation parsers (tasks-plugin, day-planner) come first when
     * enabled — they're strict about their own syntax and only match lines
     * they own. TVInlineParser is always last and acts as the catch-all for
     * every remaining checkbox line (with or without @notation).
     */
    static rebuildChain(settings: TaskViewerSettings): void {
        const parsers: ParserStrategy[] = [];
        if (settings.enableDayPlanner) {
            parsers.push(new DayPlannerParser());
        }
        if (settings.enableTasksPlugin) {
            parsers.push(new TasksPluginParser(settings.tasksPluginMapping));
        }
        parsers.push(new TVInlineParser());
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
