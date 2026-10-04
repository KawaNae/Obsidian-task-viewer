import type { DisplayTask, Task } from '../../../src/types';
import type { FilterContext } from '../../../src/services/filter/FilterContext';
import type { FilterState } from '../../../src/services/filter/FilterTypes';
import { TaskFilterEngine } from '../../../src/services/filter/TaskFilterEngine';
import { compileFilter } from '../../../src/services/filter/FilterExpr';
import { toDisplayTask } from '../../../src/services/display/DisplayTaskConverter';

/**
 * A FilterContext for tests: the day starting at midnight, the week on
 * Monday, no ancestors, the real clock — each overridable. The defaults live
 * here, not in the engine.
 */
export function testContext(overrides: Partial<FilterContext> = {}): FilterContext {
    return {
        startHour: 0,
        weekStartDay: 1,
        taskLookup: () => undefined,
        now: new Date(),
        ...overrides,
    };
}

/**
 * Evaluate a filter as the plugin does — on a display copy, compiled, then
 * evaluated — in {@link testContext} with `overrides`. A raw Task is
 * converted first, in the context's startHour.
 */
export function evaluateFilter(
    task: DisplayTask | Task,
    state: FilterState,
    overrides: Partial<FilterContext> = {},
): boolean {
    const context = testContext(overrides);
    const dt = 'stated' in task ? task : toDisplayTask(task, context.startHour, context.taskLookup);
    return TaskFilterEngine.evaluate(dt, compileFilter(state), context);
}
