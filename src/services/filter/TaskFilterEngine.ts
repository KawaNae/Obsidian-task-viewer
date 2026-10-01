import type { DisplayTask, Task } from '../../types';
import type { FilterState, FilterCondition, FilterGroup, FilterItem, DateFilterValue } from './FilterTypes';
import type { FilterContext } from './FilterContext';
import { isFilterCondition } from './FilterTypes';
import { DateResolver } from './DateResolver';
import { toDisplayTask } from '../display/DisplayTaskConverter';
import { TaskValues, type NumberValue } from './TaskValues';

/**
 * Evaluates whether a task passes a recursive filter tree.
 * Groups can contain both conditions and sub-groups at any depth.
 *
 * DisplayTask-only: the value a condition compares is the effective one, read
 * from {@link TaskValues} — the table the sort reads too.
 * Raw Task callers must convert via TaskReadService / DisplayTaskConverter
 * first — TaskReadService.getFilteredTasks is the canonical entry point.
 *
 * The `parent` target resolves ancestors through context.taskLookup and
 * converts each one with toDisplayTask, so an ancestor is evaluated by
 * exactly the rules a top-level task would be.
 */
export class TaskFilterEngine {
    static evaluate(task: DisplayTask, filterState: FilterState, context: FilterContext): boolean {
        return this.evaluateGroup(task, filterState, context);
    }

    private static evaluateGroup(task: DisplayTask, group: FilterGroup, context: FilterContext): boolean {
        if (group.filters.length === 0) return true;

        if (group.logic === 'or') {
            return group.filters.some(child => this.evaluateItem(task, child, context));
        }
        return group.filters.every(child => this.evaluateItem(task, child, context));
    }

    private static evaluateItem(task: DisplayTask, node: FilterItem, context: FilterContext): boolean {
        if (isFilterCondition(node)) {
            return this.evalCondition(task, node, context);
        }
        return this.evaluateGroup(task, node, context);
    }

    private static evalCondition(task: DisplayTask, condition: FilterCondition, context: FilterContext): boolean {
        // Skip conditions with empty array values (value not yet selected)
        if (Array.isArray(condition.value) && condition.value.length === 0) return true;

        // Target resolution: evaluate condition against any ancestor.
        // Ancestors are looked up as raw Task; ancestor-driven filters don't
        // need effective dates so the lookup stays Task-typed.
        if (condition.target === 'parent') {
            const selfCondition = { ...condition, target: undefined } as FilterCondition;
            return this.evaluateAncestor(task, selfCondition, context);
        }

        const startHour = context.startHour;
        switch (condition.property) {
            case 'file':
            case 'status':
            case 'color':
            case 'linestyle':
            case 'notation':
                return this.evalStringSet(TaskValues.of(task, condition.property).text ?? '', condition);
            case 'tag':
                return this.evalTag(TaskValues.of(task, 'tag').items, condition);
            case 'content':
                return this.evalContent(TaskValues.of(task, 'content').text ?? '', condition);
            case 'startDate':
            case 'endDate':
            case 'due':
                return this.evalDate(TaskValues.of(task, condition.property).date, condition, context);
            case 'anyDate':
            case 'parent':
            case 'children':
                return this.evalFlag(TaskValues.of(task, condition.property).set, condition);
            case 'length':
                return this.evalLength(TaskValues.length(task, startHour), condition);
            case 'property':
                if (condition.key == null || condition.key === '') return true;
                return this.evalProperty(TaskValues.property(task, condition.key).text, condition);
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
        context: FilterContext,
    ): boolean {
        const seen = new Set<string>();
        let currentParentId: string | undefined = task.parentId;
        while (currentParentId && !seen.has(currentParentId)) {
            seen.add(currentParentId);
            const ancestor: Task | undefined = context.taskLookup(currentParentId);
            if (!ancestor) return false;
            // Through the one conversion entry point, same as any other
            // task the engine sees. The hand-built object this replaces set
            // no `effectiveDue` at all (the field is optional, so nothing
            // caught it) and pinned `childEntries` to [], so a `target:
            // parent` filter could not see a due date written plainly on the
            // parent, nor that the parent had children.
            const ancestorDt = toDisplayTask(
                ancestor,
                context.startHour,
                context.taskLookup,
            );
            if (this.evalCondition(ancestorDt, selfCondition, context)) return true;
            currentParentId = ancestor.parentId;
        }
        return false;
    }

    private static evalTag(tags: readonly string[], c: FilterCondition): boolean {
        if (!Array.isArray(c.value)) return true;
        if (c.operator === 'includes') {
            return c.value.some(v => tags.some(t => this.tagMatches(t, v)));
        }
        if (c.operator === 'excludes') {
            return !c.value.some(v => tags.some(t => this.tagMatches(t, v)));
        }
        if (c.operator === 'equals') {
            return c.value.some(v => tags.some(t => t === v));
        }
        if (c.operator === 'only') {
            const filterSet = new Set(c.value);
            return tags.length === filterSet.size
                && tags.every(t => filterSet.has(t));
        }
        return true;
    }

    private static evalContent(content: string, c: FilterCondition): boolean {
        if (typeof c.value !== 'string') return true;
        const lower = content.toLowerCase();
        const search = c.value.toLowerCase();
        if (c.operator === 'contains') return lower.includes(search);
        if (c.operator === 'notContains') return !lower.includes(search);
        return true;
    }

    private static evalDate(taskDate: string | undefined, c: FilterCondition, context: FilterContext): boolean {
        if (c.operator === 'isSet') return !!taskDate;
        if (c.operator === 'isNotSet') return !taskDate;

        if (c.value == null) return true;
        if (!taskDate) return false;
        const { start, end } = DateResolver.resolve(c.value as DateFilterValue, context.weekStartDay, context.startHour, context.now);
        switch (c.operator) {
            case 'equals':     return taskDate >= start && taskDate <= end;
            case 'before':     return taskDate < start;
            case 'after':      return taskDate > end;
            case 'onOrBefore': return taskDate <= end;
            case 'onOrAfter':  return taskDate >= start;
            default: return true;
        }
    }

    private static evalFlag(set: boolean, c: FilterCondition): boolean {
        if (c.operator === 'isSet') return set;
        if (c.operator === 'isNotSet') return !set;
        return true;
    }

    private static evalProperty(actual: string | undefined, c: FilterCondition): boolean {
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

    private static evalLength(length: NumberValue, c: FilterCondition): boolean {
        if (c.operator === 'isSet') return length.present;
        if (c.operator === 'isNotSet') return !length.present;

        if (typeof c.value !== 'number') return true;
        if (length.value === undefined) return false;
        const durationMs = length.value;

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
