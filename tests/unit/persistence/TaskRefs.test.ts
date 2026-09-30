import { describe, it, expect } from 'vitest';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import { nameOf } from '../../../src/services/core/RowNames';
import { makeTask } from '../helpers/makeTask';

describe('plannedOn', () => {
    it('writes in the reading the copy was made in (Task.reading), not one read off its name', () => {
        const task = makeTask({ id: nameOf('tv-inline', 'a.md', 0, 'k1.2'), reading: 'k1.3', file: 'a.md', line: 0 });
        expect(plannedOn(task).read).toBe('k1.3');
    });

    it('has no reading for a copy no reading of the index made', () => {
        const task = makeTask({ id: nameOf('tv-inline', 'a.md', 0, 'k1.2'), file: 'a.md', line: 0 });
        expect(plannedOn(task).read).toBeUndefined();
    });
});
