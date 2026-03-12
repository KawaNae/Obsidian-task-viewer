import { describe, it, expect } from 'vitest';
import { TaskFilterEngine } from '../../src/services/filter/TaskFilterEngine';
import type { Task, DisplayTask } from '../../src/types';
import type { FilterState, FilterConditionNode, FilterGroupNode } from '../../src/services/filter/FilterTypes';

// ── Helper: minimal Task factory ──

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'test-1',
        file: 'notes/daily.md',
        line: 1,
        content: 'Test task',
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        childLineBodyOffsets: [],
        originalText: '- [ ] Test task',
        tags: [],
        parserId: 'at-notation',
        ...overrides,
    };
}

function makeDisplayTask(overrides: Partial<DisplayTask> = {}): DisplayTask {
    const base = makeTask(overrides) as DisplayTask;
    return {
        ...base,
        effectiveStartDate: overrides.effectiveStartDate ?? overrides.startDate ?? '',
        effectiveStartTime: overrides.effectiveStartTime,
        effectiveEndDate: overrides.effectiveEndDate,
        effectiveEndTime: overrides.effectiveEndTime,
        startDateImplicit: overrides.startDateImplicit ?? false,
        startTimeImplicit: overrides.startTimeImplicit ?? false,
        endDateImplicit: overrides.endDateImplicit ?? false,
        endTimeImplicit: overrides.endTimeImplicit ?? false,
        originalTaskId: overrides.originalTaskId ?? overrides.id ?? 'test-1',
        isSplit: overrides.isSplit ?? false,
        ...overrides,
    };
}

// ── Helper: build FilterState from conditions ──

function cond(property: FilterConditionNode['property'], operator: FilterConditionNode['operator'], value: FilterConditionNode['value'], target?: 'self' | 'parent'): FilterConditionNode {
    const node: FilterConditionNode = { type: 'condition', id: 'c-1', property, operator, value };
    if (target === 'parent') node.target = 'parent';
    return node;
}

function stateFromConditions(conditions: FilterConditionNode[], logic: 'and' | 'or' = 'and'): FilterState {
    return {
        root: { type: 'group', id: 'root', children: conditions, logic },
    };
}

function stateFromCondition(c: FilterConditionNode): FilterState {
    return stateFromConditions([c]);
}

// ── Tests ──

describe('TaskFilterEngine', () => {

    // ── StringSet: file ──
    describe('file filter', () => {
        const task = makeTask({ file: 'notes/daily.md' });

        it('includes — matches', () => {
            const state = stateFromCondition(cond('file', 'includes', { type: 'stringSet', values: ['notes/daily.md'] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('includes — no match', () => {
            const state = stateFromCondition(cond('file', 'includes', { type: 'stringSet', values: ['other.md'] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });

        it('excludes — matches (filtered out)', () => {
            const state = stateFromCondition(cond('file', 'excludes', { type: 'stringSet', values: ['notes/daily.md'] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });

        it('excludes — no match (passes)', () => {
            const state = stateFromCondition(cond('file', 'excludes', { type: 'stringSet', values: ['other.md'] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('empty values — skipped (returns true)', () => {
            const state = stateFromCondition(cond('file', 'includes', { type: 'stringSet', values: [] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });
    });

    // ── StringSet: status ──
    describe('status filter', () => {
        it('includes matching status', () => {
            const task = makeTask({ statusChar: 'x' });
            const state = stateFromCondition(cond('status', 'includes', { type: 'stringSet', values: ['x', '/'] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('excludes matching status', () => {
            const task = makeTask({ statusChar: 'x' });
            const state = stateFromCondition(cond('status', 'excludes', { type: 'stringSet', values: ['x'] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });
    });

    // ── StringSet: color ──
    describe('color filter', () => {
        it('includes matching color', () => {
            const task = makeTask({ color: 'red' });
            const state = stateFromCondition(cond('color', 'includes', { type: 'stringSet', values: ['red', 'blue'] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('no color set — empty string for matching', () => {
            const task = makeTask();
            const state = stateFromCondition(cond('color', 'includes', { type: 'stringSet', values: [''] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });
    });

    // ── StringSet: linestyle ──
    describe('linestyle filter', () => {
        it('includes matching linestyle', () => {
            const task = makeTask({ linestyle: 'dashed' });
            const state = stateFromCondition(cond('linestyle', 'includes', { type: 'stringSet', values: ['dashed'] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });
    });

    // ── StringSet: taskType ──
    describe('taskType filter', () => {
        it('includes at-notation', () => {
            const task = makeTask({ parserId: 'at-notation' });
            const state = stateFromCondition(cond('taskType', 'includes', { type: 'stringSet', values: ['at-notation'] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('excludes frontmatter', () => {
            const task = makeTask({ parserId: 'at-notation' });
            const state = stateFromCondition(cond('taskType', 'excludes', { type: 'stringSet', values: ['frontmatter'] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });
    });

    // ── Tag (array matching) ──
    describe('tag filter', () => {
        const task = makeTask({ tags: ['work', 'urgent'] });

        it('includes — one tag matches', () => {
            const state = stateFromCondition(cond('tag', 'includes', { type: 'stringSet', values: ['urgent'] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('includes — no tag matches', () => {
            const state = stateFromCondition(cond('tag', 'includes', { type: 'stringSet', values: ['personal'] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });

        it('excludes — matching tag excluded', () => {
            const state = stateFromCondition(cond('tag', 'excludes', { type: 'stringSet', values: ['work'] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });

        it('excludes — no matching tag', () => {
            const state = stateFromCondition(cond('tag', 'excludes', { type: 'stringSet', values: ['personal'] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('includes — multiple filter values, one matches', () => {
            const state = stateFromCondition(cond('tag', 'includes', { type: 'stringSet', values: ['personal', 'urgent'] }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });
    });

    // ── Content (case-insensitive substring) ──
    describe('content filter', () => {
        const task = makeTask({ content: 'Fix Login Bug' });

        it('contains — case-insensitive match', () => {
            const state = stateFromCondition(cond('content', 'contains', { type: 'string', value: 'login' }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('contains — no match', () => {
            const state = stateFromCondition(cond('content', 'contains', { type: 'string', value: 'signup' }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });

        it('notContains — no match passes', () => {
            const state = stateFromCondition(cond('content', 'notContains', { type: 'string', value: 'signup' }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('notContains — match filtered', () => {
            const state = stateFromCondition(cond('content', 'notContains', { type: 'string', value: 'login' }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });
    });

    // ── Date (startDate, endDate, due) ──
    describe('date filters', () => {
        const task = makeTask({ startDate: '2026-03-10' });

        it('isSet — date exists', () => {
            const state = stateFromCondition(cond('startDate', 'isSet', { type: 'boolean', value: true }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('isSet — date missing', () => {
            const noDate = makeTask();
            const state = stateFromCondition(cond('startDate', 'isSet', { type: 'boolean', value: true }));
            expect(TaskFilterEngine.evaluate(noDate, state)).toBe(false);
        });

        it('isNotSet — date missing', () => {
            const noDate = makeTask();
            const state = stateFromCondition(cond('startDate', 'isNotSet', { type: 'boolean', value: true }));
            expect(TaskFilterEngine.evaluate(noDate, state)).toBe(true);
        });

        it('equals — absolute date match', () => {
            const state = stateFromCondition(cond('startDate', 'equals', { type: 'date', value: { mode: 'absolute', date: '2026-03-10' } }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('equals — absolute date mismatch', () => {
            const state = stateFromCondition(cond('startDate', 'equals', { type: 'date', value: { mode: 'absolute', date: '2026-03-11' } }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });

        it('before — task date before filter date', () => {
            const state = stateFromCondition(cond('startDate', 'before', { type: 'date', value: { mode: 'absolute', date: '2026-03-11' } }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('before — task date not before', () => {
            const state = stateFromCondition(cond('startDate', 'before', { type: 'date', value: { mode: 'absolute', date: '2026-03-10' } }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });

        it('after — task date after filter date', () => {
            const state = stateFromCondition(cond('startDate', 'after', { type: 'date', value: { mode: 'absolute', date: '2026-03-09' } }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('after — task date not after', () => {
            const state = stateFromCondition(cond('startDate', 'after', { type: 'date', value: { mode: 'absolute', date: '2026-03-10' } }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });

        it('onOrBefore — equal date', () => {
            const state = stateFromCondition(cond('startDate', 'onOrBefore', { type: 'date', value: { mode: 'absolute', date: '2026-03-10' } }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('onOrAfter — equal date', () => {
            const state = stateFromCondition(cond('startDate', 'onOrAfter', { type: 'date', value: { mode: 'absolute', date: '2026-03-10' } }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('date filter on missing date — returns false', () => {
            const noDate = makeTask();
            const state = stateFromCondition(cond('startDate', 'equals', { type: 'date', value: { mode: 'absolute', date: '2026-03-10' } }));
            expect(TaskFilterEngine.evaluate(noDate, state)).toBe(false);
        });
    });

    describe('endDate filter', () => {
        it('uses raw endDate for Task', () => {
            const task = makeTask({ endDate: '2026-04-01' });
            const state = stateFromCondition(cond('endDate', 'equals', { type: 'date', value: { mode: 'absolute', date: '2026-04-01' } }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });
    });

    describe('due filter', () => {
        it('strips time portion from due', () => {
            const task = makeTask({ due: '2026-05-15T10:00' });
            const state = stateFromCondition(cond('due', 'equals', { type: 'date', value: { mode: 'absolute', date: '2026-05-15' } }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('due isSet', () => {
            const task = makeTask({ due: '2026-05-15' });
            const state = stateFromCondition(cond('due', 'isSet', { type: 'boolean', value: true }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('due isNotSet when missing', () => {
            const task = makeTask();
            const state = stateFromCondition(cond('due', 'isNotSet', { type: 'boolean', value: true }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });
    });

    // ── Length filter ──
    describe('length filter', () => {
        // Task with 2-hour duration: 09:00 - 11:00 same day
        const task = makeTask({
            startDate: '2026-03-10',
            startTime: '09:00',
            endDate: '2026-03-10',
            endTime: '11:00',
        });

        it('isSet — has start date', () => {
            const state = stateFromCondition(cond('length', 'isSet', { type: 'boolean', value: true }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('isNotSet — no start date', () => {
            const noDate = makeTask();
            const state = stateFromCondition(cond('length', 'isNotSet', { type: 'boolean', value: true }));
            expect(TaskFilterEngine.evaluate(noDate, state)).toBe(true);
        });

        it('lessThan 3 hours — 2h task passes', () => {
            const state = stateFromCondition(cond('length', 'lessThan', { type: 'number', value: 3, unit: 'hours' }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('greaterThan 1 hour — 2h task passes', () => {
            const state = stateFromCondition(cond('length', 'greaterThan', { type: 'number', value: 1, unit: 'hours' }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('equals 2 hours', () => {
            const state = stateFromCondition(cond('length', 'equals', { type: 'number', value: 2, unit: 'hours' }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('lessThanOrEqual 2 hours', () => {
            const state = stateFromCondition(cond('length', 'lessThanOrEqual', { type: 'number', value: 2, unit: 'hours' }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('greaterThanOrEqual 2 hours', () => {
            const state = stateFromCondition(cond('length', 'greaterThanOrEqual', { type: 'number', value: 2, unit: 'hours' }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('unit: minutes — 120 minutes', () => {
            const state = stateFromCondition(cond('length', 'equals', { type: 'number', value: 120, unit: 'minutes' }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('greaterThan 3 hours — 2h task fails', () => {
            const state = stateFromCondition(cond('length', 'greaterThan', { type: 'number', value: 3, unit: 'hours' }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });
    });

    // ── Group logic ──
    describe('group logic', () => {
        const task = makeTask({ tags: ['work'], file: 'notes/daily.md' });

        it('AND — both pass', () => {
            const state = stateFromConditions([
                cond('tag', 'includes', { type: 'stringSet', values: ['work'] }),
                cond('file', 'includes', { type: 'stringSet', values: ['notes/daily.md'] }),
            ], 'and');
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('AND — one fails', () => {
            const state = stateFromConditions([
                cond('tag', 'includes', { type: 'stringSet', values: ['work'] }),
                cond('file', 'includes', { type: 'stringSet', values: ['other.md'] }),
            ], 'and');
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });

        it('OR — one passes', () => {
            const state = stateFromConditions([
                cond('tag', 'includes', { type: 'stringSet', values: ['personal'] }),
                cond('file', 'includes', { type: 'stringSet', values: ['notes/daily.md'] }),
            ], 'or');
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('OR — all fail', () => {
            const state = stateFromConditions([
                cond('tag', 'includes', { type: 'stringSet', values: ['personal'] }),
                cond('file', 'includes', { type: 'stringSet', values: ['other.md'] }),
            ], 'or');
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });

        it('empty group — returns true', () => {
            const state: FilterState = { root: { type: 'group', id: 'root', children: [], logic: 'and' } };
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });
    });

    // ── Nested groups ──
    describe('nested groups', () => {
        it('nested AND inside OR', () => {
            const task = makeTask({ tags: ['work'], statusChar: 'x' });
            const innerGroup: FilterGroupNode = {
                type: 'group', id: 'g-inner', logic: 'and',
                children: [
                    cond('tag', 'includes', { type: 'stringSet', values: ['work'] }),
                    cond('status', 'includes', { type: 'stringSet', values: ['x'] }),
                ],
            };
            const state: FilterState = {
                root: {
                    type: 'group', id: 'root', logic: 'or',
                    children: [
                        cond('file', 'includes', { type: 'stringSet', values: ['nonexistent.md'] }),
                        innerGroup,
                    ],
                },
            };
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('nested group fails — outer OR still needs one pass', () => {
            const task = makeTask({ tags: ['work'], statusChar: ' ' });
            const innerGroup: FilterGroupNode = {
                type: 'group', id: 'g-inner', logic: 'and',
                children: [
                    cond('tag', 'includes', { type: 'stringSet', values: ['work'] }),
                    cond('status', 'includes', { type: 'stringSet', values: ['x'] }), // fails
                ],
            };
            const state: FilterState = {
                root: {
                    type: 'group', id: 'root', logic: 'or',
                    children: [
                        cond('file', 'includes', { type: 'stringSet', values: ['nonexistent.md'] }), // fails
                        innerGroup, // fails (status mismatch)
                    ],
                },
            };
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });
    });

    // ── DisplayTask vs raw Task ──
    describe('DisplayTask effective fields', () => {
        it('uses effectiveStartDate from DisplayTask', () => {
            const dt = makeDisplayTask({
                startDate: undefined,
                effectiveStartDate: '2026-03-10',
                startDateImplicit: true,
            });
            const state = stateFromCondition(cond('startDate', 'equals', { type: 'date', value: { mode: 'absolute', date: '2026-03-10' } }));
            expect(TaskFilterEngine.evaluate(dt, state)).toBe(true);
        });

        it('uses effectiveEndDate from DisplayTask', () => {
            const dt = makeDisplayTask({
                endDate: undefined,
                effectiveEndDate: '2026-04-01',
                endDateImplicit: true,
            });
            const state = stateFromCondition(cond('endDate', 'equals', { type: 'date', value: { mode: 'absolute', date: '2026-04-01' } }));
            expect(TaskFilterEngine.evaluate(dt, state)).toBe(true);
        });

        it('falls back to raw startDate for plain Task', () => {
            const task = makeTask({ startDate: '2026-03-10' });
            const state = stateFromCondition(cond('startDate', 'equals', { type: 'date', value: { mode: 'absolute', date: '2026-03-10' } }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });
    });

    // ── parent / children property (isSet / isNotSet) ──
    describe('parent property', () => {
        it('isSet — task has parentId', () => {
            const task = makeTask({ parentId: 'parent-1' });
            const state = stateFromCondition(cond('parent', 'isSet', { type: 'boolean', value: true }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('isSet — task has no parentId', () => {
            const task = makeTask();
            const state = stateFromCondition(cond('parent', 'isSet', { type: 'boolean', value: true }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });

        it('isNotSet — task has no parentId', () => {
            const task = makeTask();
            const state = stateFromCondition(cond('parent', 'isNotSet', { type: 'boolean', value: true }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('isNotSet — task has parentId', () => {
            const task = makeTask({ parentId: 'parent-1' });
            const state = stateFromCondition(cond('parent', 'isNotSet', { type: 'boolean', value: true }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });
    });

    describe('children property', () => {
        it('isSet — task has children', () => {
            const task = makeTask({ childIds: ['c-1', 'c-2'] });
            const state = stateFromCondition(cond('children', 'isSet', { type: 'boolean', value: true }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('isSet — task has no children', () => {
            const task = makeTask({ childIds: [] });
            const state = stateFromCondition(cond('children', 'isSet', { type: 'boolean', value: true }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });

        it('isNotSet — task has no children', () => {
            const task = makeTask({ childIds: [] });
            const state = stateFromCondition(cond('children', 'isNotSet', { type: 'boolean', value: true }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(true);
        });

        it('isNotSet — task has children', () => {
            const task = makeTask({ childIds: ['c-1'] });
            const state = stateFromCondition(cond('children', 'isNotSet', { type: 'boolean', value: true }));
            expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
        });
    });

    // ── target: 'parent' (ancestor traversal) ──
    describe('target: parent', () => {
        // Hierarchy: grandparent → parent → child → grandchild
        const grandparent = makeTask({ id: 'gp', tags: ['projectA'], file: 'project.md', childIds: ['p'] });
        const parent = makeTask({ id: 'p', parentId: 'gp', tags: ['sub'], file: 'project.md', childIds: ['c'] });
        const child = makeTask({ id: 'c', parentId: 'p', tags: [], file: 'project.md', childIds: ['gc'] });
        const grandchild = makeTask({ id: 'gc', parentId: 'c', tags: [], file: 'project.md' });
        const orphan = makeTask({ id: 'orphan', tags: [] });

        const taskMap = new Map<string, Task>([
            ['gp', grandparent], ['p', parent], ['c', child], ['gc', grandchild], ['orphan', orphan],
        ]);
        const context = { taskLookup: (id: string) => taskMap.get(id) };

        describe('tag includes (ancestor traversal)', () => {
            it('direct parent matches — child passes', () => {
                const state = stateFromCondition(cond('tag', 'includes', { type: 'stringSet', values: ['sub'] }, 'parent'));
                expect(TaskFilterEngine.evaluate(child, state, context)).toBe(true);
            });

            it('grandparent matches — grandchild passes (traverses 2 levels)', () => {
                const state = stateFromCondition(cond('tag', 'includes', { type: 'stringSet', values: ['projectA'] }, 'parent'));
                expect(TaskFilterEngine.evaluate(grandchild, state, context)).toBe(true);
            });

            it('grandparent matches — child also passes (traverses 1 level up to grandparent)', () => {
                const state = stateFromCondition(cond('tag', 'includes', { type: 'stringSet', values: ['projectA'] }, 'parent'));
                expect(TaskFilterEngine.evaluate(child, state, context)).toBe(true);
            });

            it('no ancestor matches — returns false', () => {
                const state = stateFromCondition(cond('tag', 'includes', { type: 'stringSet', values: ['nonexistent'] }, 'parent'));
                expect(TaskFilterEngine.evaluate(grandchild, state, context)).toBe(false);
            });

            it('task has no parent — returns false', () => {
                const state = stateFromCondition(cond('tag', 'includes', { type: 'stringSet', values: ['projectA'] }, 'parent'));
                expect(TaskFilterEngine.evaluate(orphan, state, context)).toBe(false);
            });

            it('root task (grandparent) has no parent — returns false', () => {
                const state = stateFromCondition(cond('tag', 'includes', { type: 'stringSet', values: ['projectA'] }, 'parent'));
                expect(TaskFilterEngine.evaluate(grandparent, state, context)).toBe(false);
            });
        });

        describe('tag excludes (ancestor traversal)', () => {
            it('no ancestor has excluded tag — passes', () => {
                const state = stateFromCondition(cond('tag', 'excludes', { type: 'stringSet', values: ['blocked'] }, 'parent'));
                expect(TaskFilterEngine.evaluate(child, state, context)).toBe(true);
            });

            it('direct parent has excluded tag — first ancestor matches excludes (returns true for that ancestor)', () => {
                // excludes evaluates per-ancestor: parent has 'sub', excludes 'sub' → false for parent
                // but grandparent does NOT have 'sub', excludes 'sub' → true for grandparent
                // ancestor traversal returns true if ANY ancestor satisfies the condition
                const state = stateFromCondition(cond('tag', 'excludes', { type: 'stringSet', values: ['sub'] }, 'parent'));
                expect(TaskFilterEngine.evaluate(child, state, context)).toBe(true);
            });
        });

        describe('file includes (ancestor traversal)', () => {
            it('parent file matches — passes', () => {
                const state = stateFromCondition(cond('file', 'includes', { type: 'stringSet', values: ['project.md'] }, 'parent'));
                expect(TaskFilterEngine.evaluate(child, state, context)).toBe(true);
            });

            it('no ancestor file matches — fails', () => {
                const state = stateFromCondition(cond('file', 'includes', { type: 'stringSet', values: ['other.md'] }, 'parent'));
                expect(TaskFilterEngine.evaluate(child, state, context)).toBe(false);
            });
        });

        describe('status includes (ancestor traversal)', () => {
            it('parent status matches', () => {
                const parentDone = makeTask({ id: 'pd', parentId: 'gp', statusChar: 'x', childIds: ['cd'] });
                const childOfDone = makeTask({ id: 'cd', parentId: 'pd' });
                const map = new Map<string, Task>([['gp', grandparent], ['pd', parentDone], ['cd', childOfDone]]);
                const ctx = { taskLookup: (id: string) => map.get(id) };

                const state = stateFromCondition(cond('status', 'includes', { type: 'stringSet', values: ['x'] }, 'parent'));
                expect(TaskFilterEngine.evaluate(childOfDone, state, ctx)).toBe(true);
            });
        });

        describe('content contains (ancestor traversal)', () => {
            it('ancestor content matches', () => {
                const parentWithContent = makeTask({ id: 'pwc', content: 'Important Project', childIds: ['cwc'] });
                const childTask = makeTask({ id: 'cwc', parentId: 'pwc', content: 'subtask' });
                const map = new Map<string, Task>([['pwc', parentWithContent], ['cwc', childTask]]);
                const ctx = { taskLookup: (id: string) => map.get(id) };

                const state = stateFromCondition(cond('content', 'contains', { type: 'string', value: 'important' }, 'parent'));
                expect(TaskFilterEngine.evaluate(childTask, state, ctx)).toBe(true);
            });
        });

        describe('date filters (ancestor traversal)', () => {
            it('ancestor startDate matches', () => {
                const parentWithDate = makeTask({ id: 'pwd', startDate: '2026-03-10', childIds: ['cwd'] });
                const childTask = makeTask({ id: 'cwd', parentId: 'pwd' });
                const map = new Map<string, Task>([['pwd', parentWithDate], ['cwd', childTask]]);
                const ctx = { taskLookup: (id: string) => map.get(id) };

                const state = stateFromCondition(cond('startDate', 'equals', { type: 'date', value: { mode: 'absolute', date: '2026-03-10' } }, 'parent'));
                expect(TaskFilterEngine.evaluate(childTask, state, ctx)).toBe(true);
            });

            it('ancestor startDate isSet', () => {
                const parentWithDate = makeTask({ id: 'pwd2', startDate: '2026-03-10', childIds: ['cwd2'] });
                const childTask = makeTask({ id: 'cwd2', parentId: 'pwd2' });
                const map = new Map<string, Task>([['pwd2', parentWithDate], ['cwd2', childTask]]);
                const ctx = { taskLookup: (id: string) => map.get(id) };

                const state = stateFromCondition(cond('startDate', 'isSet', { type: 'boolean', value: true }, 'parent'));
                expect(TaskFilterEngine.evaluate(childTask, state, ctx)).toBe(true);
            });
        });

        describe('no context / no taskLookup', () => {
            it('no context — returns false', () => {
                const task = makeTask({ parentId: 'p' });
                const state = stateFromCondition(cond('tag', 'includes', { type: 'stringSet', values: ['work'] }, 'parent'));
                expect(TaskFilterEngine.evaluate(task, state)).toBe(false);
            });

            it('taskLookup returns undefined — returns false', () => {
                const task = makeTask({ parentId: 'missing' });
                const ctx = { taskLookup: () => undefined };
                const state = stateFromCondition(cond('tag', 'includes', { type: 'stringSet', values: ['work'] }, 'parent'));
                expect(TaskFilterEngine.evaluate(task, state, ctx)).toBe(false);
            });
        });

        describe('combined with self conditions (AND/OR)', () => {
            it('AND: self tag + parent tag — both must pass', () => {
                const state = stateFromConditions([
                    cond('tag', 'includes', { type: 'stringSet', values: ['sub'] }),           // self: child has no 'sub' tag
                    cond('tag', 'includes', { type: 'stringSet', values: ['projectA'] }, 'parent'), // parent: grandparent has 'projectA'
                ], 'and');
                // child has no tags, so self condition fails
                expect(TaskFilterEngine.evaluate(child, state, context)).toBe(false);
            });

            it('AND: self parent-isSet + parent tag — child has parent + ancestor has tag', () => {
                const state = stateFromConditions([
                    cond('parent', 'isSet', { type: 'boolean', value: true }),                      // self: child has parentId
                    cond('tag', 'includes', { type: 'stringSet', values: ['projectA'] }, 'parent'), // ancestor has 'projectA'
                ], 'and');
                expect(TaskFilterEngine.evaluate(child, state, context)).toBe(true);
            });

            it('OR: self tag fails + parent tag passes', () => {
                const state = stateFromConditions([
                    cond('tag', 'includes', { type: 'stringSet', values: ['nonexistent'] }),        // self: fails
                    cond('tag', 'includes', { type: 'stringSet', values: ['projectA'] }, 'parent'), // ancestor: passes
                ], 'or');
                expect(TaskFilterEngine.evaluate(child, state, context)).toBe(true);
            });

            it('OR: both fail', () => {
                const state = stateFromConditions([
                    cond('tag', 'includes', { type: 'stringSet', values: ['nonexistent'] }),
                    cond('tag', 'includes', { type: 'stringSet', values: ['nonexistent'] }, 'parent'),
                ], 'or');
                expect(TaskFilterEngine.evaluate(child, state, context)).toBe(false);
            });
        });

        describe('circular reference protection', () => {
            it('does not infinite loop on circular parentId', () => {
                const a = makeTask({ id: 'a', parentId: 'b', tags: [] });
                const b = makeTask({ id: 'b', parentId: 'a', tags: [] });
                const map = new Map<string, Task>([['a', a], ['b', b]]);
                const ctx = { taskLookup: (id: string) => map.get(id) };

                const state = stateFromCondition(cond('tag', 'includes', { type: 'stringSet', values: ['x'] }, 'parent'));
                // Should terminate without infinite loop, returning false (no ancestor has tag 'x')
                expect(TaskFilterEngine.evaluate(a, state, ctx)).toBe(false);
            });
        });

        describe('self target (default behavior)', () => {
            it('target=self behaves same as no target', () => {
                const task = makeTask({ tags: ['work'] });
                const condSelf = cond('tag', 'includes', { type: 'stringSet', values: ['work'] }, 'self');
                const condNoTarget = cond('tag', 'includes', { type: 'stringSet', values: ['work'] });
                expect(TaskFilterEngine.evaluate(task, stateFromCondition(condSelf))).toBe(true);
                expect(TaskFilterEngine.evaluate(task, stateFromCondition(condNoTarget))).toBe(true);
            });

            it('target=self does not traverse ancestors', () => {
                const state = stateFromCondition(cond('tag', 'includes', { type: 'stringSet', values: ['projectA'] }, 'self'));
                // child has no tags — self evaluation only, not ancestor
                expect(TaskFilterEngine.evaluate(child, state, context)).toBe(false);
            });
        });
    });
});
