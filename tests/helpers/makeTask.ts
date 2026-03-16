import type { Task } from '../../src/types';

/**
 * Create a Task with sensible defaults for unit tests.
 * Override any field via the `overrides` parameter.
 */
export function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'at-notation:note.md:ln:1',
        file: 'note.md',
        line: 0,
        content: 'Test task',
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        childLineBodyOffsets: [],
        originalText: '- [ ] Test task @2026-03-11',
        tags: [],
        parserId: 'at-notation',
        parentId: undefined,
        startDate: undefined,
        startTime: undefined,
        endDate: undefined,
        endTime: undefined,
        due: undefined,
        commands: [],
        properties: {},
        ...overrides,
    };
}
