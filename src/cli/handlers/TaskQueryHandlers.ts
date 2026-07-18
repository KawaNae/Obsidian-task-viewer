import type { CliData } from 'obsidian';
import type TaskViewerPlugin from '../../main';
import type { FilterState } from '../../services/filter/FilterTypes';
import { loadFilterFile } from '../../api/FilterFileLoader';
import { TaskApiError } from '../../api/TaskApiTypes';
import type { ListParams, TodayParams } from '../../api/TaskApiTypes';
import { parseSortFlag } from '../CliFilterBuilder';
import {
    formatOutput, formatSingleTask, resolveFields, cliError,
    validateFormat, parseLimit,
    type OutputFormat,
} from '../CliOutputFormatter';

// ── CliData → typed params converters ──

function cliDataToListParams(params: CliData, preloadedFilter?: FilterState): ListParams {
    const result: ListParams = {};

    if (preloadedFilter) {
        result.filter = preloadedFilter;
    } else {
        if (params.file) result.file = params.file;
        if (params.status) result.status = params.status.split(',').map(s => s.trim()).filter(Boolean);
        if (params.tag) result.tag = params.tag.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
        if (params.content) result.content = params.content;
        if (params.date) result.date = params.date;
        if (params.from) result.from = params.from;
        if (params.to) result.to = params.to;
        if (params.due) result.due = params.due;
        if (params.leaf === 'true') result.leaf = true;
        if (params.property) result.property = params.property;
        if (params.color) result.color = params.color;
        if (params.type) result.type = params.type;
        if (params.root === 'true') result.root = true;
    }

    if (params.sort) result.sort = parseSortFlag(params.sort);
    if (params.limit) result.limit = parseLimit(params.limit);

    return result;
}

function cliDataToTodayParams(params: CliData): TodayParams {
    const result: TodayParams = {};
    if (params.leaf === 'true') result.leaf = true;
    if (params.sort) result.sort = parseSortFlag(params.sort);
    if (params.limit) result.limit = parseLimit(params.limit);
    return result;
}


// ── Handlers ──

export function createListHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        const formatErr = validateFormat(params.format);
        if (formatErr) return cliError(formatErr);

        try {
            let preloadedFilter: FilterState | undefined;

            const filterFilePath = params['filter-file'];
            if (filterFilePath) {
                const result = await loadFilterFile(plugin.app, filterFilePath, params.list);
                if (typeof result === 'string') return cliError(result);
                preloadedFilter = result;
            }

            const apiParams = cliDataToListParams(params, preloadedFilter);
            const listResult = await plugin.api.list(apiParams);

            const format = (params.format as OutputFormat) || 'json';
            const fields = resolveFields(params['output-fields']);
            const meta = { total: listResult.total, truncated: listResult.truncated, limit: listResult.limit };
            return formatOutput(listResult.tasks, format, fields, meta);
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.rawMessage : `Failed to list tasks: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}

export function createTodayHandler(plugin: TaskViewerPlugin) {
    return (params: CliData): string => {
        const formatErr = validateFormat(params.format);
        if (formatErr) return cliError(formatErr);

        try {
            const apiParams = cliDataToTodayParams(params);
            const result = plugin.api.today(apiParams);

            const format = (params.format as OutputFormat) || 'json';
            const fields = resolveFields(params['output-fields']);
            const meta = { total: result.total, truncated: result.truncated, limit: result.limit };
            return formatOutput(result.tasks, format, fields, meta);
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.rawMessage : `Failed to list today's tasks: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}

export function createGetHandler(plugin: TaskViewerPlugin) {
    return (params: CliData): string => {
        if (!params.id) return cliError('Missing required flag: --id');
        const formatErr = validateFormat(params.format);
        if (formatErr) return cliError(formatErr);

        try {
            const displayTask = plugin.api.get({ id: params.id });
            const format = (params.format as OutputFormat) || 'json';
            const fields = resolveFields(params['output-fields']);
            return formatSingleTask(displayTask, format, fields);
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.rawMessage : `Failed to get task: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}
