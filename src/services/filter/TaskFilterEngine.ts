import type { Task } from '../../types';
import type { FilterState, FilterCondition } from './FilterTypes';

/**
 * Evaluates whether a task passes all filter conditions.
 */
export class TaskFilterEngine {
    static evaluate(task: Task, filterState: FilterState): boolean {
        if (filterState.conditions.length === 0) return true;
        return filterState.conditions.every(c => this.evalCondition(task, c));
    }

    private static evalCondition(task: Task, condition: FilterCondition): boolean {
        switch (condition.property) {
            case 'file':
                return this.evalStringSet(task.file, condition);
            case 'tag':
                return this.evalTag(task, condition);
            case 'status':
                return this.evalStringSet(task.statusChar, condition);
            case 'hasStartDate':
                return this.evalHasField(!!task.startDate, condition);
            case 'hasDeadline':
                return this.evalHasField(!!task.deadline, condition);
            case 'content':
                return this.evalContent(task, condition);
            default:
                return true;
        }
    }

    private static evalStringSet(value: string, c: FilterCondition): boolean {
        if (c.value.type !== 'stringSet') return true;
        if (c.operator === 'includes') return c.value.values.includes(value);
        if (c.operator === 'excludes') return !c.value.values.includes(value);
        return true;
    }

    private static evalTag(task: Task, c: FilterCondition): boolean {
        if (c.value.type !== 'stringSet') return true;
        if (c.operator === 'includes') {
            return c.value.values.some(v => task.tags.includes(v));
        }
        if (c.operator === 'excludes') {
            return !c.value.values.some(v => task.tags.includes(v));
        }
        return true;
    }

    private static evalHasField(hasValue: boolean, c: FilterCondition): boolean {
        if (c.operator === 'isSet') return hasValue;
        if (c.operator === 'isNotSet') return !hasValue;
        return true;
    }

    private static evalContent(task: Task, c: FilterCondition): boolean {
        if (c.value.type !== 'string') return true;
        const lower = task.content.toLowerCase();
        const search = c.value.value.toLowerCase();
        if (c.operator === 'contains') return lower.includes(search);
        if (c.operator === 'notContains') return !lower.includes(search);
        return true;
    }
}
