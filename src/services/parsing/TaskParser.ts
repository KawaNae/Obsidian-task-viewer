import type { ParserId, Task, TaskViewerSettings } from '../../types';
import type { LeafParserStrategy, ParserStrategy } from './strategies/ParserStrategy';
import { ParserChain } from './strategies/ParserChain';
import { TVInlineParser } from './tv-inline/TVInlineParser';
import { DayPlannerParser } from './tv-inline/DayPlannerParser';
import { TasksPluginParser } from './tv-inline/TasksPluginParser';
import { logDebug } from '../../log/log';

/**
 * A parser that reads task lines. Every {@link ParserId} but `tv-file`, whose
 * tasks are a note's frontmatter and never reach the chain.
 */
export type LineParserId = Exclude<ParserId, 'tv-file'>;

/**
 * Which line parsers a settings object turns on, in the order the chain runs
 * them.
 *
 * External notation parsers come first when enabled — each is strict about
 * its own syntax and only claims lines it owns. `tv-inline` is always last
 * and catches every remaining checkbox line, with or without `@notation`.
 *
 * Separate from {@link TaskParser.rebuildChain} because the answer is wanted
 * in two forms: the chain wants instances, the diagnostics want names. Deriving
 * both from this list keeps a newly added parser from appearing in one and not
 * the other.
 */
export function enabledLineParserIds(settings: TaskViewerSettings): LineParserId[] {
    const ids: LineParserId[] = [];
    if (settings.enableDayPlanner) ids.push('day-planner');
    if (settings.enableTasksPlugin) ids.push('tasks-plugin');
    ids.push('tv-inline');
    return ids;
}

function makeLineParser(id: LineParserId, settings: TaskViewerSettings): LeafParserStrategy {
    switch (id) {
        case 'day-planner':  return new DayPlannerParser();
        case 'tasks-plugin': return new TasksPluginParser(settings.tasksPluginMapping);
        case 'tv-inline':    return new TVInlineParser();
    }
}

/**
 * TaskParser facade - delegates to the active parser strategy.
 * Call rebuildChain() to update the parser chain based on settings.
 */
export class TaskParser {
    private static strategy: ParserStrategy = new ParserChain([
        new TVInlineParser(),
    ]);

    /** Bumped on every strategy swap — cache invalidation signal for consumers. */
    private static generation = 0;

    private static swapStrategy(strategy: ParserStrategy): void {
        this.strategy = strategy;
        this.generation++;
    }

    /**
     * Monotonic counter identifying the active chain. Consumers that memoize
     * parse results (e.g. editor diagnostics) compare this to detect a
     * settings-driven chain rebuild and drop their caches.
     */
    static getChainGeneration(): number {
        return this.generation;
    }

    /**
     * Rebuild the parser chain based on current settings.
     *
     * Which parsers, and in what order, is {@link enabledLineParserIds}; this
     * turns that answer into instances.
     */
    static rebuildChain(settings: TaskViewerSettings): void {
        const ids = enabledLineParserIds(settings);
        const parsers: LeafParserStrategy[] = ids.map(id => makeLineParser(id, settings));
        this.swapStrategy(new ParserChain(parsers));
        logDebug(`[TaskParser:rebuildChain] parsers=[${ids}]`);
    }

    /**
     * Set a different parser strategy.
     * @param strategy The parser strategy to use
     */
    static setStrategy(strategy: ParserStrategy): void {
        this.swapStrategy(strategy);
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
            this.swapStrategy(previous);
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
