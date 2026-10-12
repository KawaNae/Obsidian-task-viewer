import { describe, it, expect } from 'vitest';
import { TaskUpdateBuilder } from '../../../src/modals/form/TaskUpdateBuilder';
import { PropertyUpdatePlanner } from '../../../src/services/persistence/PropertyUpdatePlanner';
import { DEFAULT_SCOPE_KEYS } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

/**
 * The hub's style fields as updates, and the ops the planner makes of them:
 * a value typed is set, the field emptied takes the row's own line out, and
 * the row's own no value hides the value it inherits.
 */
describe('TaskUpdateBuilder, the style fields', () => {
    const plan = (before: ReturnType<typeof makeTask>, updates: ReturnType<typeof TaskUpdateBuilder.styleField>) =>
        PropertyUpdatePlanner.plan(before, updates ?? {}, DEFAULT_SCOPE_KEYS);

    it('hides the inherited value with the row\'s own no value, once', () => {
        const row = makeTask({ color: undefined });
        expect(TaskUpdateBuilder.styleHidden(row, 'color')).toEqual({ color: null });
        expect(plan(row, TaskUpdateBuilder.styleHidden(row, 'color'))).toEqual([{ key: 'tv-color', op: 'hide' }]);
        expect(TaskUpdateBuilder.styleHidden(makeTask({ color: null }), 'color')).toBeNull();
    });

    it('takes the row\'s own no value out when the field is emptied', () => {
        const row = makeTask({ mask: null });
        expect(TaskUpdateBuilder.styleField(row, 'mask', '')).toEqual({ mask: undefined });
        expect(plan(row, TaskUpdateBuilder.styleField(row, 'mask', ''))).toEqual([{ key: 'tv-mask', op: 'delete' }]);
    });
});
