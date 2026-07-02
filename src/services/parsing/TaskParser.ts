import type { Task, TaskViewerSettings } from '../../types';
import { LeafParserStrategy, ParserStrategy } from './strategies/ParserStrategy';
import { ParserChain } from './strategies/ParserChain';
import { TVInlineParser } from './tv-inline/TVInlineParser';
import { DayPlannerParser } from './tv-inline/DayPlannerParser';
import { TasksPluginParser } from './tv-inline/TasksPluginParser';
import { logDebug } from '../../log/log';

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
        const parsers: LeafParserStrategy[] = [];
        if (settings.enableDayPlanner) {
            parsers.push(new DayPlannerParser());
        }
        if (settings.enableTasksPlugin) {
            parsers.push(new TasksPluginParser(settings.tasksPluginMapping));
        }
        parsers.push(new TVInlineParser());
        this.strategy = new ParserChain(parsers);
        logDebug(`[TaskParser:rebuildChain] parsers=[${parsers.map(p => p.id)}]`);
    }

    /**
     * Set a different parser strategy.
     * @param strategy The parser strategy to use
     */
    static setStrategy(strategy: ParserStrategy): void {
        this.strategy = strategy;
    }

    /**
     * Run `fn` with a chain built from `settings`, then restore the previous
     * strategy — even on throw. Test-only scoping helper: the static
     * strategy is process-global, so tests that need a non-default chain
     * (e.g. day-planner enabled) must not leak it into later tests.
     */
    static withChain<T>(settings: TaskViewerSettings, fn: () => T): T {
        const previous = this.strategy;
        this.rebuildChain(settings);
        try {
            return fn();
        } finally {
            this.strategy = previous;
        }
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
}
