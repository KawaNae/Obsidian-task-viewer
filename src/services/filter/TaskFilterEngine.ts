import type { DisplayTask, Task } from '../../types';
import type { FilterState, FilterCondition, FilterGroup, FilterItem, FilterContext, DateFilterValue } from './FilterTypes';
import { isFilterCondition } from './FilterTypes';
import { DateResolver } from './DateResolver';
import { DateUtils } from '../../utils/DateUtils';
import { getTaskKind, getTaskNotation } from './parserTaxonomy';

/**
 * Evaluates whether a task passes a recursive filter tree.
 * Groups can contain both conditions and sub-groups at any depth.
 *
 * DisplayTask-only: date filters use effective (resolved) fields directly.
 * Raw Task callers must convert via TaskReadService / DisplayTaskConverter
 * first — TaskReadService.getFilteredTasks is the canonical entry point.
 *
 * The `parent` target uses raw Task lookups from context.taskLookup since
 * ancestor resolution doesn't need date semantics.
 */
export class TaskFilterEngine {
    static evaluate(task: DisplayTask, filterState: FilterState, context?: FilterContext): boolean {
        return this.evaluateGroup(task, filterState, context);
    }

    private static evaluateGroup(task: DisplayTask, group: FilterGroup, context?: FilterContext): boolean {
        if (group.filters.length === 0) return true;

        if (group.logic === 'or') {
            return group.filters.some(child => this.evaluateItem(task, child, context));
        }
        return group.filters.every(child => this.evaluateItem(task, child, context));
    }

    private static evaluateItem(task: DisplayTask, node: FilterItem, context?: FilterContext): boolean {
        if (isFilterCondition(node)) {
            return this.evalCondition(task, node, context);
        }
        return this.evaluateGroup(task, node, context);
    }

    private static evalCondition(task: DisplayTask, condition: FilterCondition, context?: FilterContext): boolean {
        // Skip conditions with empty array values (value not yet selected)
        if (Array.isArray(condition.value) && condition.value.length === 0) return true;

        // Target resolution: evaluate condition against any ancestor.
        // Ancestors are looked up as raw Task; ancestor-driven filters don't
        // need effective dates so the lookup stays Task-typed.
        if (condition.target === 'parent') {
            const selfCondition = { ...condition, target: undefined } as FilterCondition;
            return this.evaluateAncestor(task, selfCondition, context);
        }

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
                return this.evalDate(task.effectiveStartDate || task.startDate, condition, context?.startHour ?? 0);
            case 'endDate':
                return this.evalDate(task.effectiveEndDate ?? task.endDate, condition, context?.startHour ?? 0);
            case 'due':
                return this.evalDate(task.due?.split('T')[0], condition, context?.startHour ?? 0);
            case 'anyDate': {
                // Aggregate over startDate / endDate / due using effective fields.
                // isSet = any of the three set (scheduled)
                // isNotSet = all three unset (inbox)
                const hasAny = !!task.effectiveStartDate
                            || !!task.effectiveEndDate
                            || !!task.due;
                if (condition.operator === 'isSet') return hasAny;
                if (condition.operator === 'isNotSet') return !hasAny;
                return true;
            }
            case 'color':
                return this.evalStringSet(task.color ?? '', condition);
            case 'linestyle':
                return this.evalStringSet(task.linestyle ?? '', condition);
            case 'length':
                return this.evalLength(task, condition, context?.startHour ?? 0);
            case 'kind':
                return this.evalStringSet(getTaskKind(task.parserId), condition);
            case 'notation':
                return this.evalStringSet(getTaskNotation(task.parserId), condition);
            case 'parent':
                if (condition.operator === 'isSet') return !!task.parentId;
                if (condition.operator === 'isNotSet') return !task.parentId;
                return true;
            case 'children': {
                // 'children' = independent child tasks. Plain checkbox lines
                // and wikilinks aren't tasks of their own, so we filter to
                // 'task' kind entries.
                const hasChildTask = task.childEntries.some(e => e.kind === 'task');
                if (condition.operator === 'isSet') return hasChildTask;
                if (condition.operator === 'isNotSet') return !hasChildTask;
                return true;
            }
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

    private static evaluateAncestor(
        task: DisplayTask,
        selfCondition: FilterCondition,
        context: FilterContext | undefined,
    ): boolean {
        const seen = new Set<string>();
        let currentParentId: string | undefined = task.parentId;
        while (currentParentId && !seen.has(currentParentId)) {
            seen.add(currentParentId);
            const ancestor: Task | undefined = context?.taskLookup?.(currentParentId);
            if (!ancestor) return false;
            // Lift raw Task into a minimal DisplayTask for filter evaluation.
            // Effective dates fall back to raw values; ancestor filters in
            // practice only inspect non-date properties (file/tag/status/etc),
            // and childEntries is empty since we don't walk the ancestor's
            // children during filter evaluation.
            const ancestorDt: DisplayTask = {
                ...ancestor,
                effectiveStartDate: ancestor.startDate ?? '',
                effectiveStartTime: ancestor.startTime,
                effectiveEndDate: ancestor.endDate,
                effectiveEndTime: ancestor.endTime,
                startDateImplicit: false,
                startTimeImplicit: false,
                endDateImplicit: false,
                endTimeImplicit: false,
                originalTaskId: ancestor.id,
                isSplit: false,
                childEntries: [],
            };
            if (this.evalCondition(ancestorDt, selfCondition, context)) return true;
            currentParentId = ancestor.parentId;
        }
        return false;
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
        if (c.key == null || c.key === '') return true;
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

    private static evalLength(task: DisplayTask, c: FilterCondition, startHour: number): boolean {
        const hasDuration = !!task.effectiveStartDate;
        if (c.operator === 'isSet') return hasDuration;
        if (c.operator === 'isNotSet') return !hasDuration;

        if (typeof c.value !== 'number') return true;
        if (!task.effectiveStartDate) return false;

        const durationMs = DateUtils.getTaskDurationMs(
            task.effectiveStartDate, task.effectiveStartTime,
            task.effectiveEndDate,
            task.effectiveEndTime,
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
