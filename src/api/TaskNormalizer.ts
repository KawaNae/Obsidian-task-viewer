import type { DisplayTask, PropertyValue } from '../types';
import type { NormalizedTask } from './TaskApiTypes';

// ── Field extractors ──

const FIELD_EXTRACTORS: Record<string, (task: DisplayTask) => unknown> = {
    id:          t => t.id,
    file:        t => t.file,
    line:        t => t.line,
    content:     t => t.content,
    status:      t => t.statusChar,
    startDate:   t => t.startDate ?? null,
    startTime:   t => t.startTime ?? null,
    endDate:     t => t.endDate ?? null,
    endTime:     t => t.endTime ?? null,
    due:         t => t.due ?? null,
    tags:        t => t.tags,
    parserId:    t => t.parserId,
    parentId:    t => t.parentId ?? null,
    childIds:    t => t.childIds,
    color:       t => t.color ?? null,
    linestyle:   t => t.linestyle ?? null,
    effectiveStartDate: t => t.effectiveStartDate || null,
    effectiveStartTime: t => t.effectiveStartTime ?? null,
    effectiveEndDate:   t => t.effectiveEndDate ?? null,
    effectiveEndTime:   t => t.effectiveEndTime ?? null,
    durationMinutes:    t => computeDurationMinutes(t),
    properties:         t => {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(t.properties ?? {})) {
            result[k] = toNativeValue(v);
        }
        return result;
    },
};

export const ALL_FIELD_NAMES: string[] = Object.keys(FIELD_EXTRACTORS);

// ── Property value conversion ──

function toNativeValue(pv: PropertyValue): unknown {
    switch (pv.type) {
        case 'number': return Number(pv.value);
        case 'boolean': return pv.value === 'True';
        case 'array': {
            const inner = pv.value.startsWith('[') ? pv.value.slice(1, -1) : pv.value;
            return inner.split(',').map(s => s.trim()).filter(s => s !== '');
        }
        default: return pv.value;
    }
}

// ── Duration computation ──

function computeDurationMinutes(task: DisplayTask): number | null {
    const startTime = task.effectiveStartTime;
    const endTime = task.effectiveEndTime;
    if (!startTime || !endTime) return null;

    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let minutes = (eh * 60 + em) - (sh * 60 + sm);
    if (minutes < 0) minutes += 24 * 60; // midnight crossing
    return minutes;
}

// ── Record extraction (for CLI field selection) ──

export function taskToRecord(task: DisplayTask, fields: string[]): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    for (const field of fields) {
        const extractor = FIELD_EXTRACTORS[field];
        record[field] = extractor ? extractor(task) : null;
    }
    return record;
}

// ── Full normalization (for API) ──

export function normalizeTask(task: DisplayTask): NormalizedTask {
    return taskToRecord(task, ALL_FIELD_NAMES) as unknown as NormalizedTask;
}
