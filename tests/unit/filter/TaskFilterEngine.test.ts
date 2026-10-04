import { describe, it, expect } from 'vitest';
import { evaluateFilter } from '../helpers/filterContext';
import type { Task, DisplayTask } from '../../../src/types';
import type { FilterState, FilterCondition, FilterGroup } from '../../../src/services/filter/FilterTypes';
import { createDefaultListFilterState } from '../../../src/services/filter/FilterTypes';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../src/services/display/DisplayTaskConverter';

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
        originalText: '- [ ] Test task',
        tags: [],
        parserId: 'tv-inline',
        ...overrides,
    };
}

/** A display copy of a task with the given line values (startHour 0, as testContext). */
function makeDisplayTask(overrides: Partial<DisplayTask> = {}): DisplayTask {
    return { ...toDisplayTask(makeTask(overrides), 0, NO_TASK_LOOKUP), ...overrides };
}

// ── Helper: build FilterState from conditions ──

function cond(
    property: FilterCondition['property'],
    operator: FilterCondition['operator'],
    value?: FilterCondition['value'],
    target?: 'self' | 'parent',
): FilterCondition {
    const node: FilterCondition = { property, operator };
    if (value !== undefined) node.value = value;
    if (target === 'parent') node.target = 'parent';
    return node;
}

function stateFromConditions(conditions: FilterCondition[], logic: 'and' | 'or' = 'and'): FilterState {
    return { filters: conditions, logic };
}

function stateFromCondition(c: FilterCondition): FilterState {
    return stateFromConditions([c]);
}

// ── Tests ──

describe('TaskFilterEngine', () => {

    // ── StringSet: file ──
    describe('file filter', () => {
        const task = makeTask({ file: 'notes/daily.md' });

        it('includes — matches', () => {
            const state = stateFromCondition(cond('file', 'includes', ['notes/daily.md']));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('includes — no match', () => {
            const state = stateFromCondition(cond('file', 'includes', ['other.md']));
            expect(evaluateFilter(task, state)).toBe(false);
        });

        it('excludes — matches (filtered out)', () => {
            const state = stateFromCondition(cond('file', 'excludes', ['notes/daily.md']));
            expect(evaluateFilter(task, state)).toBe(false);
        });

        it('excludes — no match (passes)', () => {
            const state = stateFromCondition(cond('file', 'excludes', ['other.md']));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('empty values — skipped (returns true)', () => {
            const state = stateFromCondition(cond('file', 'includes', []));
            expect(evaluateFilter(task, state)).toBe(true);
        });
    });

    // ── StringSet: status ──
    describe('status filter', () => {
        it('includes matching status', () => {
            const task = makeTask({ statusChar: 'x' });
            const state = stateFromCondition(cond('status', 'includes', ['x', '/']));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('excludes matching status', () => {
            const task = makeTask({ statusChar: 'x' });
            const state = stateFromCondition(cond('status', 'excludes', ['x']));
            expect(evaluateFilter(task, state)).toBe(false);
        });
    });

    // ── StringSet: color ──
    describe('color filter', () => {
        it('includes matching color', () => {
            const task = makeTask({ color: 'red' });
            const state = stateFromCondition(cond('color', 'includes', ['red', 'blue']));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('no color set — empty string for matching', () => {
            const task = makeTask();
            const state = stateFromCondition(cond('color', 'includes', ['']));
            expect(evaluateFilter(task, state)).toBe(true);
        });
    });

    // ── StringSet: linestyle ──
    describe('linestyle filter', () => {
        it('includes matching linestyle', () => {
            const task = makeTask({ linestyle: 'dashed' });
            const state = stateFromCondition(cond('linestyle', 'includes', ['dashed']));
            expect(evaluateFilter(task, state)).toBe(true);
        });
    });

    // ── StringSet: kind (derived from parserId) ──
    // ── StringSet: notation (derived from parserId) ──
    describe('notation filter', () => {
        it('taskviewer: tv-inline matches', () => {
            const task = makeTask({ parserId: 'tv-inline' });
            const state = stateFromCondition(cond('notation', 'includes', ['taskviewer']));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('tasks: tasks-plugin matches', () => {
            const task = makeTask({ parserId: 'tasks-plugin' });
            const state = stateFromCondition(cond('notation', 'includes', ['tasks']));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('dayplanner: day-planner matches', () => {
            const task = makeTask({ parserId: 'day-planner' });
            const state = stateFromCondition(cond('notation', 'includes', ['dayplanner']));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('excludes taskviewer: tv-inline is excluded', () => {
            const task = makeTask({ parserId: 'tv-inline' });
            const state = stateFromCondition(cond('notation', 'excludes', ['taskviewer']));
            expect(evaluateFilter(task, state)).toBe(false);
        });
    });

    // ── Tag (array matching) ──
    describe('tag filter', () => {
        const task = makeTask({ tags: ['work', 'urgent'] });

        it('includes — one tag matches', () => {
            const state = stateFromCondition(cond('tag', 'includes', ['urgent']));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('includes — no tag matches', () => {
            const state = stateFromCondition(cond('tag', 'includes', ['personal']));
            expect(evaluateFilter(task, state)).toBe(false);
        });

        it('excludes — matching tag excluded', () => {
            const state = stateFromCondition(cond('tag', 'excludes', ['work']));
            expect(evaluateFilter(task, state)).toBe(false);
        });

        it('excludes — no matching tag', () => {
            const state = stateFromCondition(cond('tag', 'excludes', ['personal']));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('includes — multiple filter values, one matches', () => {
            const state = stateFromCondition(cond('tag', 'includes', ['personal', 'urgent']));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('includes — parent tag matches child (hierarchical)', () => {
            const t = makeTask({ tags: ['project/sub'] });
            const state = stateFromCondition(cond('tag', 'includes', ['project']));
            expect(evaluateFilter(t, state)).toBe(true);
        });

        it('includes — child tag does not match parent', () => {
            const t = makeTask({ tags: ['project'] });
            const state = stateFromCondition(cond('tag', 'includes', ['project/sub']));
            expect(evaluateFilter(t, state)).toBe(false);
        });

        it('includes — deep nested tag matches ancestor', () => {
            const t = makeTask({ tags: ['area/work/meetings'] });
            const state = stateFromCondition(cond('tag', 'includes', ['area']));
            expect(evaluateFilter(t, state)).toBe(true);
        });

        it('excludes — parent tag excludes child', () => {
            const t = makeTask({ tags: ['project/sub'] });
            const state = stateFromCondition(cond('tag', 'excludes', ['project']));
            expect(evaluateFilter(t, state)).toBe(false);
        });

        it('includes — similar prefix but not hierarchy does not match', () => {
            const t = makeTask({ tags: ['projects'] });
            const state = stateFromCondition(cond('tag', 'includes', ['project']));
            expect(evaluateFilter(t, state)).toBe(false);
        });

        it('equals — exact match passes', () => {
            const t = makeTask({ tags: ['project'] });
            const state = stateFromCondition(cond('tag', 'equals', ['project']));
            expect(evaluateFilter(t, state)).toBe(true);
        });

        it('equals — hierarchical child does not match parent filter', () => {
            const t = makeTask({ tags: ['project/sub'] });
            const state = stateFromCondition(cond('tag', 'equals', ['project']));
            expect(evaluateFilter(t, state)).toBe(false);
        });

        it('equals — multiple values, one exact match passes', () => {
            const t = makeTask({ tags: ['urgent'] });
            const state = stateFromCondition(cond('tag', 'equals', ['work', 'urgent']));
            expect(evaluateFilter(t, state)).toBe(true);
        });

        it('only — matches when tags exactly equal the filter set', () => {
            const t = makeTask({ tags: ['A', 'B'] });
            const state = stateFromCondition(cond('tag', 'only', ['A', 'B']));
            expect(evaluateFilter(t, state)).toBe(true);
        });

        it('only — does not match when task has extra tags', () => {
            const t = makeTask({ tags: ['A', 'B', 'C'] });
            const state = stateFromCondition(cond('tag', 'only', ['A', 'B']));
            expect(evaluateFilter(t, state)).toBe(false);
        });

        it('only — does not match when task is missing a filter tag', () => {
            const t = makeTask({ tags: ['A'] });
            const state = stateFromCondition(cond('tag', 'only', ['A', 'B']));
            expect(evaluateFilter(t, state)).toBe(false);
        });

        it('only — matches single tag', () => {
            const t = makeTask({ tags: ['A'] });
            const state = stateFromCondition(cond('tag', 'only', ['A']));
            expect(evaluateFilter(t, state)).toBe(true);
        });

        it('only — does not match empty tags against non-empty filter', () => {
            const t = makeTask({ tags: [] });
            const state = stateFromCondition(cond('tag', 'only', ['A']));
            expect(evaluateFilter(t, state)).toBe(false);
        });
    });

    // ── Content (case-insensitive substring) ──
    describe('content filter', () => {
        const task = makeTask({ content: 'Fix Login Bug' });

        it('contains — case-insensitive match', () => {
            const state = stateFromCondition(cond('content', 'contains', 'login'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('contains — no match', () => {
            const state = stateFromCondition(cond('content', 'contains', 'signup'));
            expect(evaluateFilter(task, state)).toBe(false);
        });

        it('notContains — no match passes', () => {
            const state = stateFromCondition(cond('content', 'notContains', 'signup'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('notContains — match filtered', () => {
            const state = stateFromCondition(cond('content', 'notContains', 'login'));
            expect(evaluateFilter(task, state)).toBe(false);
        });
    });

    // ── Date (startDate, endDate, due) ──
    describe('date filters', () => {
        const task = makeDisplayTask({ startDate: '2026-03-10' });

        it('isSet — date exists', () => {
            const state = stateFromCondition(cond('startDate', 'isSet'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('isSet — date missing', () => {
            const noDate = makeDisplayTask();
            const state = stateFromCondition(cond('startDate', 'isSet'));
            expect(evaluateFilter(noDate, state)).toBe(false);
        });

        it('isNotSet — date missing', () => {
            const noDate = makeDisplayTask();
            const state = stateFromCondition(cond('startDate', 'isNotSet'));
            expect(evaluateFilter(noDate, state)).toBe(true);
        });

        it('equals — absolute date match', () => {
            const state = stateFromCondition(cond('startDate', 'equals', '2026-03-10'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('equals — absolute date mismatch', () => {
            const state = stateFromCondition(cond('startDate', 'equals', '2026-03-11'));
            expect(evaluateFilter(task, state)).toBe(false);
        });

        it('before — task date before filter date', () => {
            const state = stateFromCondition(cond('startDate', 'before', '2026-03-11'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('before — task date not before', () => {
            const state = stateFromCondition(cond('startDate', 'before', '2026-03-10'));
            expect(evaluateFilter(task, state)).toBe(false);
        });

        it('after — task date after filter date', () => {
            const state = stateFromCondition(cond('startDate', 'after', '2026-03-09'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('after — task date not after', () => {
            const state = stateFromCondition(cond('startDate', 'after', '2026-03-10'));
            expect(evaluateFilter(task, state)).toBe(false);
        });

        it('onOrBefore — equal date', () => {
            const state = stateFromCondition(cond('startDate', 'onOrBefore', '2026-03-10'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('onOrAfter — equal date', () => {
            const state = stateFromCondition(cond('startDate', 'onOrAfter', '2026-03-10'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('date filter on missing date — returns false', () => {
            const noDate = makeDisplayTask();
            const state = stateFromCondition(cond('startDate', 'equals', '2026-03-10'));
            expect(evaluateFilter(noDate, state)).toBe(false);
        });
    });

    describe('due filter', () => {
        it('strips time portion from due', () => {
            const task = makeDisplayTask({ due: '2026-05-15T10:00' });
            const state = stateFromCondition(cond('due', 'equals', '2026-05-15'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('due isSet', () => {
            const task = makeDisplayTask({ due: '2026-05-15' });
            const state = stateFromCondition(cond('due', 'isSet'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('due isNotSet when missing', () => {
            const task = makeTask();
            const state = stateFromCondition(cond('due', 'isNotSet'));
            expect(evaluateFilter(task, state)).toBe(true);
        });
    });

    // ── anyDate filter (aggregate over start/end/due) ──
    // isSet   = any of the three is set (scheduled)
    // isNotSet = all three unset (inbox)
    describe('anyDate filter', () => {
        it('isSet — task with startDate matches', () => {
            const task = makeDisplayTask({ startDate: '2026-03-10' });
            const state = stateFromCondition(cond('anyDate', 'isSet'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('isSet — task with only due matches', () => {
            const task = makeDisplayTask({ due: '2026-03-10' });
            const state = stateFromCondition(cond('anyDate', 'isSet'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('isSet — task with only endDate matches', () => {
            const task = makeDisplayTask({ endDate: '2026-03-10' });
            const state = stateFromCondition(cond('anyDate', 'isSet'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('isSet — task with no dates does not match', () => {
            const task = makeDisplayTask();
            const state = stateFromCondition(cond('anyDate', 'isSet'));
            expect(evaluateFilter(task, state)).toBe(false);
        });

        it('isNotSet — task with no dates matches (inbox)', () => {
            const task = makeDisplayTask();
            const state = stateFromCondition(cond('anyDate', 'isNotSet'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('isNotSet — dated task does not match', () => {
            const task = makeDisplayTask({ startDate: '2026-03-10' });
            const state = stateFromCondition(cond('anyDate', 'isNotSet'));
            expect(evaluateFilter(task, state)).toBe(false);
        });

        it('uses effective date fields when provided (DisplayTask)', () => {
            const dt = makeDisplayTask({ startDate: '2026-03-10' });
            const state = stateFromCondition(cond('anyDate', 'isSet'));
            expect(evaluateFilter(dt, state)).toBe(true);
        });
    });

    // ── Length filter ──
    describe('length filter', () => {
        // Task with 2-hour duration: 09:00 - 11:00 same day
        const task = makeDisplayTask({
            startDate: '2026-03-10',
            startTime: '09:00',
            endDate: '2026-03-10',
            endTime: '11:00',
        });

        it('isSet — has start date', () => {
            const state = stateFromCondition(cond('length', 'isSet'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('isNotSet — no start date', () => {
            const noDate = makeDisplayTask();
            const state = stateFromCondition(cond('length', 'isNotSet'));
            expect(evaluateFilter(noDate, state)).toBe(true);
        });

        it('lessThan 3 hours — 2h task passes', () => {
            const c = cond('length', 'lessThan', 3);
            c.unit = 'hours';
            const state = stateFromCondition(c);
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('greaterThan 1 hour — 2h task passes', () => {
            const c = cond('length', 'greaterThan', 1);
            c.unit = 'hours';
            const state = stateFromCondition(c);
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('equals 2 hours', () => {
            const c = cond('length', 'equals', 2);
            c.unit = 'hours';
            const state = stateFromCondition(c);
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('lessThanOrEqual 2 hours', () => {
            const c = cond('length', 'lessThanOrEqual', 2);
            c.unit = 'hours';
            const state = stateFromCondition(c);
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('greaterThanOrEqual 2 hours', () => {
            const c = cond('length', 'greaterThanOrEqual', 2);
            c.unit = 'hours';
            const state = stateFromCondition(c);
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('unit: minutes — 120 minutes', () => {
            const c = cond('length', 'equals', 120);
            c.unit = 'minutes';
            const state = stateFromCondition(c);
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('greaterThan 3 hours — 2h task fails', () => {
            const c = cond('length', 'greaterThan', 3);
            c.unit = 'hours';
            const state = stateFromCondition(c);
            expect(evaluateFilter(task, state)).toBe(false);
        });
    });

    // ── Group logic ──
    describe('group logic', () => {
        const task = makeTask({ tags: ['work'], file: 'notes/daily.md' });

        it('AND — both pass', () => {
            const state = stateFromConditions([
                cond('tag', 'includes', ['work']),
                cond('file', 'includes', ['notes/daily.md']),
            ], 'and');
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('AND — one fails', () => {
            const state = stateFromConditions([
                cond('tag', 'includes', ['work']),
                cond('file', 'includes', ['other.md']),
            ], 'and');
            expect(evaluateFilter(task, state)).toBe(false);
        });

        it('OR — one passes', () => {
            const state = stateFromConditions([
                cond('tag', 'includes', ['personal']),
                cond('file', 'includes', ['notes/daily.md']),
            ], 'or');
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('OR — all fail', () => {
            const state = stateFromConditions([
                cond('tag', 'includes', ['personal']),
                cond('file', 'includes', ['other.md']),
            ], 'or');
            expect(evaluateFilter(task, state)).toBe(false);
        });

        it('empty group — returns true', () => {
            const state: FilterState = { filters: [], logic: 'and' };
            expect(evaluateFilter(task, state)).toBe(true);
        });
    });

    // ── Nested groups ──
    describe('nested groups', () => {
        it('nested AND inside OR', () => {
            const task = makeTask({ tags: ['work'], statusChar: 'x' });
            const innerGroup: FilterGroup = {
                filters: [
                    cond('tag', 'includes', ['work']),
                    cond('status', 'includes', ['x']),
                ],
                logic: 'and',
            };
            const state: FilterState = {
                filters: [
                    cond('file', 'includes', ['nonexistent.md']),
                    innerGroup,
                ],
                logic: 'or',
            };
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('nested group fails — outer OR still needs one pass', () => {
            const task = makeTask({ tags: ['work'], statusChar: ' ' });
            const innerGroup: FilterGroup = {
                filters: [
                    cond('tag', 'includes', ['work']),
                    cond('status', 'includes', ['x']), // fails
                ],
                logic: 'and',
            };
            const state: FilterState = {
                filters: [
                    cond('file', 'includes', ['nonexistent.md']), // fails
                    innerGroup, // fails (status mismatch)
                ],
                logic: 'or',
            };
            expect(evaluateFilter(task, state)).toBe(false);
        });
    });

    // ── The resolved dates are the ones compared, inherited ones among them ──
    describe('DisplayTask resolved dates', () => {
        it('compares an inherited start the line does not write', () => {
            const dt = makeDisplayTask({ cascadeContext: { startDate: '2026-03-10' } });
            expect(dt.startDate).toBeUndefined();
            const state = stateFromCondition(cond('startDate', 'equals', '2026-03-10'));
            expect(evaluateFilter(dt, state)).toBe(true);
        });

        it('compares an inherited end the line does not write', () => {
            const dt = makeDisplayTask({ startDate: '2026-03-30', cascadeContext: { endDate: '2026-04-01' } });
            expect(dt.endDate).toBeUndefined();
            const state = stateFromCondition(cond('endDate', 'equals', '2026-04-01'));
            expect(evaluateFilter(dt, state)).toBe(true);
        });
    });

    // ── parent / children property (isSet / isNotSet) ──
    describe('parent property', () => {
        it('isSet — task has parentId', () => {
            const task = makeTask({ parentId: 'parent-1' });
            const state = stateFromCondition(cond('parent', 'isSet'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('isSet — task has no parentId', () => {
            const task = makeTask();
            const state = stateFromCondition(cond('parent', 'isSet'));
            expect(evaluateFilter(task, state)).toBe(false);
        });

        it('isNotSet — task has no parentId', () => {
            const task = makeTask();
            const state = stateFromCondition(cond('parent', 'isNotSet'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('isNotSet — task has parentId', () => {
            const task = makeTask({ parentId: 'parent-1' });
            const state = stateFromCondition(cond('parent', 'isNotSet'));
            expect(evaluateFilter(task, state)).toBe(false);
        });
    });

    describe('children property', () => {
        it('isSet — task has children', () => {
            const task = makeDisplayTask({
                childEntries: [
                    { kind: 'task', taskId: 'c-1', bodyLine: 2 },
                    { kind: 'task', taskId: 'c-2', bodyLine: 3 },
                ],
            });
            const state = stateFromCondition(cond('children', 'isSet'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('isSet — task has no children', () => {
            const task = makeDisplayTask({ childEntries: [] });
            const state = stateFromCondition(cond('children', 'isSet'));
            expect(evaluateFilter(task, state)).toBe(false);
        });

        it('isNotSet — task has no children', () => {
            const task = makeDisplayTask({ childEntries: [] });
            const state = stateFromCondition(cond('children', 'isNotSet'));
            expect(evaluateFilter(task, state)).toBe(true);
        });

        it('isNotSet — task has children', () => {
            const task = makeDisplayTask({
                childEntries: [{ kind: 'task', taskId: 'c-1', bodyLine: 2 }],
            });
            const state = stateFromCondition(cond('children', 'isNotSet'));
            expect(evaluateFilter(task, state)).toBe(false);
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
                const state = stateFromCondition(cond('tag', 'includes', ['sub'], 'parent'));
                expect(evaluateFilter(child, state, context)).toBe(true);
            });

            it('grandparent matches — grandchild passes (traverses 2 levels)', () => {
                const state = stateFromCondition(cond('tag', 'includes', ['projectA'], 'parent'));
                expect(evaluateFilter(grandchild, state, context)).toBe(true);
            });

            it('grandparent matches — child also passes (traverses 1 level up to grandparent)', () => {
                const state = stateFromCondition(cond('tag', 'includes', ['projectA'], 'parent'));
                expect(evaluateFilter(child, state, context)).toBe(true);
            });

            it('no ancestor matches — returns false', () => {
                const state = stateFromCondition(cond('tag', 'includes', ['nonexistent'], 'parent'));
                expect(evaluateFilter(grandchild, state, context)).toBe(false);
            });

            it('task has no parent — returns false', () => {
                const state = stateFromCondition(cond('tag', 'includes', ['projectA'], 'parent'));
                expect(evaluateFilter(orphan, state, context)).toBe(false);
            });

            it('root task (grandparent) has no parent — returns false', () => {
                const state = stateFromCondition(cond('tag', 'includes', ['projectA'], 'parent'));
                expect(evaluateFilter(grandparent, state, context)).toBe(false);
            });
        });

        // A negative operator with the parent target asks that no ancestor
        // answers yes (`not(ancestors(positive))`, decided 2026-09-30). It
        // used to ask that some ancestor answered no, so a parent holding the
        // excluded tag passed when the grandparent did not, and a task
        // without ancestors failed.
        describe('negation over ancestors: no ancestor answers yes', () => {
            it('no ancestor has the excluded tag — passes', () => {
                const state = stateFromCondition(cond('tag', 'excludes', ['blocked'], 'parent'));
                expect(evaluateFilter(child, state, context)).toBe(true);
            });

            it('the direct parent has the excluded tag — fails (it used to pass on the grandparent)', () => {
                const state = stateFromCondition(cond('tag', 'excludes', ['sub'], 'parent'));
                expect(evaluateFilter(child, state, context)).toBe(false);
            });

            it('only the grandparent has the excluded tag — fails for the child and the grandchild', () => {
                const state = stateFromCondition(cond('tag', 'excludes', ['projectA'], 'parent'));
                expect(evaluateFilter(child, state, context)).toBe(false);
                expect(evaluateFilter(grandchild, state, context)).toBe(false);
            });

            it('a task without ancestors — passes (it used to fail)', () => {
                const state = stateFromCondition(cond('tag', 'excludes', ['projectA'], 'parent'));
                expect(evaluateFilter(orphan, state, context)).toBe(true);
                expect(evaluateFilter(grandparent, state, context)).toBe(true);
            });

            it('an ancestor the index cannot resolve answers nothing — passes', () => {
                const task = makeTask({ parentId: 'missing' });
                const state = stateFromCondition(cond('tag', 'excludes', ['work'], 'parent'));
                expect(evaluateFilter(task, state, { taskLookup: () => undefined })).toBe(true);
            });

            it('notContains: an ancestor whose content contains the text — fails', () => {
                const par = makeTask({ id: 'np', content: 'Important Project', childIds: ['nc'] });
                const kid = makeTask({ id: 'nc', parentId: 'np', content: 'subtask' });
                const map = new Map<string, Task>([['np', par], ['nc', kid]]);
                const state = stateFromCondition(cond('content', 'notContains', 'important', 'parent'));
                expect(evaluateFilter(kid, state, { taskLookup: id => map.get(id) })).toBe(false);
            });

            it('isNotSet: no ancestor has a due date — the grandparent having one fails the grandchild', () => {
                const top = makeTask({ id: 'dt', due: '2026-08-30', childIds: ['dm'] });
                const mid = makeTask({ id: 'dm', parentId: 'dt', childIds: ['dl'] });
                const low = makeTask({ id: 'dl', parentId: 'dm' });
                const map = new Map<string, Task>([['dt', top], ['dm', mid], ['dl', low]]);
                const state = stateFromCondition(cond('due', 'isNotSet', undefined, 'parent'));
                expect(evaluateFilter(low, state, { taskLookup: id => map.get(id) })).toBe(false);
                expect(evaluateFilter(top, state, { taskLookup: id => map.get(id) })).toBe(true);
            });

            it('an unfinished condition (empty list) still constrains nothing', () => {
                const state = stateFromCondition(cond('tag', 'excludes', [], 'parent'));
                expect(evaluateFilter(child, state, context)).toBe(true);
                expect(evaluateFilter(orphan, state, context)).toBe(true);
            });

            it('an unfinished date with the parent target constrains nothing, on a task without ancestors too', () => {
                const state = stateFromCondition(cond('due', 'equals', undefined, 'parent'));
                expect(evaluateFilter(orphan, state, context)).toBe(true);
            });
        });

        describe('file includes (ancestor traversal)', () => {
            it('parent file matches — passes', () => {
                const state = stateFromCondition(cond('file', 'includes', ['project.md'], 'parent'));
                expect(evaluateFilter(child, state, context)).toBe(true);
            });

            it('no ancestor file matches — fails', () => {
                const state = stateFromCondition(cond('file', 'includes', ['other.md'], 'parent'));
                expect(evaluateFilter(child, state, context)).toBe(false);
            });
        });

        describe('status includes (ancestor traversal)', () => {
            it('parent status matches', () => {
                const parentDone = makeTask({ id: 'pd', parentId: 'gp', statusChar: 'x', childIds: ['cd'] });
                const childOfDone = makeTask({ id: 'cd', parentId: 'pd' });
                const map = new Map<string, Task>([['gp', grandparent], ['pd', parentDone], ['cd', childOfDone]]);
                const ctx = { taskLookup: (id: string) => map.get(id) };

                const state = stateFromCondition(cond('status', 'includes', ['x'], 'parent'));
                expect(evaluateFilter(childOfDone, state, ctx)).toBe(true);
            });
        });

        describe('content contains (ancestor traversal)', () => {
            it('ancestor content matches', () => {
                const parentWithContent = makeTask({ id: 'pwc', content: 'Important Project', childIds: ['cwc'] });
                const childTask = makeTask({ id: 'cwc', parentId: 'pwc', content: 'subtask' });
                const map = new Map<string, Task>([['pwc', parentWithContent], ['cwc', childTask]]);
                const ctx = { taskLookup: (id: string) => map.get(id) };

                const state = stateFromCondition(cond('content', 'contains', 'important', 'parent'));
                expect(evaluateFilter(childTask, state, ctx)).toBe(true);
            });
        });

        describe('date filters (ancestor traversal)', () => {
            it('ancestor startDate matches', () => {
                const parentWithDate = makeTask({ id: 'pwd', startDate: '2026-03-10', childIds: ['cwd'] });
                const childTask = makeTask({ id: 'cwd', parentId: 'pwd' });
                const map = new Map<string, Task>([['pwd', parentWithDate], ['cwd', childTask]]);
                const ctx = { taskLookup: (id: string) => map.get(id) };

                const state = stateFromCondition(cond('startDate', 'equals', '2026-03-10', 'parent'));
                expect(evaluateFilter(childTask, state, ctx)).toBe(true);
            });

            it('ancestor startDate isSet', () => {
                const parentWithDate = makeTask({ id: 'pwd2', startDate: '2026-03-10', childIds: ['cwd2'] });
                const childTask = makeTask({ id: 'cwd2', parentId: 'pwd2' });
                const map = new Map<string, Task>([['pwd2', parentWithDate], ['cwd2', childTask]]);
                const ctx = { taskLookup: (id: string) => map.get(id) };

                const state = stateFromCondition(cond('startDate', 'isSet', undefined, 'parent'));
                expect(evaluateFilter(childTask, state, ctx)).toBe(true);
            });
        });

        describe('an ancestor the index cannot resolve', () => {
            it('taskLookup returns undefined — returns false', () => {
                const task = makeTask({ parentId: 'missing' });
                const ctx = { taskLookup: () => undefined };
                const state = stateFromCondition(cond('tag', 'includes', ['work'], 'parent'));
                expect(evaluateFilter(task, state, ctx)).toBe(false);
            });
        });

        describe('combined with self conditions (AND/OR)', () => {
            it('AND: self tag + parent tag — both must pass', () => {
                const state = stateFromConditions([
                    cond('tag', 'includes', ['sub']),           // self: child has no 'sub' tag
                    cond('tag', 'includes', ['projectA'], 'parent'), // parent: grandparent has 'projectA'
                ], 'and');
                // child has no tags, so self condition fails
                expect(evaluateFilter(child, state, context)).toBe(false);
            });

            it('AND: self parent-isSet + parent tag — child has parent + ancestor has tag', () => {
                const state = stateFromConditions([
                    cond('parent', 'isSet'),                      // self: child has parentId
                    cond('tag', 'includes', ['projectA'], 'parent'), // ancestor has 'projectA'
                ], 'and');
                expect(evaluateFilter(child, state, context)).toBe(true);
            });

            it('OR: self tag fails + parent tag passes', () => {
                const state = stateFromConditions([
                    cond('tag', 'includes', ['nonexistent']),        // self: fails
                    cond('tag', 'includes', ['projectA'], 'parent'), // ancestor: passes
                ], 'or');
                expect(evaluateFilter(child, state, context)).toBe(true);
            });

            it('OR: both fail', () => {
                const state = stateFromConditions([
                    cond('tag', 'includes', ['nonexistent']),
                    cond('tag', 'includes', ['nonexistent'], 'parent'),
                ], 'or');
                expect(evaluateFilter(child, state, context)).toBe(false);
            });
        });

        // An ancestor is lifted into a DisplayTask before it is evaluated.
        // That conversion used to be hand-written here and was incomplete:
        // it assigned no `effectiveDue` (the field is optional, so the type
        // never objected) and pinned `childEntries` to [], so these
        // conditions all reported the opposite of the truth.
        describe('ancestor is evaluated by the same rules as a top-level task', () => {
            function ctxOf(...tasks: Task[]) {
                const map = new Map(tasks.map(t => [t.id, t]));
                return { startHour: 0, taskLookup: (id: string) => map.get(id) };
            }

            it('sees a due date written plainly on the parent', () => {
                const par = makeTask({ id: 'p2', due: '2026-08-30' });
                const kid = makeTask({ id: 'c2', parentId: 'p2' });
                const state = stateFromCondition(cond('due', 'isSet', undefined, 'parent'));
                expect(evaluateFilter(kid, state, ctxOf(par, kid))).toBe(true);
            });

            it('matches a date range against the parent due date', () => {
                const par = makeTask({ id: 'p2', due: '2026-08-30' });
                const kid = makeTask({ id: 'c2', parentId: 'p2' });
                const hit = stateFromCondition(cond('due', 'equals', '2026-08-30', 'parent'));
                const miss = stateFromCondition(cond('due', 'equals', '2026-08-29', 'parent'));
                expect(evaluateFilter(kid, hit, ctxOf(par, kid))).toBe(true);
                expect(evaluateFilter(kid, miss, ctxOf(par, kid))).toBe(false);
            });

            it('counts a due-only parent as having a date (anyDate)', () => {
                const par = makeTask({ id: 'p2', due: '2026-08-30' });
                const kid = makeTask({ id: 'c2', parentId: 'p2' });
                const state = stateFromCondition(cond('anyDate', 'isSet', undefined, 'parent'));
                expect(evaluateFilter(kid, state, ctxOf(par, kid))).toBe(true);
            });

            it('resolves the implicit start of an E-type parent (endDate only)', () => {
                const par = makeTask({ id: 'p2', endDate: '2026-08-22', endTime: '10:00' });
                const kid = makeTask({ id: 'c2', parentId: 'p2' });
                const state = stateFromCondition(cond('startDate', 'isSet', undefined, 'parent'));
                expect(evaluateFilter(kid, state, ctxOf(par, kid))).toBe(true);
            });

            it('resolves a start the parent inherits from its section (cascade)', () => {
                const par = makeTask({ id: 'p2', cascadeContext: { startDate: '2026-08-22' } });
                const kid = makeTask({ id: 'c2', parentId: 'p2' });
                const state = stateFromCondition(cond('startDate', 'isSet', undefined, 'parent'));
                expect(evaluateFilter(kid, state, ctxOf(par, kid))).toBe(true);
            });

            // startHour shifts a parent's late-night start to the visual day
            // before; passing 0 regardless would put this task on the 22nd
            // instead of the 21st.
            it('honours startHour when resolving the parent visual date', () => {
                const par = makeTask({ id: 'p2', startDate: '2026-08-22', startTime: '02:00' });
                const kid = makeTask({ id: 'c2', parentId: 'p2' });
                const map = new Map<string, Task>([['p2', par], ['c2', kid]]);
                const ctx = { startHour: 4, taskLookup: (id: string) => map.get(id) };
                const on21 = stateFromCondition(cond('startDate', 'equals', '2026-08-21', 'parent'));
                expect(evaluateFilter(kid, on21, ctx)).toBe(true);
            });

            it('sees that the parent has child tasks', () => {
                const par = makeTask({ id: 'p2', childIds: ['c2'] });
                const kid = makeTask({ id: 'c2', parentId: 'p2', startDate: '2026-08-22' });
                const state = stateFromCondition(cond('children', 'isSet', undefined, 'parent'));
                expect(evaluateFilter(kid, state, ctxOf(par, kid))).toBe(true);
            });

            it('reports no children for a childless grandparent', () => {
                const gp = makeTask({ id: 'gp2', childIds: [] });
                const par = makeTask({ id: 'p2', parentId: 'gp2', childIds: [] });
                const kid = makeTask({ id: 'c2', parentId: 'p2' });
                const state = stateFromCondition(cond('children', 'isSet', undefined, 'parent'));
                expect(evaluateFilter(kid, state, ctxOf(gp, par, kid))).toBe(false);
            });

            it('still traverses two levels for a date condition', () => {
                const gp = makeTask({ id: 'gp2', due: '2026-08-30' });
                const par = makeTask({ id: 'p2', parentId: 'gp2' });
                const kid = makeTask({ id: 'c2', parentId: 'p2' });
                const state = stateFromCondition(cond('due', 'isSet', undefined, 'parent'));
                expect(evaluateFilter(kid, state, ctxOf(gp, par, kid))).toBe(true);
            });
        });

        describe('circular reference protection', () => {
            it('does not infinite loop on circular parentId', () => {
                const a = makeTask({ id: 'a', parentId: 'b', tags: [] });
                const b = makeTask({ id: 'b', parentId: 'a', tags: [] });
                const map = new Map<string, Task>([['a', a], ['b', b]]);
                const ctx = { taskLookup: (id: string) => map.get(id) };

                const state = stateFromCondition(cond('tag', 'includes', ['x'], 'parent'));
                // Should terminate without infinite loop, returning false (no ancestor has tag 'x')
                expect(evaluateFilter(a, state, ctx)).toBe(false);
            });
        });

        describe('self target (default behavior)', () => {
            it('target=self behaves same as no target', () => {
                const task = makeTask({ tags: ['work'] });
                const condSelf = cond('tag', 'includes', ['work'], 'self');
                const condNoTarget = cond('tag', 'includes', ['work']);
                expect(evaluateFilter(task, stateFromCondition(condSelf))).toBe(true);
                expect(evaluateFilter(task, stateFromCondition(condNoTarget))).toBe(true);
            });

            it('target=self does not traverse ancestors', () => {
                const state = stateFromCondition(cond('tag', 'includes', ['projectA'], 'self'));
                // child has no tags — self evaluation only, not ancestor
                expect(evaluateFilter(child, state, context)).toBe(false);
            });
        });
    });
});

// A new list starts with top-level tasks only: every checkbox is a task, and a
// nested one is already drawn inside its parent's card.
describe('createDefaultListFilterState', () => {
    it('keeps top-level tasks and drops nested ones', () => {
        const state = createDefaultListFilterState();
        expect(evaluateFilter(makeDisplayTask({ id: 'top' }), state)).toBe(true);
        expect(evaluateFilter(makeDisplayTask({ id: 'nested', parentId: 'top' }), state)).toBe(false);
    });

    it('hands out a fresh state each time', () => {
        const a = createDefaultListFilterState();
        a.filters.push({ property: 'tag', operator: 'includes', value: ['x'] });
        expect(createDefaultListFilterState().filters).toHaveLength(1);
    });
    // The clock is the context's: a relative preset counts from `now`, so a
    // filter evaluated twice at the same moment answers the same.
    describe('relative presets count from the context\'s now', () => {
        const task = makeDisplayTask({ due: '2026-03-10' });
        const today = stateFromCondition(cond('due', 'equals', { preset: 'today' }));

        it('today at noon on the due day — matches', () => {
            expect(evaluateFilter(task, today, { now: new Date(2026, 2, 10, 12) })).toBe(true);
        });

        it('the next day — does not match', () => {
            expect(evaluateFilter(task, today, { now: new Date(2026, 2, 11, 12) })).toBe(false);
        });

        it('before startHour, still the previous visual day — matches', () => {
            expect(evaluateFilter(task, today, { now: new Date(2026, 2, 11, 3), startHour: 5 })).toBe(true);
        });
    });
});
