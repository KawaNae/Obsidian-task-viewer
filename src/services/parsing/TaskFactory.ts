import type { ParserId, Task } from '../../types';

/**
 * A line read as a task, before it has a name: every field of a Task but
 * `id`. What a line parser answers; the name is the reader's to give
 * (`NoteTasks` applies the namer its caller hands it).
 */
export type UnnamedTask = Omit<Task, 'id'>;

/**
 * Location + content fields every Task must state explicitly.
 *
 * `originalText` is deliberately required (no default): its meaning differs
 * per producer — the verbatim source line for parsed tasks (round-trip /
 * line-resolution substrate) vs. `''` for synthetic temp tasks that have
 * no body line to round-trip.
 */
export interface BaseTaskCore {
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
 * ReadOnlyParserBase) and synthetic tasks (createTempTask) alike, without
 * a name: the one who reads the task names it. Adding a field to Task means adding its default in exactly one
 * place; producer-specific fields (flow, validation, color, isReadOnly, …)
 * are supplied via `overrides` and have no factory default on purpose.
 */
export function createBaseTask(core: BaseTaskCore, overrides: Partial<UnnamedTask> = {}): UnnamedTask {
    return {
        ...core,
        indent: 0,
        childIds: [],
        childLines: [],
        tags: [],
        properties: {},
        ...overrides,
    };
}
