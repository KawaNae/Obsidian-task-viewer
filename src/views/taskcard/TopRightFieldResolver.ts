import { DateUtils } from '../../utils/DateUtils';
import type { DisplayTask, StatedDates, TaskViewerSettings, TopRightConfig } from '../../types';
import { getEffectiveTags, getEffectiveProperties } from '../../services/data/EffectiveProperties';
import { t } from '../../i18n';

/**
 * What a card's top right says, and nothing else: one place makes it, for
 * every view. The dates are the ones the note states (`DisplayTask.stated`,
 * the line's and what it inherits), in the form they are written. A value
 * the rules fill in (the start of the day for a bare date, the end of a day
 * or of an hour) is not written, so it is not shown.
 *
 * A config (`TopRightConfig`) names the fields and how they are joined. A
 * saved list sets its own; Timeline, Calendar and Schedule show the one
 * config `TIME_TOP_RIGHT` (the stated times, `10:00>11:00`).
 */

/**
 * What a piece of the top right is, which the card draws as its class
 * (`task-card__time-<role>`): the start and end of the times (`times`; a
 * narrow card hides the end), a separator, and any other text.
 */
export type TopRightRole = 'start' | 'end' | 'sep' | 'seg';

export interface TopRightPiece {
    text: string;
    role: TopRightRole;
}

type FieldExtractor = (task: DisplayTask, settings: TaskViewerSettings) => TopRightPiece[];

function seg(text: string | null | undefined): TopRightPiece[] {
    return text ? [{ text, role: 'seg' }] : [];
}

function weekday(dateStr?: string): string | null {
    if (!dateStr) return null;
    // A day that does not exist (`2026-02-30`, which the notation reads) has no weekday.
    const date = DateUtils.readDate(dateStr);
    if (!date) return null;
    const labels = t('calendar.weekdaysShort').split(',');
    return labels[date.getDay()] ?? null;
}

function dom(dateStr?: string): string | null {
    if (!dateStr) return null;
    return String(parseInt(dateStr.slice(8, 10), 10));
}

/**
 * A date and a time as written: either may be missing (`@2026-10-04T10:00>11:00`
 * writes an end time and no end date).
 */
function dateTime(date: string | undefined, time: string | undefined): string | null {
    return [date, time].filter(Boolean).join(' ') || null;
}

/** The stated times: the start time, and `>` the end time when there is one. */
function times(stated: StatedDates): TopRightPiece[] {
    // An end time with no start time on its line is an error (the views do
    // not show such a line), so the times start from the start time.
    if (!stated.startTime) return [];
    const pieces: TopRightPiece[] = [{ text: stated.startTime, role: 'start' }];
    if (stated.endTime) pieces.push({ text: `>${stated.endTime}`, role: 'end' });
    return pieces;
}

const FIELD_MAP: Record<string, FieldExtractor> = {
    start:          ({ stated }) => seg(dateTime(stated.startDate, stated.startTime)),
    startDate:      ({ stated }) => seg(stated.startDate),
    startTime:      ({ stated }) => seg(stated.startTime),
    startYear:      ({ stated }) => seg(stated.startDate?.slice(0, 4)),
    startMonth:     ({ stated }) => seg(stated.startDate?.slice(5, 7)),
    startDom:       ({ stated }) => seg(dom(stated.startDate)),
    startWeekday:   ({ stated }) => seg(weekday(stated.startDate)),

    end:            ({ stated }) => seg(dateTime(stated.endDate, stated.endTime)),
    endDate:        ({ stated }) => seg(stated.endDate),
    endTime:        ({ stated }) => seg(stated.endTime),
    endYear:        ({ stated }) => seg(stated.endDate?.slice(0, 4)),
    endMonth:       ({ stated }) => seg(stated.endDate?.slice(5, 7)),
    endDom:         ({ stated }) => seg(dom(stated.endDate)),
    endWeekday:     ({ stated }) => seg(weekday(stated.endDate)),

    times:          ({ stated }) => times(stated),

    due:            ({ stated }) => seg(stated.due),
    dueDate:        ({ stated }) => seg(DateUtils.dueDatePart(stated.due)),
    dueTime:        ({ stated }) => seg(stated.due ? DateUtils.splitDateTime(stated.due).time : null),
    dueYear:        ({ stated }) => seg(stated.due?.slice(0, 4)),
    dueMonth:       ({ stated }) => seg(stated.due?.slice(5, 7)),
    dueDom:         ({ stated }) => seg(dom(DateUtils.dueDatePart(stated.due))),
    dueWeekday:     ({ stated }) => seg(weekday(DateUtils.dueDatePart(stated.due))),

    tags:           (task) => {
        const tags = getEffectiveTags(task);
        return seg(tags.length > 0 ? tags.map(tag => `#${tag}`).join(' ') : null);
    },
};

/** The pieces of one field; none when the task has no value for it. */
function fieldPieces(task: DisplayTask, fieldName: string, settings: TaskViewerSettings): TopRightPiece[] {
    if (fieldName.startsWith('prop.')) {
        const props = getEffectiveProperties(task);
        const pv = props[fieldName.slice(5)];
        return seg(pv?.value != null ? String(pv.value) : null);
    }
    const extractor = FIELD_MAP[fieldName];
    return extractor ? extractor(task, settings) : [];
}

/** The text of one field, or null when the task has no value for it. */
export function resolveTopRightField(
    task: DisplayTask,
    fieldName: string,
    settings: TaskViewerSettings,
): string | null {
    return topRightText(fieldPieces(task, fieldName, settings)) || null;
}

/**
 * The top right of a card as `config` puts it: the fields that have a value,
 * joined by the separator, between the prefix and the suffix; none when no
 * field has a value. What the card draws and what its signature holds.
 */
export function composeTopRight(
    task: DisplayTask,
    config: TopRightConfig,
    settings: TaskViewerSettings,
): TopRightPiece[] {
    const { fields, separator, prefix, suffix } = config;
    const shown = fields
        .map(f => fieldPieces(task, f, settings))
        .filter(pieces => pieces.length > 0);
    if (shown.length === 0) return [];
    const pieces: TopRightPiece[] = [];
    if (prefix) pieces.push({ text: prefix, role: 'seg' });
    shown.forEach((field, i) => {
        if (i > 0 && separator) pieces.push({ text: separator, role: 'sep' });
        pieces.push(...field);
    });
    if (suffix) pieces.push({ text: suffix, role: 'seg' });
    return pieces;
}

/** The pieces as one text. */
export function topRightText(pieces: readonly TopRightPiece[]): string {
    return pieces.map(p => p.text).join('');
}

export const KNOWN_FIELDS: string[] = Object.keys(FIELD_MAP);

/**
 * The top right of Timeline, Calendar's cards of a day, Schedule, and a card
 * drawn with no top right said: the stated times, `10:00>11:00`.
 */
export const TIME_TOP_RIGHT: TopRightConfig = { fields: ['times'], separator: '' };
