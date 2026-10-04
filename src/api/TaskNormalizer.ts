import { instantText } from '../utils/DayWindow';
import { TaskValues } from '../services/filter/TaskValues';
import type { DisplayTask, PropertyValue } from '../types';
import type { NormalizedTask } from './TaskApiTypes';
import {
    getEffectiveColor, getEffectiveLinestyle, getEffectiveTags, getEffectiveProperties,
} from '../services/data/EffectiveProperties';
import { serializeFlow } from '../services/lang/flow/FlowSerializer';
import { flowRaws } from '../services/lang/flow/FlowSegments';
import { apiIdOf, type TaskLookup } from './TaskIds';

// ── Field extractors ──

/** What an extractor may read besides the task. */
interface RecordEnv {
    lookup: TaskLookup;
    startHour: number;
}

// Every ID goes out through `apiIdOf`: the row's own, its parent's and its
// children's alike, so no ID of one shape reaches a caller in another.
// Keyed by NormalizedTask's own fields, so a field added to the type without
// an extractor (or the other way) is a compile error, and ALL_FIELD_NAMES —
// the CLI's output-fields and the references read it — lists them all.
const FIELD_EXTRACTORS: { [K in keyof NormalizedTask]: (task: DisplayTask, env: RecordEnv) => unknown } = {
    id:          (t, { lookup }) => apiIdOf(t.id, lookup),
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
    parentId:    (t, { lookup }) => (t.parentId === undefined ? null : apiIdOf(t.parentId, lookup)),
    childIds:    (t, { lookup }) => t.childIds.map(id => apiIdOf(id, lookup)),
    color:       t => getEffectiveColor(t) ?? null,
    linestyle:   t => getEffectiveLinestyle(t) ?? null,
    // The span's moments on the calendar and the clock (`@2026-10-04` ends
    // `2026-10-05` `05:00`); the due as stated, inherited ones included.
    effectiveStartDate: t => (t.span ? instantText(t.span.startMs).date : null),
    effectiveStartTime: t => (t.span ? instantText(t.span.startMs).time : null),
    effectiveEndDate:   t => (t.span ? instantText(t.span.endMs).date : null),
    effectiveEndTime:   t => (t.span ? instantText(t.span.endMs).time : null),
    effectiveDue:       t => t.stated.due ?? null,
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

export const ALL_FIELD_NAMES: readonly string[] = Object.keys(FIELD_EXTRACTORS);

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
        case 'number': return pv.number;
        case 'boolean': return pv.boolean;
        case 'array': return pv.items;
        case 'string': return pv.value;
    }
}

// ── Duration computation ──

/** How long the span lasts (`@2026-10-04` is 1440); null with no span, or one that ends before it starts. */
function computeDurationMinutes(task: DisplayTask): number | null {
    const length = TaskValues.length(task).value;
    return length === undefined ? null : Math.round(length / 60_000);
}

// ── Record extraction (for CLI field selection) ──

export function taskToRecord(task: DisplayTask, fields: readonly string[], lookup: TaskLookup, startHour: number): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    const env: RecordEnv = { lookup, startHour };
    for (const field of fields) {
        const extractor = (FIELD_EXTRACTORS as Record<string, ((task: DisplayTask, env: RecordEnv) => unknown) | undefined>)[field];
        record[field] = extractor ? extractor(task, env) : null;
    }
    return record;
}

// ── Full normalization (for API) ──

/**
 * `lookup` finds a row by its name, to give its ID (`apiIdOf`). `startHour`
 * is the visual day boundary the duration is measured with, as the filter's
 * `length` measures it.
 */
export function normalizeTask(task: DisplayTask, lookup: TaskLookup, startHour: number): NormalizedTask {
    return taskToRecord(task, ALL_FIELD_NAMES, lookup, startHour) as unknown as NormalizedTask;
}
