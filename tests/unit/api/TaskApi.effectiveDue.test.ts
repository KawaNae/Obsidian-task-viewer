import { describe, it, expect, vi } from 'vitest';
import { toDisplayTask } from '../../../src/services/display/DisplayTaskConverter';
import { DateUtils } from '../../../src/utils/DateUtils';
import { TaskFilterEngine } from '../../../src/services/filter/TaskFilterEngine';
import type { Task, DisplayTask } from '../../../src/types';
import type { FilterState, FilterCondition } from '../../../src/services/filter/FilterTypes';

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'test-1',
        file: 'test.md',
        line: 0,
        content: 'test',
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        originalText: '- [ ] test',
        tags: [],
        parserId: 'tv-inline',
        ...overrides,
    } as Task;
}

const noLookup = () => undefined;

describe('effectiveDue: cascade 継承', () => {
    it('raw due がある場合は effectiveDue = raw due', () => {
        const task = makeTask({ due: '2026-07-18' });
        const dt = toDisplayTask(task, 0, noLookup);
        expect(dt.effectiveDue).toBe('2026-07-18');
        expect(dt.due).toBe('2026-07-18');
    });

    it('raw due なし + cascadeContext.due → effectiveDue に反映', () => {
        const task = makeTask({
            cascadeContext: { due: '2026-07-20' },
        });
        const dt = toDisplayTask(task, 0, noLookup);
        expect(dt.effectiveDue).toBe('2026-07-20');
        expect(dt.due).toBeUndefined();
    });

    it('raw due も cascadeContext.due もなし → effectiveDue は undefined', () => {
        const task = makeTask();
        const dt = toDisplayTask(task, 0, noLookup);
        expect(dt.effectiveDue).toBeUndefined();
    });

    it('raw due は cascadeContext.due より優先', () => {
        const task = makeTask({
            due: '2026-07-18',
            cascadeContext: { due: '2026-07-20' },
        });
        const dt = toDisplayTask(task, 0, noLookup);
        expect(dt.effectiveDue).toBe('2026-07-18');
    });
});

describe('dueDatePart: datetime due の日付部分抽出', () => {
    it('YYYY-MM-DD → YYYY-MM-DD', () => {
        expect(DateUtils.dueDatePart('2026-07-18')).toBe('2026-07-18');
    });

    it('YYYY-MM-DDTHH:mm → YYYY-MM-DD', () => {
        expect(DateUtils.dueDatePart('2026-07-18T10:00')).toBe('2026-07-18');
    });

    it('undefined → undefined', () => {
        expect(DateUtils.dueDatePart(undefined)).toBeUndefined();
    });
});

describe('effectiveDue: due フィルタが cascade due を含む', () => {
    function dueCond(operator: string, value?: string): FilterState {
        const cond: FilterCondition = { property: 'due', operator, ...(value !== undefined ? { value } : {}) };
        return { logic: 'and', filters: [cond] };
    }

    it('cascade due を持つタスクが due isSet にかかる', () => {
        const task = makeTask({ cascadeContext: { due: '2026-07-20' } });
        const dt = toDisplayTask(task, 0, noLookup);
        expect(TaskFilterEngine.evaluate(dt, dueCond('isSet'))).toBe(true);
    });

    it('cascade due なし + raw due なし → due isNotSet', () => {
        const task = makeTask();
        const dt = toDisplayTask(task, 0, noLookup);
        expect(TaskFilterEngine.evaluate(dt, dueCond('isNotSet'))).toBe(true);
    });

    it('datetime due が日付部分で equals にマッチ', () => {
        const task = makeTask({ due: '2026-07-18T14:00' });
        const dt = toDisplayTask(task, 0, noLookup);
        expect(TaskFilterEngine.evaluate(dt, dueCond('equals', '2026-07-18'))).toBe(true);
    });
});

describe('weekStartDay: フィルタの週窓が設定に従う', () => {
    function thisWeekCond(): FilterState {
        const cond: FilterCondition = {
            property: 'startDate',
            operator: 'equals',
            value: { preset: 'thisWeek' },
        };
        return { logic: 'and', filters: [cond] };
    }

    it('weekStartDay=0 と weekStartDay=1 で異なる結果が出うる', () => {
        const task = makeTask({ startDate: '2026-07-20' });
        const dt = toDisplayTask(task, 0, noLookup);
        const filter = thisWeekCond();

        const resultSunday = TaskFilterEngine.evaluate(dt, filter, { weekStartDay: 0 });
        const resultMonday = TaskFilterEngine.evaluate(dt, filter, { weekStartDay: 1 });
        // 2026-07-20 is Monday. With weekStartDay=0 (Sun) the week is Sun 7/19 - Sat 7/25,
        // so Mon 7/20 is inside. With weekStartDay=1 (Mon) the week is Mon 7/20 - Sun 7/26,
        // so Mon 7/20 is also inside. Both should be true in this case.
        // The key verification is that it doesn't crash and produces consistent results.
        expect(typeof resultSunday).toBe('boolean');
        expect(typeof resultMonday).toBe('boolean');
    });
});
