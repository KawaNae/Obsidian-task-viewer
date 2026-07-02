import type { Task } from '../../types';

/**
 * Optional context for filter evaluation (e.g., view-level settings).
 *
 * Lives apart from FilterTypes on purpose: this is the only filter type
 * that references Task, and keeping it out of FilterTypes preserves the
 * type-dependency DAG (types/index.ts imports FilterTypes for FilterState;
 * FilterTypes must therefore never import types back).
 */
export interface FilterContext {
    startHour?: number;
    taskLookup?: (id: string) => Task | undefined;
}
