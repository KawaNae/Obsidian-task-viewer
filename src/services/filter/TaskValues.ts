import type { DisplayTask } from '../../types';
import type { FilterProperty } from './FilterTypes';
import { getTaskNotation } from './parserTaxonomy';
import { DateUtils } from '../../utils/DateUtils';
import {
    getEffectiveColor, getEffectiveLinestyle, getEffectiveTags, getEffectiveProperties,
} from '../data/EffectiveProperties';

/**
 * What the filter and the sort compare for each property of a task: the one
 * place a property becomes a value. `TaskFilterEngine` and `TaskSorter` both
 * read it, so a task is sorted by the value it is matched by, and a change to
 * what a property compares is made here once.
 *
 * Every value is the effective one (inherited from the section or the note,
 * resolved by `toDisplayTask`); a value the task does not have is absent,
 * and each reader says what absence means (the filter: no match; the sort:
 * the smallest).
 */

/** A date, with the time the comparison reads, if any. */
export interface DateValue { kind: 'date'; date?: string; time?: string }
/** One piece of text. */
export interface TextValue { kind: 'text'; text?: string }
/** Several pieces of text, in their order. */
export interface SetValue { kind: 'set'; items: readonly string[] }
/** Whether the task has something. */
export interface FlagValue { kind: 'flag'; set: boolean }
/**
 * How long the task lasts, in milliseconds. `present` is whether it has a
 * span at all (a start); `value` is absent when the span cannot be measured
 * (an end before the start).
 */
export interface NumberValue { kind: 'number'; present: boolean; value?: number }

export type TaskValue = DateValue | TextValue | SetValue | FlagValue | NumberValue;

/** The properties {@link TaskValues.of} answers: all but those that take more than the task. */
export type ValueProperty = Exclude<FilterProperty, 'length' | 'property'>;

/** The value each property holds. */
export interface ValueOf {
    file: TextValue;
    status: TextValue;
    content: TextValue;
    color: TextValue;
    linestyle: TextValue;
    notation: TextValue;
    tag: SetValue;
    startDate: DateValue;
    endDate: DateValue;
    due: DateValue;
    anyDate: FlagValue;
    parent: FlagValue;
    children: FlagValue;
}

const text = (value: string | undefined): TextValue => ({ kind: 'text', text: value });
const flag = (set: boolean): FlagValue => ({ kind: 'flag', set });

function dateValue(date: string | undefined, time?: string): DateValue {
    if (!date) return { kind: 'date' };
    return time ? { kind: 'date', date, time } : { kind: 'date', date };
}

const TABLE: { [P in ValueProperty]: (task: DisplayTask) => ValueOf[P] } = {
    file: t => text(t.file),
    status: t => text(t.statusChar),
    content: t => text(t.content),
    color: t => text(getEffectiveColor(t)),
    linestyle: t => text(getEffectiveLinestyle(t)),
    notation: t => text(getTaskNotation(t.parserId)),
    tag: t => ({ kind: 'set', items: getEffectiveTags(t) }),
    // The start and the end compare their dates only: the time is not read,
    // so two tasks on the same day tie whatever their hours.
    startDate: t => dateValue(t.effectiveStartDate),
    endDate: t => dateValue(t.effectiveEndDate),
    // A due compares its time too, when it is written with one.
    due: t => {
        if (!t.effectiveDue) return dateValue(undefined);
        const { date, time } = DateUtils.splitDateTime(t.effectiveDue);
        return dateValue(date, time);
    },
    anyDate: t => flag(!!t.effectiveStartDate || !!t.effectiveEndDate || !!t.effectiveDue),
    parent: t => flag(!!t.parentId),
    // Child tasks only: plain checkbox lines and wikilinks are not tasks of
    // their own, and a child ID the index cannot resolve is no child here.
    children: t => flag(t.childEntries.some(e => e.kind === 'task')),
};

export const TaskValues = {
    of<P extends ValueProperty>(task: DisplayTask, property: P): ValueOf[P] {
        return TABLE[property](task);
    },

    /** The `length` filter's value: the span from the effective start to the effective end. */
    length(task: DisplayTask, startHour: number): NumberValue {
        if (!task.effectiveStartDate) return { kind: 'number', present: false };
        const ms = DateUtils.getDisplayTaskDurationMs(task, startHour);
        return ms === null ? { kind: 'number', present: true } : { kind: 'number', present: true, value: ms };
    },

    /** The value of a property (`key:: value`), the section's when the task has none of its own. */
    property(task: DisplayTask, key: string): TextValue {
        return text(getEffectiveProperties(task)[key]?.value);
    },

    /**
     * The text a sort rule compares: the date with its time (`YYYY-MM-DDTHH:mm`)
     * when the value has one, the first of a set, and `''`, the smallest, for
     * a value the task does not have.
     */
    sortKey(value: DateValue | TextValue | SetValue): string {
        switch (value.kind) {
            case 'date':
                if (!value.date) return '';
                return value.time ? `${value.date}T${value.time}` : value.date;
            case 'text':
                return value.text ?? '';
            case 'set':
                return value.items[0] ?? '';
        }
    },
};
