import type { Task, DisplayTask } from '../../types';
import type { FilterState, FilterCondition, FilterGroup, FilterItem, FilterContext, DateFilterValue } from './FilterTypes';
import { isFilterCondition } from './FilterTypes';
import { DateResolver } from './DateResolver';
import { DateUtils } from '../../utils/DateUtils';

/**
 * Evaluates whether a task passes a recursive filter tree.
 * Groups can contain both conditions and sub-groups at any depth.
 *
 * Accepts both Task and DisplayTask:
 * - DisplayTask: date filters use effective (resolved) values via effectiveStartDate/effectiveEndDate
 * - Raw Task: date filters fall back to raw startDate/endDate (E/ED implicit dates not available)
 *
 * Callers passing DisplayTask: KanbanView, PinnedListRenderer
 * Callers passing raw Task: FilterMenuComponent, ScheduleTaskCategorizer, GridRenderer
 */
export class TaskFilterEngine {
    static evaluate(task: Task, filterState: FilterState, context?: FilterContext): boolean {
        return this.evaluateGroup(task, filterState, context);
    }

    private static evaluateGroup(task: Task, group: FilterGroup, context?: FilterContext): boolean {
        if (group.filters.length === 0) return true;

        if (group.logic === 'or') {
            return group.filters.some(child => this.evaluateItem(task, child, context));
        }
        return group.filters.every(child => this.evaluateItem(task, child, context));
    }

    private static evaluateItem(task: Task, node: FilterItem, context?: FilterContext): boolean {
        if (isFilterCondition(node)) {
            return this.evalCondition(task, node, context);
        }
        return this.evaluateGroup(task, node, context);
    }

    private static evalCondition(task: Task, condition: FilterCondition, context?: FilterContext): boolean {
        // Skip conditions with empty array values (value not yet selected)
        if (Array.isArray(condition.value) && condition.value.length === 0) return true;

        // Target resolution: evaluate condition against any ancestor
        if (condition.target === 'parent') {
            const selfCondition = { ...condition, target: undefined } as FilterCondition;
            const seen = new Set<string>();
            let current: Task | undefined = task;
            while (current?.parentId && !seen.has(current.parentId)) {
                seen.add(current.parentId);
                const ancestor: Task | undefined = context?.taskLookup?.(current.parentId);
                if (!ancestor) break;
                if (this.evalCondition(ancestor, selfCondition, context)) return true;
                current = ancestor;
            }
            return false;
        }

        const dt = task as Partial<DisplayTask>;
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
                return this.evalDate(dt.effectiveStartDate ?? task.startDate, condition, context?.startHour ?? 0);
            case 'endDate':
                return this.evalDate(dt.effectiveEndDate ?? task.endDate, condition, context?.startHour ?? 0);
            case 'due':
                return this.evalDate(task.due?.split('T')[0], condition, context?.startHour ?? 0);
            case 'color':
                return this.evalStringSet(task.color ?? '', condition);
            case 'linestyle':
                return this.evalStringSet(task.linestyle ?? '', condition);
            case 'length':
                return this.evalLength(task, condition, context?.startHour ?? 0);
            case 'taskType':
                return this.evalStringSet(task.parserId, condition);
            case 'parent':
                if (condition.operator === 'isSet') return !!task.parentId;
                if (condition.operator === 'isNotSet') return !task.parentId;
                return true;
            case 'children':
                if (condition.operator === 'isSet') return task.childIds.length > 0;
                if (condition.operator === 'isNotSet') return task.childIds.length === 0;
                return true;
            case 'property':
                return this.evalProperty(task, condition);
            default:
                return true;
        }
    }

    private static evalStringSet(value: string, c: FilterCondition): boolean {
        if (!Array.isArray(c.value)) return true;
        if (c.operator === 'includes') return c.value.includes(value);
        if (c.operator === 'excludes') return !c.value.includes(value);
        return true;
    }

    private static tagMatches(taskTag: string, filterTag: string): boolean {
        return taskTag === filterTag || taskTag.startsWith(filterTag + '/');
    }

    private static evalTag(task: Task, c: FilterCondition): boolean {
        if (!Array.isArray(c.value)) return true;
        if (c.operator === 'includes') {
            return c.value.some(v => task.tags.some(t => this.tagMatches(t, v)));
        }
        if (c.operator === 'excludes') {
            return !c.value.some(v => task.tags.some(t => this.tagMatches(t, v)));
        }
        if (c.operator === 'equals') {
            return c.value.some(v => task.tags.some(t => t === v));
        }
        if (c.operator === 'only') {
            const filterSet = new Set(c.value);
            return task.tags.length === filterSet.size
                && task.tags.every(t => filterSet.has(t));
        }
        return true;
    }

    private static evalContent(task: Task, c: FilterCondition): boolean {
        if (typeof c.value !== 'string') return true;
        const lower = task.content.toLowerCase();
        const search = c.value.toLowerCase();
        if (c.operator === 'contains') return lower.includes(search);
        if (c.operator === 'notContains') return !lower.includes(search);
        return true;
    }

    private static evalDate(taskDate: string | undefined, c: FilterCondition, startHour: number = 0): boolean {
        // isSet / isNotSet — existence check, no date value needed
        if (c.operator === 'isSet') return !!taskDate;
        if (c.operator === 'isNotSet') return !taskDate;

        if (c.value == null) return true;
        if (!taskDate) return false;
        const { start, end } = DateResolver.resolve(c.value as DateFilterValue, 1, startHour);
        switch (c.operator) {
            case 'equals':     return taskDate >= start && taskDate <= end;
            case 'before':     return taskDate < start;
            case 'after':      return taskDate > end;
            case 'onOrBefore': return taskDate <= end;
            case 'onOrAfter':  return taskDate >= start;
            default: return true;
        }
    }

    private static evalProperty(task: Task, c: FilterCondition): boolean {
        if (c.key == null) return true;
        const actual = task.properties?.[c.key]?.value;
        const filterValue = typeof c.value === 'string' ? c.value : '';
        switch (c.operator) {
            case 'isSet': return actual !== undefined;
            case 'isNotSet': return actual === undefined;
            case 'equals': return actual === filterValue;
            case 'contains': return actual?.toLowerCase().includes(filterValue.toLowerCase()) ?? false;
            case 'notContains': return !actual?.toLowerCase().includes(filterValue.toLowerCase());
            default: return true;
        }
    }

    private static evalLength(task: Task, c: FilterCondition, startHour: number): boolean {
        const dt = task as Partial<DisplayTask>;
        const effectiveStartDate = dt.effectiveStartDate ?? task.startDate;
        const effectiveStartTime = dt.effectiveStartTime ?? task.startTime;

        const hasDuration = !!effectiveStartDate;
        if (c.operator === 'isSet') return hasDuration;
        if (c.operator === 'isNotSet') return !hasDuration;

        if (typeof c.value !== 'number') return true;
        if (!effectiveStartDate) return false;

        const durationMs = DateUtils.getTaskDurationMs(
            effectiveStartDate, effectiveStartTime,
            dt.effectiveEndDate ?? task.endDate,
            dt.effectiveEndTime ?? task.endTime,
            startHour,
        );
        if (!Number.isFinite(durationMs) || durationMs < 0) return false;

        const unit = c.unit ?? 'hours';
        const divisor = unit === 'minutes' ? 60_000 : 3_600_000;
        const durationValue = durationMs / divisor;
        const threshold = c.value;

        switch (c.operator) {
            case 'lessThan':            return durationValue < threshold;
            case 'lessThanOrEqual':     return durationValue <= threshold;
            case 'greaterThan':         return durationValue > threshold;
            case 'greaterThanOrEqual':  return durationValue >= threshold;
            case 'equals':              return Math.abs(durationValue - threshold) < 0.001;
            default: return true;
        }
    }
}
