import type { ParserId, TaskViewerSettings } from '../../types';
import type { LeafParserStrategy } from './strategies/ParserStrategy';
import { ParserChain } from './strategies/ParserChain';
import { TVInlineParser } from './tv-inline/TVInlineParser';
import { DayPlannerParser } from './tv-inline/DayPlannerParser';
import { TasksPluginParser } from './tv-inline/TasksPluginParser';

/**
 * Which line parsers a settings object turns on, in the order the chain runs
 * them.
 *
 * External notation parsers come first when enabled — each is strict about
 * its own syntax and only claims lines it owns. `tv-inline` is always last
 * and catches every remaining checkbox line, with or without `@notation`.
 *
 * Separate from {@link lineParsers} because the answer is wanted in two
 * forms: the chain wants instances, the diagnostics want names. Deriving
 * both from this list keeps a newly added parser from appearing in one and
 * not the other.
 */
export function enabledLineParserIds(settings: TaskViewerSettings): ParserId[] {
    const ids: ParserId[] = [];
    if (settings.enableDayPlanner) ids.push('day-planner');
    if (settings.enableTasksPlugin) ids.push('tasks-plugin');
    ids.push('tv-inline');
    return ids;
}

function makeLineParser(id: ParserId, settings: TaskViewerSettings): LeafParserStrategy {
    switch (id) {
        case 'day-planner':  return new DayPlannerParser();
        case 'tasks-plugin': return new TasksPluginParser(settings.tasksPluginMapping);
        case 'tv-inline':    return new TVInlineParser();
    }
}

/**
 * The parser chain these settings read task lines with: which parsers, and
 * in what order, is {@link enabledLineParserIds}; this turns that answer
 * into instances.
 *
 * A pure function of the settings, with no chain held anywhere: whoever
 * reads lines (the file parse, the editor's diagnostics) builds it from the
 * settings it was handed. The parsers hold nothing but the Tasks mapping, so
 * building one costs a few allocations.
 */
export function lineParsers(settings: TaskViewerSettings): ParserChain {
    return new ParserChain(enabledLineParserIds(settings).map(id => makeLineParser(id, settings)));
}

/**
 * What of the settings {@link lineParsers} reads, as a string: two settings
 * with the same fingerprint read every line the same way. For whoever keeps
 * what a chain read and must know when to read again (the editor's
 * diagnostics cache, the index's re-scan decision).
 */
export function lineParsersFingerprint(settings: TaskViewerSettings): string {
    return JSON.stringify([enabledLineParserIds(settings), settings.tasksPluginMapping]);
}
