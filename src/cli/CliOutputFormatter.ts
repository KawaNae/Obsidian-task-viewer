import type { NormalizedTask } from '../api/TaskApiTypes';
import { TaskApiError } from '../api/TaskApiTypes';
import { ALL_FIELD_NAMES } from '../api/TaskNormalizer';
import { toCliName } from '../api/OperationSchemas';
import { IntInput } from '../utils/values/NumberValues';
import { typed } from '../utils/values/Normalize';
import { issueText } from '../utils/values/IssueText';

export type OutputFormat = 'json' | 'tsv' | 'jsonl';

export function defaultLimitForFormat(format: OutputFormat): number {
    return format === 'json' ? 100 : Infinity;
}

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
        case 'tsv': {
            let output = formatTsv(tasks, fields);
            if (meta?.truncated) {
                output += `\n# truncated: showing ${tasks.length} of ${meta.total}`;
            }
            return output;
        }
        case 'jsonl': {
            const lines = tasks.map(t => JSON.stringify(pickFields(t, fields)));
            if (meta?.truncated) {
                lines.push(JSON.stringify({ _truncated: true, showing: tasks.length, total: meta.total }));
            }
            return lines.join('\n');
        }
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
    // U+2028 and U+2029 too: a note keeps them inside a line, but a reader
    // of this output may split its rows at them.
    return String(value).replace(/[\t\n\r\u2028\u2029]/g, ' ');
}

// ── Shared CLI validation ──

const VALID_FORMATS: ReadonlySet<string> = new Set(['json', 'tsv', 'jsonl']);

export function validateFormat(format: string | undefined): string | null {
    if (format && !VALID_FORMATS.has(format)) {
        return `Invalid format: ${format}. Must be json, tsv, or jsonl`;
    }
    return null;
}

/**
 * The flag of the API key `key`, read as a whole number (`IntInput`):
 * `3days` and `1.5` are refused, not read as 3 and 1. Only the text is read
 * here; whether the number is in range is the API's to check, once, as it
 * checks a number a script hands it. An absent flag is undefined: the API's
 * default.
 */
export function readIntFlag(params: Readonly<Record<string, string>>, key: string): number | undefined {
    const raw = params[toCliName(key)];
    if (raw === undefined) return undefined;
    const read = IntInput.read(raw);
    if (!read.ok) throw TaskApiError.ofIssue(read.issue, key, raw);
    return read.value;
}

/** `limit=`: a whole number, or `all` (no limit). Its range is the API's to check. */
export function parseLimit(raw: string): number {
    if (typed(raw) === 'all') return Infinity;
    const read = IntInput.read(raw);
    if (read.ok) return read.value;
    if (read.issue.code === 'shape') throw new TaskApiError(`${issueText(read.issue, 'limit')} or "all", got: ${JSON.stringify(raw)}`);
    throw TaskApiError.ofIssue(read.issue, 'limit', raw);
}

/** A listing's `limit=` flag, or the format's default when it is absent. */
export function readLimitFlag(params: Readonly<Record<string, string>>, format: OutputFormat): number {
    return params.limit === undefined ? defaultLimitForFormat(format) : parseLimit(params.limit);
}

// ── JSON helpers (for CRUD responses) ──

export function cliOk(data: Record<string, unknown>): string {
    return JSON.stringify(data);
}

export function cliError(message: string): string {
    return JSON.stringify({ error: message, help: 'obsidian obsidian-task-viewer:help' });
}

/**
 * A thrown error as a cliError. A `TaskApiError` is told in its own words
 * with its parameters named by their flags (`parent-id`, not `parentId`);
 * any other error, as `Failed to <label>: …` when `label` names the
 * operation (e.g. "create task").
 */
export function cliErrorOf(e: unknown, label?: string): string {
    if (e instanceof TaskApiError) return cliError(e.textFor(toCliName));
    const message = e instanceof Error ? e.message : String(e);
    return cliError(label ? `Failed to ${label}: ${message}` : message);
}

/** Runs a handler body and turns a thrown error into a cliError (`cliErrorOf`). */
export async function wrapCliResult(label: string, fn: () => Promise<string> | string): Promise<string> {
    try {
        return await fn();
    } catch (e) {
        return cliErrorOf(e, label);
    }
}
