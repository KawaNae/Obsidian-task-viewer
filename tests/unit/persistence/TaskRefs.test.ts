import { describe, it, expect } from 'vitest';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import { nameOf } from '../../../src/services/core/RowNames';
import { makeTask } from '../helpers/makeTask';

describe('plannedOn', () => {
    it('writes in the reading the copy was made in (Task.reading), not one read off its name', () => {
        const task = { ...makeTask({ id: nameOf('tv-inline', 'a.md', 0, 'k1.2'), file: 'a.md', line: 0 }), reading: 'k1.3' };
        expect(plannedOn(task).in).toEqual({ reading: 'k1.3' });
    });

    // A copy no reading of the index made is not planned from: `plannedOn`
    // does not take one (`FileLines.typecheck.ts`), and the index refuses
    // it as `gone` before anything is written (`Names.vault.test.ts`).
});
