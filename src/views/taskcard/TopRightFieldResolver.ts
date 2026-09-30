import { DateUtils } from '../../utils/DateUtils';
import type { DisplayTask, TaskViewerSettings } from '../../types';
import { getEffectiveTags, getEffectiveProperties } from '../../services/data/EffectiveProperties';
import { t } from '../../i18n';

type FieldExtractor = (task: DisplayTask, settings: TaskViewerSettings) => string | null;

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

const FIELD_MAP: Record<string, FieldExtractor> = {
    start:          (task) => task.effectiveStartDate
        ? `${task.effectiveStartDate}${task.effectiveStartTime ? ' ' + task.effectiveStartTime : ''}`
        : null,
    startDate:      (task) => task.effectiveStartDate ?? null,
    startTime:      (task) => task.effectiveStartTime ?? null,
    startYear:      (task) => task.effectiveStartDate?.slice(0, 4) ?? null,
    startMonth:     (task) => task.effectiveStartDate?.slice(5, 7) ?? null,
    startDom:       (task) => dom(task.effectiveStartDate),
    startWeekday:   (task) => weekday(task.effectiveStartDate),

    end:            (task) => task.effectiveEndDate
        ? `${task.effectiveEndDate}${task.effectiveEndTime ? ' ' + task.effectiveEndTime : ''}`
        : null,
    endDate:        (task) => task.effectiveEndDate ?? null,
    endTime:        (task) => task.effectiveEndTime ?? null,
    endYear:        (task) => task.effectiveEndDate?.slice(0, 4) ?? null,
    endMonth:       (task) => task.effectiveEndDate?.slice(5, 7) ?? null,
    endDom:         (task) => dom(task.effectiveEndDate),
    endWeekday:     (task) => weekday(task.effectiveEndDate),

    due:            (task) => task.due ?? null,
    dueDate:        (task) => DateUtils.dueDatePart(task.due) ?? null,
    dueTime:        (task) => (task.due ? DateUtils.splitDateTime(task.due).time ?? null : null),
    dueYear:        (task) => task.due?.slice(0, 4) ?? null,
    dueMonth:       (task) => task.due?.slice(5, 7) ?? null,
    dueDom:         (task) => dom(DateUtils.dueDatePart(task.due)),
    dueWeekday:     (task) => weekday(DateUtils.dueDatePart(task.due)),

    tags:           (task) => {
        const tags = getEffectiveTags(task);
        return tags.length > 0 ? tags.map(tag => `#${tag}`).join(' ') : null;
    },
};

export function resolveTopRightField(
    task: DisplayTask,
    fieldName: string,
    settings: TaskViewerSettings,
): string | null {
    if (fieldName.startsWith('prop.')) {
        const props = getEffectiveProperties(task);
        const pv = props[fieldName.slice(5)];
        return pv?.value != null ? String(pv.value) : null;
    }
    const extractor = FIELD_MAP[fieldName];
    return extractor ? extractor(task, settings) : null;
}

export const KNOWN_FIELDS: string[] = Object.keys(FIELD_MAP);
