import type { DisplayTask, PropertyValue } from '../types';
import type { NormalizedTask } from './TaskApiTypes';
import {
    getEffectiveColor, getEffectiveLinestyle, getEffectiveTags, getEffectiveProperties,
} from '../services/data/EffectiveProperties';
import { serializeFlow } from '../services/flow/FlowSerializer';
import { flowRaws } from '../services/flow/FlowSegments';
import { apiIdOf, type TaskLookup } from './TaskIds';

// ── Field extractors ──

// Every ID goes out through `apiIdOf`: the row's own, its parent's and its
// children's alike, so no ID of one shape reaches a caller in another.
const FIELD_EXTRACTORS: Record<string, (task: DisplayTask, lookup: TaskLookup) => unknown> = {
    id:          (t, lookup) => apiIdOf(t.id, lookup),
    file:        t => t.file,
    line:        t => t.line,
    content:     t => t.content,
    status:      t => t.statusChar,
    startDate:   t => t.startDate ?? null,
    startTime:   t => t.startTime ?? null,
    endDate:     t => t.endDate ?? null,
    endTime:     t => t.endTime ?? null,
    due:         t => t.due ?? null,
    tags:        t => getEffectiveTags(t),
    parserId:    t => t.parserId,
    parentId:    (t, lookup) => (t.parentId === undefined ? null : apiIdOf(t.parentId, lookup)),
    childIds:    (t, lookup) => t.childIds.map(id => apiIdOf(id, lookup)),
    color:       t => getEffectiveColor(t) ?? null,
    linestyle:   t => getEffectiveLinestyle(t) ?? null,
    effectiveStartDate: t => t.effectiveStartDate || null,
    effectiveStartTime: t => t.effectiveStartTime ?? null,
    effectiveEndDate:   t => t.effectiveEndDate ?? null,
    effectiveEndTime:   t => t.effectiveEndTime ?? null,
    effectiveDue:       t => t.effectiveDue ?? null,
    durationMinutes:    t => computeDurationMinutes(t),
    properties:         t => {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(getEffectiveProperties(t))) {
            result[k] = toNativeValue(v);
        }
        return result;
    },
    flow:               t => extractFlowString(t),
};

export const ALL_FIELD_NAMES: string[] = Object.keys(FIELD_EXTRACTORS);

// ── Flow extraction ──

function extractFlowString(task: DisplayTask): string | null {
    if (!task.flow) return null;
    if (task.flow.program) return serializeFlow(task.flow.program);
    const joined = flowRaws(task.flow).filter(r => r !== '').join(' ');
    return joined || null;
}

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

export function taskToRecord(task: DisplayTask, fields: string[], lookup: TaskLookup): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    for (const field of fields) {
        const extractor = FIELD_EXTRACTORS[field];
        record[field] = extractor ? extractor(task, lookup) : null;
    }
    return record;
}

// ── Full normalization (for API) ──

/** `lookup` finds a row by its name, to give its ID (`apiIdOf`). */
export function normalizeTask(task: DisplayTask, lookup: TaskLookup): NormalizedTask {
    return taskToRecord(task, ALL_FIELD_NAMES, lookup) as unknown as NormalizedTask;
}
