import type { CliData } from 'obsidian';
import type TaskViewerPlugin from '../../main';
import { TaskApiError } from '../../api/TaskApiTypes';
import { formatOutput, resolveFields, cliOk, cliError, type OutputFormat } from '../CliOutputFormatter';
import { parseSortFlag } from '../CliFilterBuilder';

const VALID_FORMATS = new Set(['json', 'tsv', 'jsonl']);

function parseLimit(raw: string): number {
    if (raw === 'all') return Infinity;
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 0) throw new TaskApiError('--limit must be a non-negative integer or "all"');
    return n;
}

export function createDuplicateHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.id) return cliError('Missing required flag: --id');

        try {
            const dayOffset = params['day-offset'] ? parseInt(params['day-offset'], 10) : undefined;
            const count = params.count ? parseInt(params.count, 10) : undefined;

            if (dayOffset !== undefined && isNaN(dayOffset)) {
                return cliError('--day-offset must be an integer');
            }
            if (count !== undefined && (isNaN(count) || count < 1)) {
                return cliError('--count must be a positive integer');
            }

            const result = await plugin.api.duplicate({ id: params.id, dayOffset, count });
            return cliOk({ duplicated: result.duplicated });
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.rawMessage : `Failed to duplicate task: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}

export function createConvertHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.id) return cliError('Missing required flag: --id');

        try {
            const result = await plugin.api.convertToTvFile({ id: params.id });
            return cliOk({ convertedFrom: result.convertedFrom, newFile: result.newFile });
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.rawMessage : `Failed to convert task: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}

export function createCategorizedTasksForDateRangeHandler(plugin: TaskViewerPlugin) {
    return (params: CliData): string => {
        if (!params.from) return cliError('Missing required flag: --from');
        if (!params.to) return cliError('Missing required flag: --to');

        try {
            const result = plugin.api.categorizedTasksForDateRange({ from: params.from, to: params.to });
            return cliOk(result);
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.rawMessage : `Failed to categorize tasks: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}

export function createInsertChildTaskHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params['parent-id']) return cliError('Missing required flag: --parent-id');
        if (!params.content) return cliError('Missing required flag: --content');

        try {
            const result = await plugin.api.insertChildTask({
                parentId: params['parent-id'],
                content: params.content,
            });
            return cliOk({ parentId: result.parentId });
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.rawMessage : `Failed to insert child task: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}

export function createCreateTvFileHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.content) return cliError('Missing required flag: --content');

        try {
            const result = await plugin.api.createTvFile({
                content: params.content,
                start: params.start,
                end: params.end,
                due: params.due,
                status: params.status,
            });
            return cliOk({ newFile: result.newFile });
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.rawMessage : `Failed to create frontmatter task: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}

export function createGetStartHourHandler(plugin: TaskViewerPlugin) {
    return (): string => {
        const result = plugin.api.getStartHour();
        return cliOk({ ...result });
    };
}

export function createTasksForDateRangeHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.from) return cliError('Missing required flag: --from');
        if (!params.to) return cliError('Missing required flag: --to');

        if (params.format && !VALID_FORMATS.has(params.format)) {
            return cliError(`Invalid format: ${params.format}. Must be json, tsv, or jsonl`);
        }

        try {
            const sort = params.sort ? parseSortFlag(params.sort) : undefined;
            const limit = params.limit ? parseLimit(params.limit) : undefined;

            const result = await plugin.api.tasksForDateRange({
                from: params.from,
                to: params.to,
                sort,
                limit,
            });

            const format = (params.format as OutputFormat) || 'json';
            const fields = resolveFields(params['output-fields']);
            const meta = { total: result.total, truncated: result.truncated, limit: result.limit };
            return formatOutput(result.tasks, format, fields, meta);
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.rawMessage : `Failed to query date range: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}
