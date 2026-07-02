import type { ParserId, Task } from '../../types';

/**
 * Identity + content fields every Task must state explicitly.
 *
 * `originalText` is deliberately required (no default): its meaning differs
 * per producer — the verbatim source line for parsed tasks (round-trip /
 * line-resolution substrate) vs. `''` for synthetic tasks (tv-file,
 * temp tasks) that have no body line to round-trip.
 */
export interface BaseTaskCore {
    id: string;
    file: string;
    line: number;
    content: string;
    statusChar: string;
    parserId: ParserId;
    originalText: string;
}

/**
 * The single source of Task substrate defaults.
 *
 * Every Task in the system is born here — parser outputs (TVInlineParser,
 * ReadOnlyParserBase, TVFileBuilder) and synthetic tasks (createTempTask)
 * alike. Adding a field to Task means adding its default in exactly one
 * place; producer-specific fields (flow, validation, color, isReadOnly, …)
 * are supplied via `overrides` and have no factory default on purpose.
 */
export function createBaseTask(core: BaseTaskCore, overrides: Partial<Task> = {}): Task {
    return {
        ...core,
        indent: 0,
        childIds: [],
        childLines: [],
        childLineBodyOffsets: [],
        tags: [],
        properties: {},
        ...overrides,
    };
}
