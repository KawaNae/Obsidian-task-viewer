import type { Task } from '../../types';

/**
 * What a filter is evaluated against besides the task: the settings that
 * place a day and a week, the index that resolves an ancestor, and the clock
 * relative date presets count from.
 *
 * Every field is required: a default here would decide the meaning of a
 * filter (the week starting on Monday, the day at midnight, no ancestors)
 * without anyone choosing it. `TaskReadService` builds the one context the
 * plugin evaluates with; tests build theirs with `testContext()`.
 *
 * Lives apart from FilterTypes on purpose: this is the only filter type
 * that references Task, and keeping it out of FilterTypes preserves the
 * type-dependency DAG (types/index.ts imports FilterTypes for FilterState;
 * FilterTypes must therefore never import types back).
 */
export interface FilterContext {
    readonly startHour: number;
    readonly weekStartDay: 0 | 1;
    readonly taskLookup: (id: string) => Task | undefined;
    /** The moment relative presets (`today`, `thisWeek`, ...) count from. */
    readonly now: Date;
}
