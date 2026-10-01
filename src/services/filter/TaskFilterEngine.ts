import type { DisplayTask, Task } from '../../types';
import type { FilterContext } from './FilterContext';
import type { FilterExpr, DateComparison, LengthComparison } from './FilterExpr';
import type { DateFilterValue } from './FilterTypes';
import { DateResolver } from './DateResolver';
import { toDisplayTask } from '../display/DisplayTaskConverter';
import { TaskValues } from './TaskValues';

/**
 * Evaluates whether a task passes a compiled filter tree ({@link FilterExpr},
 * from `compileFilter`). Every node is answered; none passes by default.
 *
 * DisplayTask-only: the value an atom compares is the effective one, read
 * from {@link TaskValues} — the table the sort reads too.
 * Raw Task callers must convert via TaskReadService / DisplayTaskConverter
 * first — TaskReadService.getFilteredTasks is the canonical entry point.
 *
 * `ancestors` resolves ancestors through context.taskLookup and converts
 * each one with toDisplayTask, so an ancestor is evaluated by exactly the
 * rules a top-level task would be.
 */
export class TaskFilterEngine {
    static evaluate(task: DisplayTask, expr: FilterExpr, context: FilterContext): boolean {
        switch (expr.kind) {
            case 'all':
                return expr.items.every(item => this.evaluate(task, item, context));
            case 'any':
                return expr.items.some(item => this.evaluate(task, item, context));
            case 'not':
                return !this.evaluate(task, expr.item, context);
            case 'ancestors':
                return this.someAncestor(task, expr.item, context);
            case 'textIn':
                return expr.values.includes(TaskValues.of(task, expr.property).text ?? '');
            case 'tagUnder': {
                const tags = TaskValues.of(task, 'tag').items;
                return expr.tags.some(v => tags.some(t => t === v || t.startsWith(v + '/')));
            }
            case 'tagIs': {
                const tags = TaskValues.of(task, 'tag').items;
                return expr.tags.some(v => tags.includes(v));
            }
            case 'tagsExactly': {
                const tags = TaskValues.of(task, 'tag').items;
                const wanted = new Set(expr.tags);
                return tags.length === wanted.size && tags.every(t => wanted.has(t));
            }
            case 'contentContains':
                return (TaskValues.of(task, 'content').text ?? '').toLowerCase().includes(expr.text.toLowerCase());
            case 'has':
                switch (expr.property) {
                    case 'startDate':
                    case 'endDate':
                    case 'due':
                        return !!TaskValues.of(task, expr.property).date;
                    case 'length':
                        return TaskValues.length(task, context.startHour).present;
                    default:
                        return TaskValues.of(task, expr.property).set;
                }
            case 'date': {
                const date = TaskValues.of(task, expr.property).date;
                return !!date && this.compareDate(date, expr.op, expr.value, context);
            }
            case 'length': {
                const ms = TaskValues.length(task, context.startHour).value;
                if (ms === undefined) return false;
                return this.compareLength(ms / (expr.unit === 'minutes' ? 60_000 : 3_600_000), expr.op, expr.value);
            }
            case 'propertySet':
                return TaskValues.property(task, expr.key).text !== undefined;
            case 'propertyEquals':
                return TaskValues.property(task, expr.key).text === expr.value;
            case 'propertyContains': {
                const actual = TaskValues.property(task, expr.key).text;
                return actual !== undefined && actual.toLowerCase().includes(expr.value.toLowerCase());
            }
        }
    }

    /** Whether some ancestor of `task` the index resolves passes `expr`. */
    private static someAncestor(task: DisplayTask, expr: FilterExpr, context: FilterContext): boolean {
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
            const ancestorDt = toDisplayTask(ancestor, context.startHour, context.taskLookup);
            if (this.evaluate(ancestorDt, expr, context)) return true;
            currentParentId = ancestor.parentId;
        }
        return false;
    }

    private static compareDate(date: string, op: DateComparison, value: DateFilterValue, context: FilterContext): boolean {
        const { start, end } = DateResolver.resolve(value, context.weekStartDay, context.startHour, context.now);
        switch (op) {
            case 'equals':     return date >= start && date <= end;
            case 'before':     return date < start;
            case 'after':      return date > end;
            case 'onOrBefore': return date <= end;
            case 'onOrAfter':  return date >= start;
        }
    }

    private static compareLength(value: number, op: LengthComparison, threshold: number): boolean {
        switch (op) {
            case 'lessThan':            return value < threshold;
            case 'lessThanOrEqual':     return value <= threshold;
            case 'greaterThan':         return value > threshold;
            case 'greaterThanOrEqual':  return value >= threshold;
            case 'equals':              return Math.abs(value - threshold) < 0.001;
        }
    }
}
