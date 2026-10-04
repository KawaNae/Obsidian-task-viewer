import type { DisplayTask } from '../../types';
import type { FilterProperty } from './FilterTypes';
import { getTaskNotation } from './parserTaxonomy';
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

/**
 * A moment of the task, and whether it is a start or an end. A start belongs
 * to the window it is in; an end and a due to the window they close, so one
 * right at a day's start is the day before's.
 */
export interface InstantValue { kind: 'instant'; ms?: number; edge: 'start' | 'end' }
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

export type TaskValue = InstantValue | TextValue | SetValue | FlagValue | NumberValue;

/** The properties {@link TaskValues.of} answers: all but those that take more than the task, and the span itself. */
export type ValueProperty = Exclude<FilterProperty, 'length' | 'property' | 'period'>;

/** The value each property holds. */
export interface ValueOf {
    file: TextValue;
    status: TextValue;
    content: TextValue;
    color: TextValue;
    linestyle: TextValue;
    notation: TextValue;
    tag: SetValue;
    startDate: InstantValue;
    endDate: InstantValue;
    due: InstantValue;
    anyDate: FlagValue;
    parent: FlagValue;
    children: FlagValue;
}

const text = (value: string | undefined): TextValue => ({ kind: 'text', text: value });
const flag = (set: boolean): FlagValue => ({ kind: 'flag', set });

function instant(ms: number | null | undefined, edge: InstantValue['edge']): InstantValue {
    return ms === null || ms === undefined ? { kind: 'instant', edge } : { kind: 'instant', ms, edge };
}

const TABLE: { [P in ValueProperty]: (task: DisplayTask) => ValueOf[P] } = {
    file: t => text(t.file),
    status: t => text(t.statusChar),
    content: t => text(t.content),
    color: t => text(getEffectiveColor(t)),
    linestyle: t => text(getEffectiveLinestyle(t)),
    notation: t => text(getTaskNotation(t.parserId)),
    tag: t => ({ kind: 'set', items: getEffectiveTags(t) }),
    // The moments of the span and of the due (`resolveSpan`).
    startDate: t => instant(t.span?.startMs, 'start'),
    endDate: t => instant(t.span?.endMs, 'end'),
    due: t => instant(t.dueMs, 'end'),
    anyDate: t => flag(!!t.stated.startDate || !!t.stated.endDate || !!t.stated.due),
    parent: t => flag(!!t.parentId),
    // Child tasks only: plain checkbox lines and wikilinks are not tasks of
    // their own, and a child ID the index cannot resolve is no child here.
    // The API's `leaf` reads this too.
    children: t => flag(t.childEntries.some(e => e.kind === 'task')),
};

/**
 * What each value is, in words, beside the table that reads it: the
 * references (`api/Reference`) tell a caller what a sort rule compares from
 * here, so a change to a row of the table is made with its words.
 */
const WORDS: { [P in ValueProperty]: string } = {
    file: 'the file path',
    status: 'the status character',
    content: 'the text of the task',
    color: 'the card color, inherited ones included',
    linestyle: 'the line style, inherited ones included',
    notation: 'the notation (taskviewer, tasks, dayplanner)',
    tag: 'the tags, inherited ones included; a sort compares the first',
    startDate: 'the moment the task starts; a bare date starts at the start of its day',
    endDate: 'the moment the task ends; a bare date ends at the end of its day',
    due: 'the moment of the due, inherited ones included; a bare date is due at the end of its day',
    anyDate: 'whether any of start, end and due is set',
    parent: 'whether the task has a parent',
    children: 'whether the task has child tasks (plain checkbox lines and links are not)',
};

export const TaskValues = {
    /** What {@link of} reads for `property`, in words. */
    words(property: ValueProperty): string {
        return WORDS[property];
    },


    of<P extends ValueProperty>(task: DisplayTask, property: P): ValueOf[P] {
        return TABLE[property](task);
    },

    /** The `length` filter's value: how long the span lasts (`@D` is 24 hours). */
    length(task: DisplayTask): NumberValue {
        if (!task.span) return { kind: 'number', present: false };
        const ms = task.span.endMs - task.span.startMs;
        return ms < 0 ? { kind: 'number', present: true } : { kind: 'number', present: true, value: ms };
    },

    /** The value of a property (`key:: value`), the section's when the task has none of its own. */
    property(task: DisplayTask, key: string): TextValue {
        return text(getEffectiveProperties(task)[key]?.value);
    },

    /**
     * What a sort rule compares: a moment as its number, the text, the first
     * of a set; a value the task does not have is the smallest (`-Infinity`,
     * `''`).
     */
    sortKey(value: InstantValue | TextValue | SetValue): number | string {
        switch (value.kind) {
            case 'instant':
                return value.ms ?? -Infinity;
            case 'text':
                return value.text ?? '';
            case 'set':
                return value.items[0] ?? '';
        }
    },
};
