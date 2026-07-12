import { moment } from 'obsidian';
import type { DisplayTask, TaskViewerSettings } from '../../types';
import { getEffectiveTags, getEffectiveProperties } from '../../services/data/EffectiveProperties';
import { t } from '../../i18n';

type FieldExtractor = (task: DisplayTask, settings: TaskViewerSettings) => string | null;

function weekday(dateStr?: string): string | null {
    if (!dateStr) return null;
    const dow = moment(dateStr).day();
    const labels = t('calendar.weekdaysShort').split(',');
    return labels[dow] ?? null;
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
    dueDate:        (task) => task.due?.split('T')[0] ?? null,
    dueTime:        (task) => task.due?.includes('T') ? task.due.split('T')[1] : null,
    dueYear:        (task) => task.due?.slice(0, 4) ?? null,
    dueMonth:       (task) => task.due?.slice(5, 7) ?? null,
    dueDom:         (task) => dom(task.due?.split('T')[0]),
    dueWeekday:     (task) => weekday(task.due?.split('T')[0]),

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
