import { describe, it, expect } from 'vitest';
import { lineMenuOf } from '../../../src/editor/LineMenu';
import type { ParserId, Task } from '../../../src/types';

const task = (parserId: ParserId) => ({ parserId }) as Task;
const both = { editorMenuForTasks: true, editorMenuForCheckboxes: true };

describe('lineMenuOf: the button at a checkbox line\'s end', () => {
    it.each([
        ['a tv-inline task', task('tv-inline'), 'task'],
        ['a Tasks task', task('tasks-plugin'), 'none'],
        ['a Day Planner task', task('day-planner'), 'none'],
        ['a line the index holds no task on (out of the read range)', undefined, 'checkbox'],
        ['a line of a content the index has not read', null, 'checkbox'],
    ] as const)('%s, both settings on: %s', (_name, found, menu) => {
        expect(lineMenuOf(found, both)).toBe(menu);
    });

    it('a setting off takes its own lines\' button away, and no other', () => {
        expect(lineMenuOf(task('tv-inline'), { ...both, editorMenuForTasks: false })).toBe('none');
        expect(lineMenuOf(undefined, { ...both, editorMenuForTasks: false })).toBe('checkbox');
        expect(lineMenuOf(undefined, { ...both, editorMenuForCheckboxes: false })).toBe('none');
        expect(lineMenuOf(task('tv-inline'), { ...both, editorMenuForCheckboxes: false })).toBe('task');
    });
});
