import { DateUtils } from '../utils/DateUtils';
import type { DisplayTask, PropertyValue } from '../types';
import type { NormalizedTask } from './TaskApiTypes';
import {
    getEffectiveColor, getEffectiveLinestyle, getEffectiveTags, getEffectiveProperties,
} from '../services/data/EffectiveProperties';
import { serializeFlow } from '../services/lang/flow/FlowSerializer';
import { flowRaws } from '../services/lang/flow/FlowSegments';
import { ChildLineClassifier } from '../services/parsing/utils/ChildLineClassifier';
import { apiIdOf, type TaskLookup } from './TaskIds';

// ── Field extractors ──

/** What an extractor may read besides the task. */
interface RecordEnv {
    lookup: TaskLookup;
    startHour: number;
}

// Every ID goes out through `apiIdOf`: the row's own, its parent's and its
// children's alike, so no ID of one shape reaches a caller in another.
const FIELD_EXTRACTORS: Record<string, (task: DisplayTask, env: RecordEnv) => unknown> = {
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
    effectiveStartDate: t => t.effectiveStartDate || null,
    effectiveStartTime: t => t.effectiveStartTime ?? null,
    effectiveEndDate:   t => t.effectiveEndDate ?? null,
    effectiveEndTime:   t => t.effectiveEndTime ?? null,
    effectiveDue:       t => t.effectiveDue ?? null,
    durationMinutes:    (t, { startHour }) => computeDurationMinutes(t, startHour),
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
        // A property line spells it True/False, frontmatter reads it back as true/false.
        case 'boolean': return pv.value.toLowerCase() === 'true';
        case 'array': return ChildLineClassifier.arrayItems(pv.value);
        default: return pv.value;
    }
}

// ── Duration computation ──

function computeDurationMinutes(task: DisplayTask, startHour: number): number | null {
    const ms = DateUtils.getDisplayTaskDurationMs(task, startHour);
    return ms === null ? null : Math.round(ms / 60_000);
}

// ── Record extraction (for CLI field selection) ──

export function taskToRecord(task: DisplayTask, fields: string[], lookup: TaskLookup, startHour: number): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    const env: RecordEnv = { lookup, startHour };
    for (const field of fields) {
        const extractor = FIELD_EXTRACTORS[field];
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
