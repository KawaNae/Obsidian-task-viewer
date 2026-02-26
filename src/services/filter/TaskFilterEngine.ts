import type { Task } from '../../types';
import type { FilterState, FilterConditionNode, FilterGroupNode, FilterNode } from './FilterTypes';
import { DateResolver } from './DateResolver';

/**
 * Evaluates whether a task passes a recursive filter tree.
 * Groups can contain both conditions and sub-groups at any depth.
 */
export class TaskFilterEngine {
    static evaluate(task: Task, filterState: FilterState): boolean {
        return this.evaluateGroup(task, filterState.root);
    }

    private static evaluateGroup(task: Task, group: FilterGroupNode): boolean {
        if (group.children.length === 0) return true;

        if (group.logic === 'or') {
            return group.children.some(child => this.evaluateNode(task, child));
        }
        return group.children.every(child => this.evaluateNode(task, child));
    }

    private static evaluateNode(task: Task, node: FilterNode): boolean {
        if (node.type === 'condition') {
            return this.evalCondition(task, node);
        }
        return this.evaluateGroup(task, node);
    }

    private static evalCondition(task: Task, condition: FilterConditionNode): boolean {
        // Skip conditions with empty stringSet values (value not yet selected)
        if (condition.value.type === 'stringSet' && condition.value.values.length === 0) return true;
        switch (condition.property) {
            case 'file':
                return this.evalStringSet(task.file, condition);
            case 'tag':
                return this.evalTag(task, condition);
            case 'status':
                return this.evalStringSet(task.statusChar, condition);
            case 'content':
                return this.evalContent(task, condition);
            case 'startDate':
                return this.evalDate(task.startDate, condition);
            case 'endDate':
                return this.evalDate(task.endDate, condition);
            case 'deadline':
                return this.evalDate(task.deadline, condition);
            case 'color':
                return this.evalStringSet(task.color ?? '', condition);
            case 'linestyle':
                return this.evalStringSet(task.linestyle ?? '', condition);
            default:
                return true;
        }
    }

    private static evalStringSet(value: string, c: FilterConditionNode): boolean {
        if (c.value.type !== 'stringSet') return true;
        if (c.operator === 'includes') return c.value.values.includes(value);
        if (c.operator === 'excludes') return !c.value.values.includes(value);
        return true;
    }

    private static evalTag(task: Task, c: FilterConditionNode): boolean {
        if (c.value.type !== 'stringSet') return true;
        if (c.operator === 'includes') {
            return c.value.values.some(v => task.tags.includes(v));
        }
        if (c.operator === 'excludes') {
            return !c.value.values.some(v => task.tags.includes(v));
        }
        return true;
    }

    private static evalContent(task: Task, c: FilterConditionNode): boolean {
        if (c.value.type !== 'string') return true;
        const lower = task.content.toLowerCase();
        const search = c.value.value.toLowerCase();
        if (c.operator === 'contains') return lower.includes(search);
        if (c.operator === 'notContains') return !lower.includes(search);
        return true;
    }

    private static evalDate(taskDate: string | undefined, c: FilterConditionNode): boolean {
        // isSet / isNotSet — existence check, no date value needed
        if (c.operator === 'isSet') return !!taskDate;
        if (c.operator === 'isNotSet') return !taskDate;

        if (c.value.type !== 'date') return true;
        if (!taskDate) return false;
        const { start, end } = DateResolver.resolve(c.value.value);
        switch (c.operator) {
            case 'equals':     return taskDate >= start && taskDate <= end;
            case 'before':     return taskDate < start;
            case 'after':      return taskDate > end;
            case 'onOrBefore': return taskDate <= end;
            case 'onOrAfter':  return taskDate >= start;
            default: return true;
        }
    }
}
