import type { NormalizedTask } from '../api/TaskApiTypes';
import { TaskApiError } from '../api/TaskApiTypes';
import { ALL_FIELD_NAMES } from '../api/TaskNormalizer';

export type OutputFormat = 'json' | 'tsv' | 'jsonl';

// ── Field selection ──

/**
 * Resolve the `output-fields` flag into a list of field names.
 * - undefined → ['id'] (id only)
 * - 'content,status' → ['id', 'content', 'status'] (id always included)
 * - Throws TaskApiError for unknown field names.
 */
export function resolveFields(outputFields: string | undefined): string[] {
    if (!outputFields) return ['id'];

    const fields = outputFields.split(',').map(s => s.trim()).filter(Boolean);
    const valid = new Set(ALL_FIELD_NAMES);
    const invalid = fields.filter(f => !valid.has(f));
    if (invalid.length > 0) {
        throw new TaskApiError(
            `Unknown field(s): ${invalid.join(', ')}. Available: ${ALL_FIELD_NAMES.join(', ')}`,
        );
    }

    // Ensure id is always present
    if (!fields.includes('id')) fields.unshift('id');
    return fields;
}

// ── Field picking from NormalizedTask ──

export function pickFields(record: NormalizedTask, fields: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const f of fields) result[f] = record[f as keyof NormalizedTask] ?? null;
    return result;
}

// ── Output formatters ──

export interface ListMeta {
    total: number;
    truncated: boolean;
    limit: number | null;
}

export function formatOutput(
    tasks: NormalizedTask[],
    format: OutputFormat,
    fields: string[],
    meta?: ListMeta,
): string {
    switch (format) {
        case 'tsv':
            return formatTsv(tasks, fields);
        case 'jsonl':
            return tasks.map(t => JSON.stringify(pickFields(t, fields))).join('\n');
        case 'json':
        default:
            return JSON.stringify({
                ...(meta ? { total: meta.total, truncated: meta.truncated, limit: meta.limit } : {}),
                count: tasks.length,
                tasks: tasks.map(t => pickFields(t, fields)),
            });
    }
}

export function formatSingleTask(
    task: NormalizedTask,
    format: OutputFormat,
    fields: string[],
): string {
    const record = pickFields(task, fields);
    switch (format) {
        case 'tsv':
            return fields.join('\t') + '\n' + formatTsvRow(record, fields);
        case 'jsonl':
            return JSON.stringify(record);
        case 'json':
        default:
            return JSON.stringify(record);
    }
}

// ── TSV helpers ──

function formatTsv(tasks: NormalizedTask[], fields: string[]): string {
    const header = fields.join('\t');
    const rows = tasks.map(t => formatTsvRow(pickFields(t, fields), fields));
    return header + '\n' + rows.join('\n');
}

function formatTsvRow(record: Record<string, unknown>, fields: string[]): string {
    return fields.map(field => tsvValue(record[field])).join('\t');
}

function tsvValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.join(';');
    return String(value).replace(/[\t\n\r]/g, ' ');
}

// ── Shared CLI validation ──

const VALID_FORMATS: ReadonlySet<string> = new Set(['json', 'tsv', 'jsonl']);

export function validateFormat(format: string | undefined): string | null {
    if (format && !VALID_FORMATS.has(format)) {
        return `Invalid format: ${format}. Must be json, tsv, or jsonl`;
    }
    return null;
}

export function parseLimit(raw: string): number {
    if (raw === 'all') return Infinity;
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 0) throw new TaskApiError('--limit must be a non-negative integer or "all"');
    return n;
}

// ── JSON helpers (for CRUD responses) ──

export function cliOk(data: Record<string, unknown>): string {
    return JSON.stringify(data);
}

export function cliError(message: string): string {
    return JSON.stringify({ error: message, help: 'obsidian obsidian-task-viewer:help' });
}
