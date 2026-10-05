import { describe, it, expect } from 'vitest';
import { shorthandConditions, refuseWindowOnToday } from '../../../src/api/QueryShorthand';
import type { FilterCondition } from '../../../src/services/filter/FilterTypes';
import type { ListParams } from '../../../src/api/TaskApiTypes';
import { TaskApiError } from '../../../src/api/TaskApiTypes';
import { evaluateFilter } from '../helpers/filterContext';
import { makeTask } from '../helpers/makeTask';

function findCondition(conditions: FilterCondition[], property: string): FilterCondition | undefined {
    return conditions.find(c => c.property === property);
}

describe('shorthandConditions: the simple fields', () => {
    it('names none when no params are given', () => {
        expect(shorthandConditions({})).toEqual([]);
    });

    it('file → file includes, .md appended', () => {
        expect(findCondition(shorthandConditions({ file: 'daily.md' }), 'file'))
            .toEqual({ property: 'file', operator: 'includes', value: ['daily.md'] });
        expect(findCondition(shorthandConditions({ file: 'daily' }), 'file')!.value).toEqual(['daily.md']);
    });

    it('status → status includes', () => {
        expect(findCondition(shorthandConditions({ status: 'x,-' }), 'status')!.value).toEqual(['x', '-']);
    });

    it('tag → tag includes (strips #)', () => {
        expect(findCondition(shorthandConditions({ tag: '#work,reading' }), 'tag')!.value).toEqual(['work', 'reading']);
    });

    it('content → content contains', () => {
        expect(findCondition(shorthandConditions({ content: '会議' }), 'content'))
            .toEqual({ property: 'content', operator: 'contains', value: '会議' });
    });

    it('due → due equals, not a window', () => {
        expect(shorthandConditions({ due: '2026-03-20' }))
            .toEqual([{ property: 'due', operator: 'equals', value: '2026-03-20' }]);
    });

    it('reads a full-width date', () => {
        expect(findCondition(shorthandConditions({ due: '２０２６－０３－１５' }), 'due')?.value).toBe('2026-03-15');
    });

    it('leaf → children isNotSet; root → parent isNotSet', () => {
        expect(shorthandConditions({ leaf: true })).toEqual([{ property: 'children', operator: 'isNotSet' }]);
        expect(shorthandConditions({ root: true })).toEqual([{ property: 'parent', operator: 'isNotSet' }]);
    });

    it('property → property contains with key', () => {
        expect(shorthandConditions({ property: '優先度:高' }))
            .toEqual([{ property: 'property', operator: 'contains', key: '優先度', value: '高' }]);
        expect(() => shorthandConditions({ property: 'noColonHere' })).toThrow(/Invalid property filter format/);
    });

    it('color → color includes, a string or an array', () => {
        expect(findCondition(shorthandConditions({ color: 'red,blue' }), 'color')!.value).toEqual(['red', 'blue']);
        expect(findCondition(shorthandConditions({ color: ['green'] }), 'color')!.value).toEqual(['green']);
    });

    it('type → notation includes', () => {
        expect(findCondition(shorthandConditions({ type: 'taskviewer,tasks' }), 'notation')!.value).toEqual(['taskviewer', 'tasks']);
    });

    it('several fields make one condition each, the simple ones before the window', () => {
        expect(shorthandConditions({ date: 'today', file: 'test.md', tag: 'work', leaf: true }).map(c => c.property))
            .toEqual(['file', 'tag', 'children', 'period']);
    });

    it('names the presets when due is neither a date nor a preset', () => {
        expect(() => shorthandConditions({ due: 'soon' }))
            .toThrow(/Invalid date value for due: soon\. Use YYYY-MM-DD, YYYY-MM-DD HH:mm or a preset \(today, /);
    });
});

describe('shorthandConditions: the window is period overlaps', () => {
    it('date is period overlaps the date, the preset or the moment', () => {
        expect(shorthandConditions({ date: '2026-10-04' }))
            .toEqual([{ property: 'period', operator: 'overlaps', value: '2026-10-04' }]);
        expect(shorthandConditions({ date: 'today' }))
            .toEqual([{ property: 'period', operator: 'overlaps', value: { preset: 'today' } }]);
        expect(shorthandConditions({ date: '2026-10-04 10:00' }))
            .toEqual([{ property: 'period', operator: 'overlaps', value: '2026-10-04T10:00' }]);
    });

    it('from and to are one range; one of them alone an open one', () => {
        expect(shorthandConditions({ from: '2026-10-01', to: '2026-10-03' }))
            .toEqual([{ property: 'period', operator: 'overlaps', value: { from: '2026-10-01', to: '2026-10-03' } }]);
        expect(shorthandConditions({ from: '2026-10-01' }))
            .toEqual([{ property: 'period', operator: 'overlaps', value: { from: '2026-10-01' } }]);
        expect(shorthandConditions({ to: 'thisweek' }))
            .toEqual([{ property: 'period', operator: 'overlaps', value: { to: { preset: 'thisWeek' } } }]);
    });

    it('refuses a from after its to, naming from', () => {
        let error: unknown;
        try { shorthandConditions({ from: '2026-10-10', to: '2026-10-01' }); } catch (e) { error = e; }
        expect(error).toBeInstanceOf(TaskApiError);
        expect((error as TaskApiError).rawMessage).toBe('from 2026-10-10 is after to 2026-10-01');
        expect((error as TaskApiError).param).toBe('from');
        expect(() => shorthandConditions({ from: '2026-10-04 11:00', to: '2026-10-04 10:00' })).toThrow(/is after/);
    });

    it('does not compare presets as they are read (as a range in a filter)', () => {
        expect(shorthandConditions({ from: 'nextWeek', to: 'thisWeek' })).toHaveLength(1);
    });

    it('refuses date beside from or to', () => {
        expect(() => shorthandConditions({ date: '2026-03-15', from: '2026-03-01' }))
            .toThrow(/Cannot use 'date' together with 'from'/);
        expect(() => shorthandConditions({ date: '2026-03-15', to: '2026-03-31' }))
            .toThrow(/Cannot use 'date' together with 'from'/);
    });

    it('refuses a value that is no date', () => {
        expect(() => shorthandConditions({ date: 'invalid' }))
            .toThrow(/Invalid date value for date: invalid\. Use YYYY-MM-DD, YYYY-MM-DD HH:mm or a preset \(today, /);
    });

    // Stage 7, input decision B: a date-shaped value naming no day is refused.
    it.each([
        [{ date: '2026-02-30' }, /date must be a day that exists, got: "2026-02-30"/],
        [{ from: '2026-13-45' }, /from must be a day that exists/],
        [{ to: '2026-04-31' }, /to must be a day that exists/],
        [{ due: '2025-02-29' }, /due must be a day that exists/],
    ])('refuses %j, which names no day', (params, message) => {
        expect(() => shorthandConditions(params as ListParams)).toThrow(message);
    });
});

describe('the window as it matches (startHour 5)', () => {
    const at = (params: ListParams, task: Parameters<typeof makeTask>[0]) =>
        evaluateFilter(makeTask(task), { logic: 'and', filters: shorthandConditions(params) }, { startHour: 5 });

    it('a task crossing the window matches from alone; one ended before it does not', () => {
        expect(at({ from: '2026-02-15' }, { startDate: '2026-02-10', endDate: '2026-02-20' })).toBe(true);
        expect(at({ from: '2026-02-15' }, { startDate: '2026-02-01', endDate: '2026-02-05' })).toBe(false);
        expect(at({ to: '2026-02-25' }, { startDate: '2026-03-01' })).toBe(false);
    });

    it('a point right at the window\'s start matches (it did not before 11e)', () => {
        expect(at({ date: '2026-10-04' }, { startDate: '2026-10-04', startTime: '05:00', endDate: '2026-10-04', endTime: '05:00' })).toBe(true);
    });

    it('a moment matches the tasks whose span holds it', () => {
        expect(at({ date: '2026-10-04 10:00' }, { startDate: '2026-10-04', startTime: '09:00', endTime: '10:00' })).toBe(false);
        expect(at({ date: '2026-10-04 10:00' }, { startDate: '2026-10-04', startTime: '10:00', endTime: '11:00' })).toBe(true);
    });

    it('a task with no dates is in no window', () => {
        expect(at({ from: '2026-02-01', to: '2026-12-31' }, {})).toBe(false);
    });
});

describe('refuseWindowOnToday', () => {
    it('takes params with no window', () => {
        expect(() => refuseWindowOnToday({ tag: 'work' })).not.toThrow();
    });

    it.each(['date', 'from', 'to'])('refuses %s, naming it in the caller\'s spelling', key => {
        let error: unknown;
        try { refuseWindowOnToday({ [key]: '2026-10-10' }); } catch (e) { error = e; }
        expect((error as TaskApiError).rawMessage)
            .toBe(`Cannot use '${key}' with today, which is date=today; use list ${key}=2026-10-10`);
        expect((error as TaskApiError).param).toBe(key);
    });
});
